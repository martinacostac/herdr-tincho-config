import { recoveryArgs } from "./args.js";

const LABEL = "herdr.pi-recovery";

/** @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi */
export default function (pi) {
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal) return;
  // Pi keeps process.argv even when its process title hides the OS argv.
  const launchArgs = recoveryArgs(process.argv.slice(2), process.cwd());
  let saved;
  let warned = false;

  async function remember(_event, ctx) {
    // A print/RPC Pi launched by a tool inherits HC_TERMINAL_ID. It must not
    // replace the interactive parent's recovery metadata.
    if (ctx.mode !== "tui") return;
    const sessionFile = ctx.sessionManager.getSessionFile();
    const value = sessionFile ? JSON.stringify({
      version: 1,
      sessionId: ctx.sessionManager.getSessionId(),
      sessionFile,
      cwd: ctx.cwd,
      args: launchArgs,
    }) : ""; // An ephemeral session must clear any previous conversation.
    if (value === saved) return;
    try {
      const result = await pi.exec("hc", ["label", terminal, "herdr.last-agent=pi", `${LABEL}=${value}`], { timeout: 3000 });
      if (result.code !== 0) throw new Error("label failed");
      saved = value;
    } catch {
      if (!warned) {
        ctx.ui.notify("Herdr could not save Pi recovery metadata. Check that hc is available; recovery will retry on your next turn.", "warning");
        warned = true;
      }
    }
  }

  pi.on("session_start", remember);
  // Retry failed writes without polling, including after a core restart.
  pi.on("agent_start", remember);
  // Keep the label on exit: that is when the sidebar needs it.
}
