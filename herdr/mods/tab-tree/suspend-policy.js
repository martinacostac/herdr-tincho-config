// The suspension policy (GLOSSARY.md: Suspend, Unused agent, Wake), run by
// the tab-tree mod. The eligibility rules say which agents are unused agents;
// each rule that fails gives its own reason, so "Suspend now" can say what to
// change. createSuspender() runs the rules on a timer: one copy of the mod
// leads, suspends unused agents in ordered steps, and wakes a suspended agent
// whose tab stays focused.

import { settings, focused, panes, terminals, shared, setShared, readTextFile, exec, hc } from "herdr";
import { SESSION, PI_RECOVERY, SUSPENDED, piRecovery, suspension } from "./recipes.js";
import { isClaude } from "./claude-polling.js";

export const NEVER_SUSPEND = "herdr.never-suspend";

// Remote addresses carry their machine: mini/t7. Suspension acts only on
// this machine's core.
/** @param {string} address */
const remote = (address) => address.includes("/");

/** @param {unknown} s */
const printable = (s) => typeof s === "string" && s.length > 0 && !/[\x00-\x1f\x7f]/.test(s);

// The agent running now, from its own report (terminals() keeps it in report,
// hc get in status), else from the program table. Never from the last-agent
// label: that describes an agent the terminal may have lost.
/** @param {Record<string, any>} t @returns {"claude" | "pi" | null} */
function agentOf(t) {
  if (isClaude(t)) return "claude";
  const app = t?.report?.app ?? t?.status?.app;
  const key = typeof app === "string" && app ? app : t?.program?.agent ? t.program.key : null;
  return /^pi$/i.test(key ?? "") ? "pi" : null;
}

// Its session, so a wake continues the same conversation (never a picker).
/** @type {Record<"claude" | "pi", (labels: Record<string, string>) => boolean>} */
const RESUMABLE = {
  claude: (labels) => printable(labels[SESSION]),
  pi: (labels) => piRecovery(labels[PI_RECOVERY]) !== null,
};

// The terminals being looked at in this copy's window: the one with the
// keyboard or shown, and every terminal of a pane in the focused tab. A
// terminal in no pane is in no tab.
/** @returns {Set<string>} */
function focusedHere() {
  const f = focused();
  const here = new Set();
  if (!f) return here;
  for (const address of [f.terminal, f.shown, f.agent]) if (typeof address === "string" && address) here.add(address);
  for (const p of panes()) if (p.tab === f.tab && typeof p.terminal === "string" && p.terminal) here.add(p.terminal);
  return here;
}

const MINUTE = 60_000;
/** @param {Record<string, any>} t @returns {string | null} */
const statusOf = (t) => typeof t?.status === "string" ? t.status : t?.status?.state ?? null;

// Why an agent is not an unused agent, one reason per rule, checked in this
// order: automatic suspension is off, a remote terminal, already suspended
// (the label is set), not resumable, pinned, in the focused tab, working, blocked, not idle (no agent status),
// idle for less than the threshold (or no status time), a process table that
// cannot be read, and a descendant process that is not a helper.
/** @typedef {"off" | "remote" | "suspended" | "not-resumable" | "pinned" | "focused" | "working" | "blocked" | "not-idle" | "recent" | "background" | "processes-unknown"} Reason */
/** @typedef {{ unused: true, agent: "claude" | "pi" } | { unused: false, reason: Reason }} Verdict */

// terminal: from terminals() or hc get (status as a word or as an object;
// foreground.pid is needed for the process check). focusedAt: the last time
// (ms) the terminal's tab was focused, null when unknown (after an app
// restart). manual: "Suspend now", which skips only the threshold and works
// while automatic suspension is off. focusedTerminals: the terminals in the
// focused tab of any window (each copy of the mod sees only its own window's
// focus). checkProcesses false skips the process rule, so no process is read:
// the verdict then holds except for that rule.
/**
 * @param {Record<string, any>} terminal
 * @param {{ now?: number, focusedAt?: number | null, manual?: boolean, focusedTerminals?: Set<string> | null, checkProcesses?: boolean }} [options]
 * @returns {Promise<Verdict>}
 */
