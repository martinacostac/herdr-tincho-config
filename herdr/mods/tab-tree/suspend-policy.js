// Which agents are unused agents (GLOSSARY.md): the eligibility rules of the
// suspension policy. Each rule that fails gives its own reason, so "Suspend
// now" can say what to change. Not connected to the mod yet.

import { settings, focused, panes, exec } from "herdr";
import { SESSION, PI_RECOVERY, piRecovery } from "./recipes.js";
import { isClaude } from "./claude-polling.js";

export const NEVER_SUSPEND = "herdr.never-suspend";

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

// The agent being looked at: its terminal has the keyboard or is shown, or a
// pane in the focused tab shows it. A terminal in no pane is in no tab.
/** @param {string} address */
function inFocusedTab(address) {
  const f = focused();
  if (!f) return false;
  if ([f.terminal, f.shown, f.agent].includes(address)) return true;
  return panes().some((p) => p.terminal === address && p.tab === f.tab);
}

const MINUTE = 60_000;
/** @param {Record<string, any>} t @returns {string | null} */
const statusOf = (t) => typeof t?.status === "string" ? t.status : t?.status?.state ?? null;

// Why an agent is not an unused agent, one reason per rule, checked in this
// order: automatic suspension is off, a remote terminal, not resumable,
// pinned, in the focused tab, working, blocked, not idle (no agent status),
// idle for less than the threshold (or no status time), a process table that
// cannot be read, and a descendant process that is not a helper.
/** @typedef {"off" | "remote" | "not-resumable" | "pinned" | "focused" | "working" | "blocked" | "not-idle" | "recent" | "background" | "processes-unknown"} Reason */
/** @typedef {{ unused: true, agent: "claude" | "pi" } | { unused: false, reason: Reason }} Verdict */

// terminal: from terminals() or hc get (status as a word or as an object;
// foreground.pid is needed for the process check). focusedAt: the last time
// (ms) the terminal's tab was focused, null when unknown (after an app
// restart). manual: "Suspend now", which skips only the threshold and works
// while automatic suspension is off.
/**
 * @param {Record<string, any>} terminal
 * @param {{ now?: number, focusedAt?: number | null, manual?: boolean }} [options]
 * @returns {Promise<Verdict>}
 */
export async function unusedAgent(terminal, { now = Date.now(), focusedAt = null, manual = false } = {}) {
  const config = suspendSettings();
  if (!manual && !config.auto) return { unused: false, reason: "off" };
  // Suspension acts only on this machine's core (remote addresses: machine/t7).
  if (typeof terminal.address !== "string" || terminal.address.includes("/")) return { unused: false, reason: "remote" };
  const agent = agentOf(terminal);
  const labels = terminal.labels ?? {};
  if (!agent || !RESUMABLE[agent](labels)) return { unused: false, reason: "not-resumable" };
  if (labels[NEVER_SUSPEND] === "1") return { unused: false, reason: "pinned" };
  if (inFocusedTab(terminal.address)) return { unused: false, reason: "focused" };
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
  const allHelpers = await onlyHelpers(terminal.foreground?.pid, config.helpers);
  if (allHelpers === null) return { unused: false, reason: "processes-unknown" };
  if (!allHelpers) return { unused: false, reason: "background" };
  return { unused: true, agent };
}

// Whether every descendant process of the agent (its foreground program, not
// the shell that hosts it) is a helper: its command line contains an entry of
// the allow-list. Null when the process table cannot tell.
/** @param {number} agentPid @param {string[]} helpers @returns {Promise<boolean | null>} */
async function onlyHelpers(agentPid, helpers) {
  if (!Number.isSafeInteger(agentPid) || agentPid <= 0) return null;
  const r = await exec("ps", ["-axo", "pid=,ppid=,command="]).catch(() => /** @type {null} */ (null));
  if (r?.code !== 0 || typeof r.stdout !== "string") return null;
  /** @type {Map<number, { pid: number, command: string }[]>} */
  const children = new Map();
  let found = false;
  for (const line of r.stdout.split("\n")) {
    // A process without a command line (a zombie) still counts, as no helper.
    const m = /^\s*(\d+)\s+(\d+)(?:\s(.*))?$/.exec(line);
    if (!m) continue;
    const [pid, ppid] = [Number(m[1]), Number(m[2])];
    if (pid === agentPid) found = true;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push({ pid, command: m[3] ?? "" });
  }
  if (!found) return null;
  const seen = new Set([agentPid]);
  const todo = [agentPid];
  while (todo.length) {
    for (const child of children.get(todo.pop()) ?? []) {
      if (seen.has(child.pid)) continue;
      if (!helpers.some((h) => child.command.includes(h))) return false;
      seen.add(child.pid);
      todo.push(child.pid);
    }
  }
  return true;
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
