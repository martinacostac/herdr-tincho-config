// Bringing an agent back in a terminal that lost it (hc server stop, a crash,
// a reboot). herdr-core keeps nothing of the program it lost: the mod labels
// each terminal with the agent it last ran (LABEL, kept by the core across
// restarts), and recipes.js says how each agent starts again.

import { hc, exec } from "herdr";
import { isClaude, processIdentity, claudeLaunchWords } from "./claude-polling.js";

import { LABEL, SESSION, CLAUDE_OPTIONS, PI_RECOVERY, SUSPENDED, STANDIN_APP, piRecovery, holdsPiSession, recoveryLine, claudeOptionsLabel } from "./recipes.js";
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

// The shells the app's program table knows (programs.json "shells").
const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "nu", "pwsh", "powershell", "cmd", "elvish", "xonsh", "tcsh", "csh", "ksh", "ion"]);
// hc's configured shell (suspend/herdr-shell), a script that sh runs.
export const HERDR_SHELL = "herdr-shell";
/** @param {unknown} word */
const programName = (word) => typeof word === "string" ? word.split(/[\\/]/).pop().replace(/^-/, "") : "";

// What runs in front of a terminal, from its foreground process, never from a
// status report: { name, shell }, or null when hc gave no foreground argv. A
// launch wrapper (sh -c '"$@"; exec ...' sh <command>: the stand-in's wake for
// root=shell, and the app's own launchers) counts as the command it runs.
// t: from terminals() or hc get.
/** @param {Record<string, any> | null | undefined} t @returns {{ name: string, shell: boolean } | null} */
export function frontProgram(t) {
  let argv = t?.foreground?.argv;
  if (!Array.isArray(argv) || !argv.length) return null;
  while (argv.length > 4 && SHELLS.has(programName(argv[0])) && /^-[a-z]*c$/.test(argv[1]) &&
    typeof argv[2] === "string" && (argv[2].includes('"$@"') || argv[2].startsWith("command $argv[2..]"))) argv = argv.slice(4);
  if (SHELLS.has(programName(argv[0])) && programName(argv[1]) === HERDR_SHELL) return { name: HERDR_SHELL, shell: false };
  const name = programName(argv[0]) || (typeof t.foreground.name === "string" ? t.foreground.name : "");
  return { name, shell: SHELLS.has(name) };
}

/** @param {Record<string, any> | null | undefined} t */
export const standinInFront = (t) => frontProgram(t)?.name === STANDIN_APP || t?.foreground?.name === STANDIN_APP;

// The stand-in's own report (terminals() keeps it in report, hc get in
// status), in any state.
/** @param {Record<string, any> | null | undefined} t */
const standinReport = (t) => (t?.report?.app ?? t?.status?.app) === STANDIN_APP;
/** @param {Record<string, any> | null | undefined} t */
const stateOf = (t) => typeof t?.status === "string" ? t.status : t?.status?.state ?? t?.report?.state ?? null;

// A wake shows as waking for at most this long after it began, unless the
// stand-in is still in front.
export const WAKE_MS = 30_000;

// Whether a stand-in is waking its agent: its "working" report is there (it
// stays after the stand-in replaced itself, until the woken agent reports,
// fact F5), and either the stand-in is still in front, or the wake (that
// report, at status_ms) began less than WAKE_MS ago. After that the report is
// stale: the woken agent exited, or it never reported (Claude can miss its
// status handshake), and what runs in front tells what the terminal is.
/** @param {Record<string, any> | null | undefined} t @param {number} now */
export function waking(t, now) {
  if (!standinReport(t) || stateOf(t) !== "working") return false;
  return standinInFront(t) || (Number.isFinite(t.status_ms) && now - t.status_ms < WAKE_MS);
}

// A stand-in holds the terminal (GLOSSARY.md): it carries the suspension
// label, or its own report is still there and no shell is in front, or it is
// waking the agent (it removes the label just before it replaces itself). A
// stand-in is the terminal's main program, so atShell() passes for it:
// recovery must never type into it. A stale wake report with a shell in front
// (the woken agent exited) does not hold the terminal.
const standin = (j, now = Date.now()) => Object.hasOwn(j?.labels ?? {}, SUSPENDED) ||
  (standinReport(j) && (waking(j, now) || !frontProgram(j)?.shell));

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
    if (!atShell(out) || standin(out)) return; // it didn't quit: leave it as it is
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
      // Read the terminal just before typing: a ↻ shown before a suspension
      // (a stale click) must not type into the stand-in.
      if (agent !== "pi") return enqueue(async () => {
        const current = await info(address);
        check();
        if (!current || standin(current)) return;
        await attempt(cx, address, recoveryLine(agent, labels, { tab }), check);
      });
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
        if (!current || current.state !== "live" || !atShell(current) || standin(current)) return;
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
export async function claudeLaunch(address, expected) {
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

// Writes what changed of a claudeLaunch result, in one label call: the
// session, and the options (removed when the process has none).
export async function rememberClaudeLaunch(address, { id, options }, labels = {}) {
  const changes = [];
  if (labels[SESSION] !== id) changes.push(`${SESSION}=${id}`);
  if ((labels[CLAUDE_OPTIONS] ?? null) !== options) changes.push(`${CLAUDE_OPTIONS}=${options ?? ""}`);
  return changes.length ? hc(["label", address, ...changes]) : null;
}