export async function unusedAgent(terminal, { now = Date.now(), focusedAt = null, manual = false, focusedTerminals = null, checkProcesses = true } = {}) {
  const config = suspendSettings();
  if (!manual && !config.auto) return { unused: false, reason: "off" };
  if (typeof terminal.address !== "string" || remote(terminal.address)) return { unused: false, reason: "remote" };
  const labels = terminal.labels ?? {};
  if (Object.hasOwn(labels, SUSPENDED)) return { unused: false, reason: "suspended" };
  const agent = agentOf(terminal);
  if (!agent || !RESUMABLE[agent](labels)) return { unused: false, reason: "not-resumable" };
  if (labels[NEVER_SUSPEND] === "1") return { unused: false, reason: "pinned" };
  if (focusedHere().has(terminal.address) || focusedTerminals?.has(terminal.address)) return { unused: false, reason: "focused" };
  const status = statusOf(terminal);
  if (status === "working") return { unused: false, reason: "working" };
  if (status === "blocked") return { unused: false, reason: "blocked" };
  if (status !== "idle" && status !== "done") return { unused: false, reason: "not-idle" };
  // Idle since its last status change, or since its tab was last focused when
  // that is later: an agent someone was just reading is not unused yet.
  // "Suspend now" (manual) skips only this rule.
  if (!manual) {
    if (!Number.isFinite(terminal.status_ms)) return { unused: false, reason: "recent" };
    const since = Math.max(terminal.status_ms, Number.isFinite(focusedAt) ? focusedAt : -Infinity);
    if (now - since < config.afterMinutes * MINUTE) return { unused: false, reason: "recent" };
  }
  if (!checkProcesses) return { unused: true, agent };
  const allHelpers = onlyHelpers(await processTable(), terminal.foreground?.pid, config.helpers);
  if (allHelpers === null) return { unused: false, reason: "processes-unknown" };
  if (!allHelpers) return { unused: false, reason: "background" };
  return { unused: true, agent };
}

/** @typedef {{ pids: Set<number>, children: Map<number, { pid: number, command: string }[]> }} ProcessTable */

// Every process on this machine with its parent and command line, or null
// when ps cannot be read.
/** @returns {Promise<ProcessTable | null>} */
async function processTable() {
  const r = await exec("ps", ["-axo", "pid=,ppid=,command="]).catch(() => /** @type {null} */ (null));
  if (r?.code !== 0 || typeof r.stdout !== "string") return null;
  /** @type {ProcessTable} */
  const table = { pids: new Set(), children: new Map() };
  for (const line of r.stdout.split("\n")) {
    // A process without a command line (a zombie) still counts, as no helper.
    const m = /^\s*(\d+)\s+(\d+)(?:\s(.*))?$/.exec(line);
    if (!m) continue;
    const [pid, ppid] = [Number(m[1]), Number(m[2])];
    table.pids.add(pid);
    if (!table.children.has(ppid)) table.children.set(ppid, []);
    table.children.get(ppid).push({ pid, command: m[3] ?? "" });
  }
  return table;
}

// Whether every descendant process of the agent (its foreground program, not
// the shell that hosts it) is a helper: its command line, or the command line
// of an ancestor between it and the agent, contains an entry of the
// allow-list. So the children of an MCP server (uvx -> python) are part of
// that helper, and only the agent's direct children need to match. Null when
// the process table cannot tell.
/** @param {ProcessTable | null} table @param {number} agentPid @param {string[]} helpers @returns {boolean | null} */
function onlyHelpers(table, agentPid, helpers) {
  if (!table || !Number.isSafeInteger(agentPid) || agentPid <= 0 || !table.pids.has(agentPid)) return null;
  return (table.children.get(agentPid) ?? []).every((child) => helpers.some((h) => child.command.includes(h)));
}

const DEFAULT_MINUTES = 30;
const DEFAULT_HELPERS = ["mcp"];

