// Bringing an agent back in a terminal that lost it (hc server stop, a crash,
// a reboot). herdr-core keeps nothing of the program it lost: the mod labels
// each terminal with the agent it last ran (LABEL, kept by the core across
// restarts), and recipes.js says how each agent starts again.

import { hc, exec } from "herdr";
import { isClaude, processIdentity, claudeLaunchWords } from "./claude-polling.js";

import { LABEL, SESSION, CLAUDE_OPTIONS, PI_RECOVERY, piRecovery, holdsPiSession, recoveryLine, claudeOptionsLabel } from "./recipes.js";
export { LABEL, SESSION, RECIPES } from "./recipes.js";

// Types a command line into the terminal's shell, so the person's own agent
// commands (functions, wrappers) run it.
export function send(address, line) {
  return hc(["send", address, line]);
}

// An agent is only an agent to Herdr if it reports its status (OSC 7501).
// Claude asks the terminal once, as it starts, whether it may (`OSC 7501 ; ?`);
// with no reply in time it never reports, and its tab looks like a plain shell
// for good. Many resumed at once can miss that window. So resumes run one at a
// time, each is checked until it reports, and one that doesn't is exited and
// started again.
const TRIES = 3;
const REPORT_MS = 20000;
const EXIT_MS = 10000;

async function info(address) {
  const r = await hc(["get", address]).catch(() => null);
  try { return r && r.code === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
}

// The shell is in front again, or the terminal is gone.
const atShell = (j) => !j || j.state !== "live" || !j.foreground || j.foreground.pid === j.pid;

async function until(cx, address, ms, done, check) {
  for (let t = 0; t < ms; t += 500) {
    check();
    const j = await info(address);
    check();
    if (done(j)) return j;
    await cx.sleep(500);
  }
  check();
  return info(address);
}

async function attempt(cx, address, line, check) {
  for (let i = 1; i <= TRIES; i++) {
    check();
    await send(address, line);
    // Reported: an agent. Back at the shell: it quit (an error, a picker left).
    const j = await until(cx, address, REPORT_MS, (j) => Boolean(j?.reported) || (j && atShell(j)), check);
    check();
    if (!j || j.reported || atShell(j)) return;
    // Running without reporting: quit it and start it again.
    await hc(["send", address, "/exit"]).catch(() => null);
    const out = await until(cx, address, EXIT_MS, atShell, check);
    check();
    if (!atShell(out)) return; // it didn't quit: leave it as it is
  }
}

// One queue per sidebar, never per module: 0.1.14 shares module state even
// after every copy closes. Cancelled host awaits stay pending, not rejected.
// Separate copies can recover concurrently; within one copy all agents remain
// serial. Keep only spawn-owned cx in requests, never an event/init context.
export function createRecovery() {
  let queue = Promise.resolve();
  let closed = false;
  const check = () => { if (closed) throw new Error("Recovery owner closed"); };
  function enqueue(task) {
    if (closed) return Promise.resolve(null);
    queue = queue.then(() => { check(); return task(); }).catch(() => null);
    return queue;
  }
  return {
    // Synchronous: close drains JS jobs before the host retires this copy.
    // Already-issued commands cannot be recalled; forbid every follow-up.
    close() { closed = true; queue = Promise.resolve(); },
    recover(cx, address, agent, labels, tab) {
      if (agent !== "pi") return enqueue(() => attempt(cx, address, recoveryLine(agent, labels, { tab }), check));
      // Pi must not use Claude's report timeout and /exit retry: its session
      // picker can wait indefinitely. Send once, only while still at a shell.
      return enqueue(async () => {
        const recovery = piRecovery(labels[PI_RECOVERY]);
        let picker = false;
        if (recovery?.sessionFile) {
          // Missing or empty files create NEW Pi conversations. Check a bounded
          // header, including its ID, so replaced files cannot resume another one.
          const file = await exec("sh", ["-c", 'test -f "$1" && head -c 4096 "$1"', "sh", recovery.sessionFile]).catch(() => null);
          check();
          picker = file?.code !== 0 || !holdsPiSession(file.stdout, recovery.sessionId);
        }
        const current = await info(address);
        check();
        if (!current || current.state !== "live" || !atShell(current)) return;
        await send(address, recoveryLine("pi", labels, { picker }));
      });
    },
  };
}

export function remember(address, agent) {
  return hc(["label", address, `${LABEL}=${agent}`]);
}

// The Claude session running in front in a terminal, or null: its id and its
// CLAUDE_OPTIONS label value (null: no options). Claude writes
// ~/.claude/sessions/<pid>.json for each running process (sessionId follows
// /clear and /resume inside it). The options come from the argv of that same
// process.
export async function claudeSession(address, expected) {
  const j = await info(address);
  const pid = j?.foreground?.pid;
  if (j?.state !== "live" || !isClaude(j) || !Number.isSafeInteger(pid) || pid <= 0) return null;
  if ((expected?.pid != null && expected.pid !== j.pid) ||
      (expected?.foreground?.pid != null && expected.foreground.pid !== pid)) return null;
  const identity = processIdentity(j);
  const options = claudeOptionsLabel(claudeLaunchWords(j), j.foreground.cwd);
  const r = await exec("sh", ["-c", 'cat "$HOME/.claude/sessions/$1.json"', "sh", String(pid)]).catch(() => null);
  let id;
  try { id = r?.code === 0 ? JSON.parse(r.stdout).sessionId : null; } catch { return null; }
  if (typeof id !== "string" || !id || /[\x00-\x1f\x7f]/.test(id)) return null;
  // The file read yields to other work. Reject a process switch even if the
  // app's terminals() snapshot has not caught up with the core yet.
  const after = await info(address);
  return after?.state === "live" && isClaude(after) && processIdentity(after) === identity ? { id, options } : null;
}

// Writes what changed of a claudeSession result, in one label call: the
// session, and the options (removed when the process has none).
export async function rememberSession(address, { id, options }, labels = {}) {
  const changes = [];
  if (labels[SESSION] !== id) changes.push(`${SESSION}=${id}`);
  if ((labels[CLAUDE_OPTIONS] ?? null) !== options) changes.push(`${CLAUDE_OPTIONS}=${options ?? ""}`);
  return changes.length ? hc(["label", address, ...changes]) : null;
}
