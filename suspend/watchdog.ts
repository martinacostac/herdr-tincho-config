// The wake watchdog. After execvp, hc keeps the stand-in's "working" report
// until the woken agent reports (fact F5 in plans/agent-suspension.md), and
// Claude can miss its status handshake and never report: hc would show the
// agent working, as the stand-in, for good. So just before it replaces itself
// the stand-in leaves this watchdog behind: plain sh, in its own session (the
// System starts it detached), in the background (the outer sh exits at once,
// so it is no child of the agent).
//
// After WATCH_SECONDS it reads the terminal once with hc get. It writes one
// idle report with no app only when the terminal is live, its report is the
// stand-in's (hc keeps the keys of status sorted, so app comes first), that
// report is at least WATCH_SECONDS old (a later wake's report is newer), and
// the stand-in is not in front. Otherwise it writes nothing. In hc's JSON a
// quote inside a string is escaped and label values are strings, so the
// status pattern cannot match inside labels or words. The in-front patterns
// can match elsewhere, which only means no write. Both the compact form hc
// prints and a spaced form are matched.

import { STANDIN_APP as APP } from "../herdr/mods/tab-tree/recipes.js";

export const WATCH_SECONDS = 30;

const SCRIPT = `(
sleep "$2"
out=$(hc get "$1" --json 2>/dev/null) || exit 0
case $out in *'"state":"live"'* | *'"state": "live"'*) ;; *) exit 0 ;; esac
case $out in *'"status":{"app":"${APP}"'* | *'"status": {"app": "${APP}"'*) ;; *) exit 0 ;; esac
case $out in *'"name":"${APP}"'* | *'"name": "${APP}"'* | *'/${APP}"'* | *'["${APP}"'*) exit 0 ;; esac
ms=\${out##*'"status_ms":'}
[ "$ms" != "$out" ] || exit 0
ms=\${ms#"\${ms%%[! ]*}"}
ms=\${ms%%[!0-9]*}
[ -n "$ms" ] || exit 0
[ $(( $(date +%s) - ms / 1000 )) -ge "$2" ] || exit 0
printf '\\033]7501;state=idle\\033\\\\'
) </dev/null 2>/dev/null &`;

/** The command that starts the watchdog for the terminal at address. */
export const watchdog = (address: string) => ["/bin/sh", "-c", SCRIPT, "sh", address, String(WATCH_SECONDS)];
