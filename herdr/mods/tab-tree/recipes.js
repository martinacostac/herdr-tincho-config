// Persistent terminal labels. Agent-specific data must never cross recipes.
export const LABEL = "herdr.last-agent";
export const SESSION = "herdr.claude-session";
export const PI_RECOVERY = "herdr.pi-recovery";

// Close single quotes around escapes: sh, bash, zsh and fish agree on this,
// including literal backslashes (fish treats \\ specially inside quotes).
export const shellQuote = (s) => `'${s.replace(/[\\']/g, (c) => c === "'" ? "'\\''" : "'\\\\'")}'`;
const printable = (s) => typeof s === "string" && s.length > 0 && !/[\x00-\x1f\x7f]/.test(s);

export function piRecovery(raw) {
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !printable(value.sessionId) || !/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(value.sessionId)) return null;
    if (value.sessionFile != null && (!printable(value.sessionFile) || !value.sessionFile.startsWith("/"))) return null;
    if (!printable(value.cwd) || !value.cwd.startsWith("/")) return null;
    if (!Array.isArray(value.args) || !value.args.every(printable)) return null;
    return value;
  } catch { return null; }
}

// A command typed into the terminal's shell. Pi's record is parsed before it
// reaches its recipe; Claude keeps its existing id -> tab name -> picker order.
export const RECIPES = {
  claude: ({ session, tab }) => (session ? `claude --resume ${shellQuote(session)}` : tab ? `claude --resume ${shellQuote(tab)}` : "claude --resume"),
  pi: ({ recovery, picker = false }) => {
    if (!recovery) return "pi --resume";
    const selection = picker ? "--resume" : `--session ${shellQuote(recovery.sessionFile ?? recovery.sessionId)}`;
    const options = recovery.args.map(shellQuote).join(" ");
    // An ID looked up from another folder can fork instead of resume. The
    // picker also needs the recorded folder when its exact file is unavailable.
    const folder = picker || !recovery.sessionFile ? `cd ${shellQuote(recovery.cwd)} && ` : "";
    return `${folder}pi ${selection}${options ? ` ${options}` : ""}`;
  },
  // Not verified on this machine:
  // codex: () => "codex resume --last",
};
