const claude = (name) => /^(claude|claude-code)$/i.test(name);
const base = (path) => typeof path === "string" ? path.split(/[\\/]/).pop().replace(/^-/, "").replace(/\.exe$/i, "") : "";

// Deliberately narrower than the app's display-name detection: never search
// arbitrary arguments (e.g. `pi "fix claude"`) or evaluate shell command text.
function claudeArgv(argv) {
  if (!Array.isArray(argv) || !argv.length) return false;
  const first = base(argv[0]);
  if (claude(first)) return true;
  if (["node", "bun"].includes(first)) {
    const script = argv[1];
    return typeof script === "string" && !script.startsWith("-") &&
      (/^(claude|claude-code)\.(js|mjs|cjs)$/i.test(base(script)) || /(?:^|[\\/])@anthropic-ai[\\/]claude-code[\\/]cli\.js$/.test(script));
  }
  // The exact launch wrappers used by Herdr (programs.rs), not `sh -c ...`.
  if (["sh", "bash", "zsh", "fish"].includes(first) && argv.length > 4 &&
      /^-[a-z]*c$/.test(argv[1]) &&
      ['"$@"; exec "$0" -i', "command $argv[2..]; exec $argv[1] -i"].includes(argv[2])) {
    return claudeArgv(argv.slice(4));
  }
  return false;
}

// Current process metadata only. Recovery labels describe a previous agent.
// terminals() exposes OSC 7501 as report; hc get keeps it in status.
export function isClaude(t) {
  const app = t?.report?.app ?? t?.status?.app;
  if (typeof app === "string" && app) return claude(app);
  const key = t?.program?.key;
  if (key === "claude") return true;
  if (t?.program?.shell || (key && !["agent", "program", "node", "bun"].includes(key))) return false;
  // Launch argv is not current evidence when another foreground PID is known.
  const argv = t?.foreground?.argv?.length ? t.foreground.argv
    : t?.foreground?.pid && t.foreground.pid !== t.pid ? null : t?.argv;
  return claudeArgv(argv);
}

export function claudeCandidate(t) {
  return Boolean(t?.address && !t.address.includes("/") && t.state === "live" && isClaude(t));
}

// Ignore status/turn/title/labels: they can change without replacing a process.
// Capture a string before awaiting, rather than retaining a mutable host object.
export function processIdentity(t) {
  return JSON.stringify([t?.pid, t?.argv, t?.foreground?.pid, t?.foreground?.argv,
    t?.report?.app ?? t?.status?.app]);
}