// The app setting "tincho.suspend": { after_minutes, helpers }. false or
// after_minutes 0 turns automatic suspension off (afterMinutes null); the
// helper allow-list still applies to manual suspension. A missing or invalid
// field keeps its default. An empty helper would match every command line.
/** @returns {{ auto: boolean, afterMinutes: number | null, helpers: string[] }} */
export function suspendSettings() {
  const value = settings()?.["tincho.suspend"];
  /** @type {Record<string, any>} */
  const fields = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const helpers = Array.isArray(fields.helpers) && fields.helpers.every((h) => typeof h === "string")
    ? fields.helpers.filter((h) => h.length > 0) : [...DEFAULT_HELPERS];
  const minutes = fields.after_minutes;
  if (value === false || minutes === 0) return { auto: false, afterMinutes: null, helpers };
  const afterMinutes = typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_MINUTES;
  return { auto: true, afterMinutes, helpers };
}

// The signal that ends the terminal's main program (the agent, or the shell
// that hosts it). Fact F3: hc treats SIGTERM as a loss for both, so a kept
// terminal starts its configured shell (herdr-shell) in place.
const SIGNAL = "TERM";

/** @param {string} address @returns {Promise<Record<string, any> | null>} */
async function coreTerminal(address) {
  const r = await hc(["get", address, "--json"]).catch(() => /** @type {null} */ (null));
  try { return r?.code === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
}

/** @param {Promise<{ code: number } | null>} run */
const succeeds = async (run) => (await run.catch(() => /** @type {null} */ (null)))?.code === 0;

// The first word of herdr-core's `shell` setting, or null. hc reads it as a
// word list (shell = ["nu"]) among the top-level keys of config.toml. This is
// a small TOML reader for that one key: basic and literal strings, an array
// over several lines, and comments.
/** @param {unknown} text @returns {string | null} */
function configuredShell(text) {
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // A table header ends the top-level keys.
    if (/^\s*\[/.test(lines[i])) return null;
    const key = /^\s*(?:shell|"shell"|'shell')\s*=\s*/.exec(lines[i]);
    if (!key) continue;
    const value = [lines[i].slice(key[0].length), ...lines.slice(i + 1)].join("\n");
    const first = /^\[(?:\s|#[^\n]*\n)*("(?:[^"\\\n]|\\.)*"|'[^'\n]*')/.exec(value);
    if (!first) return null;
    const quoted = first[1];
    if (quoted.startsWith("'")) return quoted.slice(1, -1);
    try { return JSON.parse(quoted); } catch { return null; }
  }
  return null;
}

// Prints the bin folder the installer puts the stand-in and the launcher in,
// and herdr-core's config file, in the user's environment. Exits 0 only when
// both programs are there.
const INSTALL_PATHS = `bin="\${XDG_DATA_HOME:-$HOME/.local/share}/herdr-tincho-config/bin"
printf '%s\\n%s\\n' "$bin" "\${XDG_CONFIG_HOME:-$HOME/.config}/herdr-core/config.toml"
test -x "$bin/herdr-standin" && test -x "$bin/herdr-shell"`;

// Whether suspension can work: the stand-in and herdr-shell are installed,
// and herdr-shell is hc's configured shell. Otherwise a lost agent would come
// back as a plain shell, and a message would run in it.
/** @returns {Promise<boolean>} */
async function suspensionInstalled() {
  const r = await exec("sh", ["-c", INSTALL_PATHS]).catch(() => /** @type {null} */ (null));
  if (r?.code !== 0) return false;
  const [bin, config] = r.stdout.split("\n");
  if (!bin?.startsWith("/") || !config?.startsWith("/")) return false;
  const text = await readTextFile(config).catch(() => /** @type {null} */ (null));
  return configuredShell(text) === `${bin}/herdr-shell`;
}

/** @typedef {Reason | "not-installed" | "gone" | "changed" | "failed" | "closed"} Outcome */

// Shared state (setShared/shared) between the copies of the mod, one per
// window that shows tab-tree.
//
// WINDOWS: each copy's entry, by its id, with a heartbeat:
//   { [id]: { at: ms, focused: { [address]: ms }, seen: { [address]: ms } } }
//   focused: the terminals in its window's focused tab now, each with the
//   time since when it has been there without a break. seen: the last time
//   each terminal left its window's focused tab (the idle clock).
// A copy writes its entry when its window's focus changes, and at least every
// HEARTBEAT_MS (from the pass). An entry older than STALE_MS is ignored (a
// copy that stopped without closing, or one from before an app restart).
export const SUSPEND_WINDOWS = "tincho.suspend.windows";
const HEARTBEAT_MS = 60_000;
const STALE_MS = 150_000;
// A last-focus time older than this never holds back a suspension (unless
// the threshold is longer).
const SEEN_MS = 24 * 60 * MINUTE;

// A suspended agent wakes when its tab stays focused this long. Stepping past
// tabs (⌘P, the next-agent command) moves on sooner and wakes nothing.
const WAKE_FOCUS_MS = 1_000;
// The app name the stand-in reports (suspend/standin.ts).
export const STANDIN_APP = "herdr-standin";

// A stand-in that waits for a message: the suspension label, and an idle
// report from the stand-in itself (not "working" while it wakes the agent,
// nor "blocked" when the session is missing).
/** @param {Record<string, any> | undefined} t */
const idleStandin = (t) => Object.hasOwn(t?.labels ?? {}, SUSPENDED) &&
  (t?.report?.app ?? t?.status?.app) === STANDIN_APP && statusOf(t) === "idle";

/** @typedef {{ at: number, focused: Record<string, number>, seen: Record<string, number> }} WindowEntry */

// The entry point for other mods (ticket 09's "Suspend now" menu item).
//
// SUSPEND_REQUESTS, written by any mod: { [address]: ms }. Set a terminal's
// value to Date.now() to request a manual suspension of it: every rule
// applies except the threshold, also while automatic suspension is off. The
// leader handles each request once, as soon as it re-renders after the
// setShared; a request older than REQUEST_MS is ignored, so a request made
// while no copy leads never acts much later. Never remove another mod's
// entries: replace your own value.
//
// SUSPEND_STATE, written by the leader only:
//   { agents: { [address]: { auto: Outcome | null, manual: Outcome | null } },
//     results: { [address]: { requested: ms, suspended: boolean, reason: Outcome | null, at: ms } } }
//   agents: each local agent's current reason, from the last pass (every
//   15 s): auto for automatic suspension, manual for "Suspend now". null
//   means no rule fails, except maybe the process rule: to keep the pass
//   cheap, the process table is read only for an agent about to be
//   suspended, so "background" and "processes-unknown" show up only after an
//   attempt (and in results). results: the outcome of the latest request for
//   each terminal (requested is the request's value), kept for RESULT_MS.
// A reason is an Outcome: a rule from unusedAgent(), or "not-installed" (the
// stand-in or herdr-shell is missing, or herdr-shell is not hc's shell; in
// agents only after a pass had an agent past its threshold),
// "gone" (the terminal ended), "changed" (its status, turn or program changed
// during the steps), "failed" (an hc command or the signal failed), or
// "closed" (the mod closed).
export const SUSPEND_REQUESTS = "tincho.suspend.requests";
export const SUSPEND_STATE = "tincho.suspend.state";
const REQUEST_MS = 60_000;
const RESULT_MS = 10 * 60_000;
// After the process rule refused an agent (background processes), the pass reads
// the process table for it again only after this long.
const PROCESS_RETRY_MS = 5 * 60_000;

/** @typedef {{ requested: number, suspended: boolean, reason: Outcome | null, at: number }} RequestResult */
/** @typedef {{ agents: Record<string, { auto: Outcome | null, manual: Outcome | null }>, results: Record<string, RequestResult> }} SuspendState */

/** @param {unknown} value @returns {Record<string, any>} */
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? /** @type {any} */ (value) : {};

/** @returns {SuspendState} */
function currentState() {
  const value = record(shared(SUSPEND_STATE));
  return { agents: record(value.agents), results: record(value.results) };
}

/** @typedef {{ suspended: true } | { suspended: false, reason: Outcome }} SuspendOutcome */

// The reason of a verdict or of a suspension's outcome, null when it passed.
/** @param {Verdict | SuspendOutcome} result @returns {Outcome | null} */
const reasonOf = (result) => "reason" in result ? result.reason : null;

/** @returns {Record<string, WindowEntry>} */
const windowEntries = () => record(shared(SUSPEND_WINDOWS));

/** @param {unknown} entry @param {number} now @returns {entry is WindowEntry} */
const fresh = (entry, now) => Number.isFinite(/** @type {any} */ (entry)?.at) && now - /** @type {any} */ (entry).at < STALE_MS;

/** @param {string} address @returns {Record<string, any> | undefined} */
const terminalAt = (address) => terminals().find((t) => t?.address === address);

/** @param {Record<string, any>} t */
const localAgent = (t) => typeof t?.address === "string" && !remote(t.address) && Boolean(t.program?.agent || t.report);

/** @typedef {(ms: number, run: () => unknown) => { cancel(): void }} Schedule */

/**
 * One copy of the policy, for one copy of the mod. No timer of its own runs
 * more often than the pass:
 * - observe(), from render: reads this window's focus, the other copies'
 *   entries and the manual requests. It changes nothing outside this copy and
 *   returns true when act() has work.
 * - act({ schedule }), outside render (cx.spawn): publishes this copy's
 *   entry, and the leader arms or cancels wake timers (one 1 s timer per
 *   focused suspended agent) and handles manual requests.
 * - pass(), every 15 s: the heartbeat, and the leader's shared reasons and
 *   automatic suspension. It reads no process when no agent qualifies.
 * @param {{ id?: string, clock?: () => number }} [options]
 */
export function createSuspender({ id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, clock = Date.now } = {}) {
  let closed = false;
  /** @type {Map<string, number>} */
  const since = new Map(); // this window's focused terminals -> since when
  /** @type {Map<string, number>} */
  const seen = new Map(); // terminal -> when it last left this window's focused tab
  let published = -Infinity;
  let focusChanged = true; // the entry must be (re)published
  let due = false; // observe() asked for an act()
  let passing = false;
  /** @type {Set<string>} */
  const requesting = new Set(); // terminals whose request this copy is handling
  /** @type {Map<string, { since: number, timer: { cancel(): void } | null }>} */
  const wakes = new Map(); // focused suspended terminal -> its focus's wake timer (null once fired)
  /** @type {boolean | null} */
  let installed = null; // from the last pass that had an agent past its threshold
  /** @type {Map<string, { key: string, reason: Outcome, at: number }>} */
  const heldBack = new Map(); // terminal -> the process rule that refused it last, for which process
  // Suspensions run one at a time.
  let queue = Promise.resolve();
  /** @template T @param {() => Promise<T>} job @returns {Promise<T>} */
  const serial = (job) => {
    const run = queue.then(job);
    queue = run.then(() => {}, () => {});
    return run;
  };

  // This window's focus, into memory. True when it changed.
  /** @param {number} now */
  function track(now) {
    const here = focusedHere();
    let changed = false;
    for (const address of [...since.keys()]) {
      if (here.has(address)) continue;
      since.delete(address);
      seen.set(address, now);
      changed = true;
    }
    for (const address of here) if (!since.has(address)) { since.set(address, now); changed = true; }
    const keep = Math.max(SEEN_MS, (suspendSettings().afterMinutes ?? 0) * MINUTE);
    for (const [address, at] of seen) if (now - at >= keep) seen.delete(address);
    return changed;
  }

  // Reads the entries, replaces its own and drops stale ones, with no await
  // in between: the copies share one script runtime (resume.js), so no other
  // copy writes in the middle. observe() repairs an entry that a write lost.
  /** @param {number} now */
  function publish(now) {
    focusChanged = false;
    /** @type {Record<string, WindowEntry>} */
    const entries = {};
    for (const [other, entry] of Object.entries(windowEntries())) if (other !== id && fresh(entry, now)) entries[other] = entry;
    entries[id] = { at: now, focused: Object.fromEntries(since), seen: Object.fromEntries(seen) };
    setShared(SUSPEND_WINDOWS, entries);
    published = now;
  }

  // The leader: the copy with the lowest id among the fresh entries. A copy
  // whose own entry is missing or stale never leads.
  /** @param {number} [now] */
  function leading(now = clock()) {
    if (closed) return false;
    const ids = Object.entries(windowEntries()).filter(([, entry]) => fresh(entry, now)).map(([other]) => other);
    return ids.includes(id) && ids.every((other) => other >= id);
  }

  // The focus of every window: the terminals focused now (with the earliest
  // time since when), and when each terminal last left a focused tab. This
  // copy's own window counts from memory.
  /** @param {number} now */
  function focusView(now) {
    const focused = new Map(since);
    const last = new Map(seen);
    for (const [other, entry] of Object.entries(windowEntries())) {
      if (other === id || !fresh(entry, now)) continue;
      for (const [address, at] of Object.entries(record(entry.focused))) {
        if (Number.isFinite(at)) focused.set(address, Math.min(focused.get(address) ?? Infinity, at));
      }
      for (const [address, at] of Object.entries(record(entry.seen))) {
        if (Number.isFinite(at)) last.set(address, Math.max(last.get(address) ?? -Infinity, at));
      }
    }
    return { focused, last };
  }

  /** @param {ReturnType<typeof focusView>} view @param {string} address */
  const rulesInput = (view, address) => ({ focusedAt: view.last.get(address) ?? null, focusedTerminals: new Set(view.focused.keys()) });

  // The focused suspended agents to wake: address -> since when focused.
  /** @param {number} now */
  function wakeTargets(now) {
    /** @type {Map<string, number>} */
    const targets = new Map();
    const { focused } = focusView(now);
    if (!focused.size) return targets;
    for (const [address, at] of focused) if (!remote(address) && idleStandin(terminalAt(address))) targets.set(address, at);
    return targets;
  }

  // The requests in SUSPEND_REQUESTS that wait for this copy: [address, requested].
  /** @param {number} now @returns {[string, number][]} */
  function newRequests(now) {
    const requests = Object.entries(record(shared(SUSPEND_REQUESTS)));
    if (!requests.length) return [];
    const { results } = currentState();
    return requests.filter(([address, requested]) => Number.isFinite(requested) && now - requested < REQUEST_MS &&
      requested - now < STALE_MS && !requesting.has(address) && !((results[address]?.requested ?? -Infinity) >= requested));
  }

  // For render: records this window's focus, and says whether act() has work
  // (once, until act() runs). Changes nothing outside this copy.
  /** @param {number} [now] */
  function observe(now = clock()) {
    if (closed) return false;
    if (track(now)) focusChanged = true;
    // Another copy's write dropped this copy's entry: write it again.
    if (published > -Infinity && !Object.hasOwn(windowEntries(), id)) focusChanged = true;
    let work = focusChanged;
    if (!work && leading(now)) {
      const targets = wakeTargets(now);
      work = [...targets].some(([address, at]) => wakes.get(address)?.since !== at) ||
        [...wakes.keys()].some((address) => !targets.has(address)) || newRequests(now).length > 0;
    } else if (!work) {
      work = wakes.size > 0;
    }
    if (!work || due) return false;
    due = true;
    return true;
  }

  // The leader presses an empty Enter in the stand-in of a suspended agent
  // whose tab is still focused since the same time, in any window.
  /** @param {string} address @param {number} at */
  async function wakeIfStillFocused(address, at) {
    const now = clock();
    // The focus as it is now, also when no render followed its last change.
    if (track(now)) focusChanged = true;
    if (!leading(now) || wakeTargets(now).get(address) !== at) return;
    await hc(["keys", address, "enter"]).catch(() => /** @type {null} */ (null));
  }

  /** @param {(state: SuspendState) => Partial<SuspendState>} change @param {number} now */
  function writeState(change, now) {
    const current = currentState();
    const next = { ...current, ...change(current) };
    next.results = Object.fromEntries(Object.entries(next.results).filter(([, r]) => now - r?.at < RESULT_MS));
    if (JSON.stringify(next) !== JSON.stringify(current)) setShared(SUSPEND_STATE, next);
  }

  // The leader handles each new manual request once and shares its result.
  /** @param {number} now */
  async function handleRequests(now) {
    await Promise.all(newRequests(now).map(([address, requested]) => {
      requesting.add(address);
      return serial(async () => {
        const outcome = await suspend(address, { now, manual: true });
        if (closed) return;
        /** @type {RequestResult} */
        const result = { requested, suspended: outcome.suspended, reason: reasonOf(outcome), at: now };
        writeState((state) => ({ results: { ...state.results, [address]: result } }), now);
      }).finally(() => requesting.delete(address));
    }));
  }

  // The work observe() found, outside render. schedule(ms, run) starts a
  // one-shot timer (cx.timer.after) and returns it.
  /** @param {{ now?: number, schedule: Schedule }} options */
  async function act({ now = clock(), schedule }) {
    due = false;
    if (closed) return;
    if (focusChanged) publish(now);
    const lead = leading(now);
    const targets = lead ? wakeTargets(now) : new Map();
    // One timer per focus of a suspended agent: cancelled when the focus moves.
    for (const [address, wake] of wakes) {
      if (targets.get(address) === wake.since) continue;
      wake.timer?.cancel();
      wakes.delete(address);
    }
    for (const [address, at] of targets) {
      if (wakes.has(address)) continue;
      const wake = { since: at, timer: /** @type {{ cancel(): void } | null} */ (null) };
      wakes.set(address, wake);
      wake.timer = schedule(Math.max(0, at + WAKE_FOCUS_MS - now), () => {
        wake.timer = null;
        return wakeIfStillFocused(address, at);
      });
    }
    if (lead) await handleRequests(now);
  }

  // The ordered suspension steps. Any failed check aborts, and nothing more
  // is changed (an earlier keep stays: it is harmless). One exception: when
  // the signal fails while the agent still runs, the label comes off again;
  // otherwise the sidebar would show a live agent as suspended.
  /**
   * @param {string} address
   * @param {{ now?: number, manual?: boolean }} [options]
   * @returns {Promise<SuspendOutcome>}
   */
  async function suspend(address, { now = clock(), manual = false } = {}) {
    /** @param {Outcome} reason */
    const abort = (reason) => ({ suspended: /** @type {false} */ (false), reason });
    if (!await suspensionInstalled()) return abort("not-installed");
    if (closed) return abort("closed");
    // 1. Read the terminal again: still an unused agent.
    const before = await coreTerminal(address);
    if (closed) return abort("closed");
    if (before?.state !== "live") return abort("gone");
    const verdict = await unusedAgent(before, { now, manual, ...rulesInput(focusView(now), address) });
    if (closed) return abort("closed");
    if ("reason" in verdict) return abort(verdict.reason);
    const pid = before.pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) return abort("processes-unknown");
    // A shell hosts the agent when the main program is not the agent itself.
    const root = pid === before.foreground?.pid ? "agent" : "shell";
    const label = suspension(JSON.stringify({ version: 1, agent: verdict.agent, root, cwd: before.foreground?.cwd, since: now }));
    if (!label) return abort("not-resumable");
    // 2. Keep the terminal, so the signal leaves it live.
    if (!await succeeds(hc(["keep", address]))) return abort("failed");
    if (closed) return abort("closed");
    // 3. Read status and turn again: no change since step 1.
    const after = await coreTerminal(address);
    if (closed) return abort("closed");
    if (after?.state !== "live") return abort("gone");
    if (statusOf(after) !== statusOf(before) || after.turn !== before.turn || after.pid !== pid ||
        after.foreground?.pid !== before.foreground?.pid) return abort("changed");
    // 4. The record herdr-shell and the stand-in read.
    if (!await succeeds(hc(["label", address, `${SUSPENDED}=${JSON.stringify(label)}`]))) return abort("failed");
    if (closed) return abort("closed");
    // 5. End the main program: hc starts herdr-shell, which starts the stand-in.
    if (!await succeeds(exec("kill", [`-${SIGNAL}`, String(pid)]))) {
      // The signal also fails when the main program already ended: then hc
      // starts herdr-shell, which needs the label to start the stand-in.
      const now = await coreTerminal(address);
      const ended = now && (now.state !== "live" || now.pid !== pid);
      if (!ended) await hc(["label", address, `${SUSPENDED}=`]).catch(() => /** @type {null} */ (null));
      return abort("failed");
    }
    return { suspended: true };
  }

  // Which process an agent runs: a process-rule result holds for it only.
  /** @param {Record<string, any>} t */
  const processKey = (t) => `${t.foreground?.pid}:${t.status_ms}`;

  // Every 15 s: the heartbeat, then the leader shares each local agent's
  // reasons and suspends the unused agents one at a time. Without an agent
  // past its threshold it starts no process: the installation is checked
  // only then, so "not-installed" shows in the reasons from that check on.
  /** @param {number} [now] */
  async function pass(now = clock()) {
    if (closed) return;
    if (focusChanged || now - published >= HEARTBEAT_MS) publish(now);
    if (passing || !leading(now)) return;
    passing = true;
    try {
      const { auto } = suspendSettings();
      const view = focusView(now);
      /** @type {SuspendState["agents"]} */
      const agents = {};
      /** @type {string[]} */
      const candidates = [];
      for (const terminal of terminals()) {
        if (!localAgent(terminal)) continue;
        const address = terminal.address;
        const input = { now, checkProcesses: false, ...rulesInput(view, address) };
        /** @type {Outcome | null} */
        let manual = reasonOf(await unusedAgent(terminal, { ...input, manual: true }));
        /** @type {Outcome | null} */
        let automatic = auto ? reasonOf(await unusedAgent(terminal, input)) : "off";
        if (closed) return;
        const previous = heldBack.get(address);
        if (previous && previous.key !== processKey(terminal)) heldBack.delete(address);
        const held = heldBack.get(address);
        if (held) {
          manual ??= held.reason;
          // Read its processes again only after a while.
          if (automatic === null && now - held.at < PROCESS_RETRY_MS) automatic = held.reason;
        }
        agents[address] = { auto: automatic, manual };
        if (automatic === null) candidates.push(address);
      }
      for (const address of heldBack.keys()) if (!Object.hasOwn(agents, address)) heldBack.delete(address);
      if (candidates.length) {
        installed = await suspensionInstalled();
        if (closed) return;
      }
      if (installed === false) {
        for (const reasons of Object.values(agents)) {
          if (reasons.auto === null) reasons.auto = "not-installed";
          if (reasons.manual === null) reasons.manual = "not-installed";
        }
      }
      writeState(() => ({ agents }), now);
      if (!installed) return;
      for (const address of candidates) {
        if (closed || !leading(now)) return;
        const outcome = await serial(() => suspend(address, { now }));
        const terminal = terminalAt(address);
        const reason = reasonOf(outcome);
        if ((reason === "background" || reason === "processes-unknown") && terminal) {
          heldBack.set(address, { key: processKey(terminal), reason, at: now });
        }
      }
    } finally {
      passing = false;
    }
  }

  return {
    id,
    observe,
    act,
    pass,
    leading,
    suspend,
    // Cancels the wake timers and removes this copy's entry, so another copy
    // leads at once.
    close() {
      if (closed) return;
      closed = true;
      for (const wake of wakes.values()) wake.timer?.cancel();
      wakes.clear();
      const entries = windowEntries();
      if (!Object.hasOwn(entries, id)) return;
      delete entries[id];
      setShared(SUSPEND_WINDOWS, entries);
    },
  };
}
