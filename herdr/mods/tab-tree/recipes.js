// How each agent starts again: shared by recovery (which types it into the
// terminal's shell) and the stand-in (which replaces itself with it). The
// stand-in imports this file at build time, so it must never import "herdr",
// and a change here needs a stand-in rebuild.

// Persistent terminal labels. Agent-specific data must never cross recipes.
export const LABEL = "herdr.last-agent";
export const SESSION = "herdr.claude-session";
export const PI_RECOVERY = "herdr.pi-recovery";
export const SUSPENDED = "herdr.suspended";

// Close single quotes around escapes: sh, bash, zsh and fish agree on this,
// including literal backslashes (fish treats \\ specially inside quotes).
export const shellQuote = (s) => `'${s.replace(/[\\']/g, (c) => c === "'" ? "'\\''" : "'\\\\'")}'`;
const printable = (s) => typeof s === "string" && s.length > 0 && !/[\x00-\x1f\x7f]/.test(s);
const absolute = (s) => printable(s) && s.startsWith("/");

export function piRecovery(raw) {
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !printable(value.sessionId) || !/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(value.sessionId)) return null;
    if (value.sessionFile != null && !absolute(value.sessionFile)) return null;
    if (!absolute(value.cwd)) return null;
    if (!Array.isArray(value.args) || !value.args.every(printable)) return null;
    return value;
  } catch { return null; }
}

// The record a suspension leaves in SUSPENDED: which agent to wake, whether a
// shell hosted it ("shell") or hc started it directly ("agent"), the folder it
// ran in, and when it was suspended (ms). Anything else is not a suspension.
/** @typedef {{ version: 1, agent: "claude" | "pi", root: "shell" | "agent", cwd: string, since: number }} Suspension */
/** @param {string | undefined} raw @returns {Suspension | null} */
export function suspension(raw) {
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !["claude", "pi"].includes(value.agent) || !["shell", "agent"].includes(value.root)) return null;
    if (!absolute(value.cwd) || !Number.isSafeInteger(value.since) || value.since < 0) return null;
    return { version: 1, agent: value.agent, root: value.root, cwd: value.cwd, since: value.since };
  } catch { return null; }
}

// Whether a Pi session file still holds the recorded session, from the start
// of the file (its first line is the header). A missing or empty file would
// start a NEW conversation, and a replaced one another conversation.
/** @param {unknown} head @param {unknown} sessionId @returns {boolean} */
export function holdsPiSession(head, sessionId) {
  if (typeof head !== "string" || !printable(sessionId)) return false;
  try {
    const header = JSON.parse(head.split("\n")[0]);
    return header?.type === "session" && header.id === sessionId;
  } catch { return false; }
}

// Each start: the folder it must run in (null: any folder, the terminal's own),
// the recipe's own words, and the words that come from the terminal's records.
// Claude keeps its existing id -> tab name -> picker order.
const STARTS = {
  claude: ({ session, tab }) => ({ cwd: null, command: ["claude", "--resume"], words: session ? [session] : tab ? [tab] : [] }),
  pi: ({ recovery, picker = false }) => {
    if (!recovery) return { cwd: null, command: ["pi", "--resume"], words: [] };
    // An ID looked up from another folder can fork instead of resume. The
    // picker also needs the recorded folder when its exact file is unavailable.
    const cwd = picker || !recovery.sessionFile ? recovery.cwd : null;
    if (picker) return { cwd, command: ["pi", "--resume"], words: recovery.args };
    return { cwd, command: ["pi", "--session"], words: [recovery.sessionFile ?? recovery.sessionId, ...recovery.args] };
  },
  // Not verified on this machine:
  // codex: () => ({ cwd: null, command: ["codex", "resume", "--last"], words: [] }),
};

// What each start needs, read from the terminal's labels. A new label only
// changes this table, never the callers.
const INPUTS = {
  claude: (labels, { tab }) => ({ session: labels[SESSION], tab }),
  pi: (labels, { picker }) => ({ recovery: piRecovery(labels[PI_RECOVERY]), picker }),
};

const start = (agent, labels, options) =>
  Object.hasOwn(STARTS, agent) ? STARTS[agent](INPUTS[agent](labels ?? {}, options ?? {})) : null;

// Typed into a shell: the recipe's own words bare, every recorded word quoted.
const line = ({ cwd, command, words }) =>
  `${cwd ? `cd ${shellQuote(cwd)} && ` : ""}${[...command, ...words.map(shellQuote)].join(" ")}`;

// The folder and the command word list that start the agent, or null for an
// agent without a recipe. options: tab (Claude's tab name), picker (Pi).
/** @typedef {{ tab?: string | null, picker?: boolean }} StartOptions */
/**
 * @param {string} agent @param {Record<string, string> | undefined} labels @param {StartOptions} [options]
 * @returns {{ cwd: string | null, argv: string[] } | null}
 */
export function recipe(agent, labels, options) {
  const s = start(agent, labels, options);
  return s && { cwd: s.cwd, argv: [...s.command, ...s.words] };
}

// The same start as one shell line, as recovery types it.
/** @param {string} agent @param {Record<string, string> | undefined} labels @param {StartOptions} [options] @returns {string | null} */
export function recoveryLine(agent, labels, options) {
  const s = start(agent, labels, options);
  return s && line(s);
}

// The shell line from already parsed records: Claude's { session, tab }, Pi's
// { recovery, picker }. Its keys are the agents that have a recipe.
export const RECIPES = Object.fromEntries(Object.entries(STARTS).map(([agent, s]) => [agent, (input) => line(s(input))]));
