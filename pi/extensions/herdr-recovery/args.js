import { homedir } from "node:os";
import { resolve } from "node:path";

// Only known, reusable options. Never persist prompts, credentials, trust
// approvals or arbitrary extension flags. Canonical names keep replay simple.
const values = new Map([
  ...["provider", "model", "models", "thinking", "tools", "exclude-tools", "use-theme", "tui-mode"].map((s) => [`--${s}`, `--${s}`]),
  ["-t", "--tools"], ["-xt", "--exclude-tools"],
]);
const paths = new Map([
  ...["extension", "skill", "prompt-template", "theme", "session-dir"].map((s) => [`--${s}`, `--${s}`]),
  ["-e", "--extension"],
]);
const flags = new Map([
  ...["no-tools", "no-builtin-tools", "no-extensions", "no-mcp", "no-skills", "no-prompt-templates", "no-themes", "no-context-files", "offline", "verbose", "no-approve", "no-sandbox"].map((s) => [`--${s}`, `--${s}`]),
  ["-nt", "--no-tools"], ["-nbt", "--no-builtin-tools"], ["-ne", "--no-extensions"],
  ["-ns", "--no-skills"], ["-np", "--no-prompt-templates"], ["-nc", "--no-context-files"], ["-na", "--no-approve"],
]);
const omittedValues = new Set(["--api-key", "--system-prompt", "--append-system-prompt", "--session", "--session-id", "--fork", "--name", "-n", "--mode"]);
const harmlessFlags = new Set(["--continue", "-c", "--resume", "-r", "--no-session"]);
const printable = (s) => typeof s === "string" && !/[\x00-\x1f\x7f]/.test(s);

// Pi's CLI paths are relative to the launch folder, not a session selected
// later with /resume. builtin: extensions are identifiers, not file paths.
function resourcePath(value, cwd) {
  if (value.startsWith("builtin:")) return value;
  if (value === "~") return homedir();
  return resolve(cwd, value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : value);
}

export function recoveryArgs(argv, cwd) {
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") break; // Everything after it is a prompt or attachment.
    if (values.has(arg) || paths.has(arg)) {
      const value = argv[++i];
      if (!printable(value) || !value) continue;
      args.push(values.get(arg) ?? paths.get(arg), paths.has(arg) ? resourcePath(value, cwd) : value);
    } else if (flags.has(arg)) {
      args.push(flags.get(arg));
    } else if (omittedValues.has(arg)) {
      i++; // Consume the value even if it looks like another flag.
    } else if (harmlessFlags.has(arg)) {
      // The current session file replaces the old selection.
    } else if (arg.startsWith("-")) {
      // Unknown flags have unknown arity. Do not guess which later tokens
      // are values: stop here instead of accidentally persisting a secret.
      break;
    }
    // Bare arguments and @files are input, not configuration.
  }
  return args;
}
