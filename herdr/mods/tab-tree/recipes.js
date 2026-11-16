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
// The app name the stand-in reports over OSC 7501 (suspend/standin.ts).
export const STANDIN_APP = "herdr-standin";

// Close single quotes around escapes: sh, bash, zsh and fish agree on this,
// including literal backslashes (fish treats \\ specially inside quotes).
export const shellQuote = (s) => `'${s.replace(/[\\']/g, (c) => c === "'" ? "'\\''" : "'\\\\'")}'`;
// A command word: a string without control characters, possibly empty.
/** @param {unknown} s @returns {s is string} */
const word = (s) => typeof s === "string" && !/[\x00-\x1f\x7f]/.test(s);
const printable = (s) => word(s) && s.length > 0;
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
// tables stops capture instead of being guessed (claude --help, 2.1.325).
// Options with an optional value (--resume, --debug, --worktree,
// --remote-control, --teleport, --from-pr, --cloud, --prompt-suggestions,
// --tmux) are deliberately missing: they stop capture.
const ownNames = (names) => names.map((name) => [name, name]);
// One value each. --system-prompt-snapshot takes on/off, never prompt text.
const CLAUDE_VALUES = new Map(ownNames(["--model", "--permission-mode", "--effort", "--fallback-model", "--agent",
  "--setting-sources", "--autocompact", "--system-prompt-snapshot", "--plugin-dir"]));
// Every following word up to the next option. Claude takes a trailing prompt
// into such a list too, so a list at the end of the words is never kept.
const CLAUDE_LISTS = new Map([...ownNames(["--add-dir", "--allowed-tools", "--disallowed-tools", "--tools"]),
  ["--allowedTools", "--allowed-tools"], ["--disallowedTools", "--disallowed-tools"]]);
// Values that are folders, relative to the folder Claude started in.
const CLAUDE_PATHS = new Set(["--add-dir", "--plugin-dir"]);
// No value.
const CLAUDE_SWITCHES = new Set(["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--ax-screen-reader",
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
const CLAUDE_DROPPED_SWITCHES = new Set(["-c", "--continue", "--fork-session"]);
// A kept option that works only with a dropped one goes too: only the MCP
// servers of --mcp-config, an agent that --agents defines, the login that
// --bare reads from --settings.
const CLAUDE_NEEDS = new Map([["--strict-mcp-config", "--mcp-config"], ["--agent", "--agents"], ["--bare", "--settings"]]);

const option = (s) => word(s) && s.startsWith("-");

// An absolute or home path stays as Claude got it. A relative one is joined
// to the launch folder, or null without one. (Pi's args.js resolves its own
// paths; this module imports nothing, so it cannot share that code.)
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
  /** @type {string[][]} */
  const kept = []; // [name, ...values] for each kept option
  const dropped = new Set();
  /** @param {string} name @param {string[]} values */
  const keep = (name, values) => {
    const resolved = CLAUDE_PATHS.has(name) ? values.map((value) => folder(value, cwd)).filter((value) => value !== null) : values;
    if (resolved.length) kept.push([name, ...resolved]);
  };
  for (let i = 0; i < words.length; i++) {
    const current = words[i];
    if (!word(current) || current === "--") break;
    if (!current.startsWith("-")) continue;
    // --name=value is the same option as --name value.
    const eq = current.startsWith("--") ? current.indexOf("=") : -1;
    const name = eq < 0 ? current : current.slice(0, eq);
    const inline = eq < 0 ? null : current.slice(eq + 1);
    // A list ends at the next option; with =, only the inline value is its
    // own and any later bare word is input.
    let end = i + 1;
    if (inline === null) while (end < words.length && !option(words[end])) end++;
    if (CLAUDE_VALUES.has(name)) {
      const value = inline ?? words[++i];
      if (!word(value)) break;
      keep(CLAUDE_VALUES.get(name), [value]);
    } else if (CLAUDE_LISTS.has(name)) {
      const values = inline === null ? words.slice(i + 1, end) : [inline];
      if ((inline === null && end === words.length) || !values.every(word)) break;
      keep(CLAUDE_LISTS.get(name), /** @type {string[]} */ (values));
      i = end - 1;
    } else if (CLAUDE_DROPPED_LISTS.has(name)) {
      dropped.add(name);
      i = end - 1;
    } else if (CLAUDE_DROPPED_VALUES.has(name)) {
      dropped.add(name);
      if (inline === null) i++;
    } else if (inline === null && CLAUDE_SWITCHES.has(name)) {
      kept.push([name]);
    } else if (!(inline === null && CLAUDE_DROPPED_SWITCHES.has(name))) {
      break;
    }
  }
  return kept.filter(([name]) => !dropped.has(CLAUDE_NEEDS.get(name))).flat();
}

// The CLAUDE_OPTIONS label for those words: a versioned record, or null (no
// label) when no option is kept.
/** @param {unknown[]} words @param {unknown} [cwd] @returns {string | null} */
export function claudeOptionsLabel(words, cwd) {
  const options = claudeOptions(words, cwd);
  return options.length ? JSON.stringify({ version: 1, options }) : null;
}

// The options in a CLAUDE_OPTIONS label, or null. Only a record that the
// parser itself would write counts, so a label set by hand adds no other option.
/** @param {unknown} raw @returns {string[] | null} */
export function claudeOptionsRecord(raw) {
  try {
    const value = JSON.parse(/** @type {string} */ (raw));
    if (value?.version !== 1 || !Array.isArray(value.options) || !value.options.every(word)) return null;
    const options = claudeOptions([...value.options, "--"]);
    return options.length === value.options.length && options.every((o, i) => o === value.options[i]) ? options : null;
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

/** @param {Word} w */
const plain = (w) => typeof w === "string" ? w : w.recorded;

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
  return start && { cwd: start.cwd, argv: start.words.map(plain) };
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
