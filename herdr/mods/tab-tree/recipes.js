// How each agent starts again: shared by recovery (which types it into the
// terminal's shell) and the stand-in (which replaces itself with it). The
// stand-in imports this file at build time, so it must never import "herdr",
// and a change here needs a stand-in rebuild.

// Persistent terminal labels. Agent-specific data must never cross recipes.
export const LABEL = "herdr.last-agent";
export const SESSION = "herdr.claude-session";
export const PI_RECOVERY = "herdr.pi-recovery";
export const SUSPENDED = "herdr.suspended";
export const CLAUDE_OPTIONS = "herdr.claude-options";

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

// Claude's launch options: only known, reusable options, by canonical name.
// Never prompts, credentials, system prompts or session selectors. Claude's
// own parser decides the arity of each option, so an option missing from these
// lists stops capture instead of being guessed (claude --help, 2.1.325).
const same = (names) => names.map((name) => [name, name]);
// One value each.
const CLAUDE_VALUES = new Map(same(["--model", "--permission-mode", "--effort", "--fallback-model", "--agent",
  "--setting-sources", "--autocompact", "--system-prompt-snapshot", "--plugin-dir"]));
// Every following word up to the next option. Claude takes a trailing prompt
// into such a list too, so a list at the end of the words is never kept.
const CLAUDE_LISTS = new Map([...same(["--add-dir", "--allowed-tools", "--disallowed-tools", "--tools"]),
  ["--allowedTools", "--allowed-tools"], ["--disallowedTools", "--disallowed-tools"]]);
// Values that are folders, relative to the folder Claude started in.
const CLAUDE_PATHS = new Set(["--add-dir", "--plugin-dir"]);
const CLAUDE_FLAGS = new Set(["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--ax-screen-reader",
  "--bare", "--brief", "--chrome", "--no-chrome", "--disable-slash-commands", "--exclude-dynamic-system-prompt-sections",
  "--ide", "--restricted", "--safe-mode", "--strict-mcp-config", "--verbose"]);
// Dropped with their value, even one that looks like an option: prompts,
// system prompts, settings and agents that can hold secrets, session
// selectors, and options that only fit one run.
const CLAUDE_DROPPED_VALUES = new Set(["--system-prompt", "--system-prompt-file", "--append-system-prompt",
  "--append-system-prompt-file", "--agents", "--settings", "--session-id", "-n", "--name", "--plugin-url", "--debug-file",
  "--environment", "--remote-control-session-name-prefix"]);
// Dropped with every value up to the next option: MCP configs can hold
// credentials, and files and beta headers fit one run.
const CLAUDE_DROPPED_LISTS = new Set(["--mcp-config", "--file", "--betas"]);
// Dropped: the session label already names the session these lead to.
const CLAUDE_DROPPED_FLAGS = new Set(["-c", "--continue", "--fork-session"]);
// Options with an optional value (--resume, --debug, --worktree, --remote-control,
// --teleport, --from-pr, --cloud, --prompt-suggestions, --tmux) are not listed:
// they stop capture like any unknown option.

/** @param {unknown} s @returns {s is string} */
const word = (s) => typeof s === "string" && !/[\x00-\x1f\x7f]/.test(s);
const option = (s) => word(s) && s.startsWith("-");

// An absolute or home path stays as Claude got it. A relative one is joined
// to the launch folder, or null without one.
/** @param {string} path @param {unknown} cwd */
function folder(path, cwd) {
  if (path.startsWith("/") || path === "~" || path.startsWith("~/")) return path;
  if (!absolute(cwd)) return null;
  const parts = [];
  for (const part of `${cwd}/${path}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

// The launch options in the words after Claude's program name. cwd is the
// folder Claude started in, for relative paths. Bare words are prompts or
// files to attach, never options.
/** @param {unknown[]} words @param {unknown} [cwd] @returns {string[]} */
export function claudeOptions(words, cwd) {
  const options = [];
  for (let i = 0; i < words.length; i++) {
    const current = words[i];
    if (!word(current) || current === "--") break;
    if (!current.startsWith("-")) continue;
    // --name=value is the same option as --name value.
    const eq = current.startsWith("--") ? current.indexOf("=") : -1;
    const arg = eq < 0 ? current : current.slice(0, eq);
    const inline = eq < 0 ? null : current.slice(eq + 1);
    /** @param {string[]} values */
    const paths = (values) => CLAUDE_PATHS.has(arg) ? values.map((value) => folder(value, cwd)).filter((value) => value !== null) : values;
    if (CLAUDE_VALUES.has(arg)) {
      const value = inline ?? words[++i];
      if (!word(value)) break;
      const kept = paths([value]);
      if (kept.length) options.push(CLAUDE_VALUES.get(arg), ...kept);
    } else if (CLAUDE_LISTS.has(arg) || CLAUDE_DROPPED_LISTS.has(arg)) {
      // With =, only the inline value: any later bare word is input.
      let end = i + 1;
      if (inline === null) while (end < words.length && !option(words[end])) end++;
      const values = inline === null ? words.slice(i + 1, end) : [inline];
      if (CLAUDE_DROPPED_LISTS.has(arg)) { i = end - 1; continue; }
      if ((inline === null && end === words.length) || !values.every(word)) break;
      const kept = paths(/** @type {string[]} */ (values));
      if (kept.length) options.push(CLAUDE_LISTS.get(arg), ...kept);
      i = end - 1;
    } else if (CLAUDE_DROPPED_VALUES.has(arg)) {
      if (inline === null) i++;
    } else if (inline === null && CLAUDE_FLAGS.has(arg)) {
      options.push(arg);
    } else if (inline === null && CLAUDE_DROPPED_FLAGS.has(arg)) {
      continue;
    } else {
      break;
    }
  }
  return options;
}

// The CLAUDE_OPTIONS label for those words: a versioned record, or null (no
// label) when no option is kept.
/** @param {unknown[]} words @param {unknown} [cwd] @returns {string | null} */
export function claudeOptionsLabel(words, cwd) {
  const args = claudeOptions(words, cwd);
  return args.length ? JSON.stringify({ version: 1, args }) : null;
}

// The options in a CLAUDE_OPTIONS label, or null. Only a record that the
// parser itself would write counts, so a label set by hand adds no other option.
/** @param {unknown} raw @returns {string[] | null} */
export function claudeOptionsRecord(raw) {
  try {
    const value = JSON.parse(/** @type {string} */ (raw));
    if (value?.version !== 1 || !Array.isArray(value.args) || !value.args.every(word)) return null;
    const args = claudeOptions([...value.args, "--"]);
    return args.length === value.args.length && args.every((arg, i) => arg === value.args[i]) ? args : null;
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
    if (value?.version !== 1 || !Object.hasOwn(STARTS, value.agent) || !["shell", "agent"].includes(value.root)) return null;
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

// Each start: the folder it must run in (null: any folder, the terminal's own)
// and its words. A word from the terminal's records is wrapped by recorded();
// the recipe's own words are plain strings.
// Claude keeps its existing id -> tab name -> picker order. Its launch options
// go before --resume, so a resumed Claude shows them where the session poller
// reads them (an option with an optional value, like --resume, stops capture).
/** @typedef {string | { recorded: string }} Word */
/** @param {string} word @returns {Word} */
const recorded = (word) => ({ recorded: word });
/** @type {Record<string, (input: any) => { cwd: string | null, words: Word[] }>} */
const STARTS = {
  claude: ({ session, tab, options = [] }) => ({ cwd: null,
    words: ["claude", ...options.map(recorded), "--resume", ...(session ? [recorded(session)] : tab ? [recorded(tab)] : [])] }),
  pi: ({ recovery, picker = false }) => {
    if (!recovery) return { cwd: null, words: ["pi", "--resume"] };
    // An ID looked up from another folder can fork instead of resume. The
    // picker also needs the recorded folder when its exact file is unavailable.
    const cwd = picker || !recovery.sessionFile ? recovery.cwd : null;
    const args = recovery.args.map(recorded);
    if (picker) return { cwd, words: ["pi", "--resume", ...args] };
    return { cwd, words: ["pi", "--session", recorded(recovery.sessionFile ?? recovery.sessionId), ...args] };
  },
  // Not verified on this machine:
  // codex: () => ({ cwd: null, words: ["codex", "resume", "--last"] }),
};

// What each start needs, read from the terminal's labels. A new label only
// changes this table, never the callers.
const INPUTS = {
  claude: (labels, { tab }) => ({ session: labels[SESSION], tab, options: claudeOptionsRecord(labels[CLAUDE_OPTIONS]) ?? [] }),
  pi: (labels, { picker }) => ({ recovery: piRecovery(labels[PI_RECOVERY]), picker }),
};

const startFor = (agent, labels, options) =>
  Object.hasOwn(STARTS, agent) ? STARTS[agent](INPUTS[agent](labels ?? {}, options ?? {})) : null;

// Typed into a shell: the recipe's own words bare, every recorded word quoted.
const shellLine = ({ cwd, words }) =>
  `${cwd ? `cd ${shellQuote(cwd)} && ` : ""}${words.map((w) => typeof w === "string" ? w : shellQuote(w.recorded)).join(" ")}`;

// The folder and the command word list that start the agent, or null for an
// agent without a recipe. options: tab (Claude's tab name), picker (Pi).
/** @typedef {{ tab?: string | null, picker?: boolean }} StartOptions */
/**
 * @param {string} agent @param {Record<string, string> | undefined} labels @param {StartOptions} [options]
 * @returns {{ cwd: string | null, argv: string[] } | null}
 */
export function recipe(agent, labels, options) {
  const start = startFor(agent, labels, options);
  return start && { cwd: start.cwd, argv: start.words.map((w) => typeof w === "string" ? w : w.recorded) };
}

// The same start as one shell line, as recovery types it.
/** @param {string} agent @param {Record<string, string> | undefined} labels @param {StartOptions} [options] @returns {string | null} */
export function recoveryLine(agent, labels, options) {
  const start = startFor(agent, labels, options);
  return start && shellLine(start);
}

// The shell line from already parsed records: Claude's { session, tab,
// options }, Pi's { recovery, picker }. Its keys are the agents that have a recipe.
export const RECIPES = Object.fromEntries(Object.entries(STARTS).map(([agent, build]) => [agent, (input) => shellLine(build(input))]));
