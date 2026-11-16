# 16: Stand-in and herdr-shell fixes from the final review

**What to build:** Fix the stand-in and launcher findings of the whole-branch review (`.scratch/agent-suspension/final-review.md`), so that messages are never lost and a woken agent never leaves a wrong status in hc.

- **H1 (stand-in part)**: before waking Claude, check that its transcript exists (`<id>.jsonl` in any folder under Claude's projects folder). If it doesn't, take the missing-session path: save the messages, show the path, report `blocked`.
- **H2**: a woken agent that never reports (Claude can miss its status handshake) leaves hc at `working` with the stand-in's app forever. Before `execvp`, the stand-in starts one small detached watchdog, plain `/bin/sh`, not Bun. After 30 s it checks with `hc get` whether the terminal's report still comes from the stand-in while the stand-in is no longer in front. If so, it writes one OSC 7501 `idle` report with no app to the terminal, then exits. In every other case it exits without writing anything.
- **M2**: hc starts login shells on macOS ("Recovery shells use the same rule"), and a configured `shell` is run exactly as written. When herdr-shell runs on macOS (Darwin) with no arguments, it starts `$SHELL -l`. The stand-in's handover to `$SHELL` and the `root=shell` tail after the agent do the same.
- **M5**: input that arrives before the stand-in turns on raw mode and bracketed paste (typed into the cooked terminal while it starts) counts as ONE message, with its lines joined by newlines, not as several messages. herdr-shell's error path must not consume a delivered message as its "Enter": wait for an empty line only.
- **L1**: a failed wake never leaves the stand-in reporting `working`. After every failed wake, empty or not, it reports `blocked` again.
- **L2**: an unexpected error or rejected promise in the stand-in takes the missing-session path and keeps the process alive. It never exits, because an ordinary exit ends a kept terminal.
- **L9**: the stand-in passes its shell arguments on when it hands over to `$SHELL`.
- **Standards**: the stand-in imports `STANDIN_APP` from the recipe module instead of keeping its own copy.

**Blocked by:** 14 (done).

Status: done

- [x] A Claude session without a transcript takes the missing-session path, and the messages are saved.
- [x] The watchdog writes `idle` exactly once, only when the stand-in's report is stale and the stand-in is not in front. It is tested with a fake hc.
- [x] On macOS, herdr-shell and the stand-in start `$SHELL -l` when they have no arguments.
- [x] Input from before raw mode becomes one message. herdr-shell's error path keeps delivered lines.
- [x] No failed wake leaves `working`. Unexpected errors never end the process.
- [x] bun tests, herdr-shell tests and the node suite pass. The stand-in's footprint stays at 10 MB or less.

## Comments

Done in 6301999 (implementation) and 672a387 (fixes from the code review).

- H1: the stand-in wakes Claude only when `$HOME/.claude/projects/<folder>/<id>.jsonl` exists. Otherwise it takes the missing-session path. An id that is not a plain file name counts as missing.
- H2: `suspend/watchdog.ts`. Just before the `execvp`, the stand-in starts a plain `/bin/sh` watchdog, detached into its own session and backgrounded, so it is not a child of the agent. After 30 s it runs one `hc get`. It writes one `idle` report with no app only when all of these hold: the terminal is live, `status` is the stand-in's report, that report is at least 30 s old (so a later wake's report is newer), and the stand-in is not in front. Tested against a fake hc, including spaced JSON and labels named `app` or `status_ms`. It was also checked with the real System: it wrote after the exec.
- M2/L9: on Darwin with no arguments, herdr-shell uses `-l`. It passes its arguments to `$SHELL` and to the stand-in (`herdr-standin <agent> <address> <name> [shell args...]`). The stand-in's handover and the `root=shell` tail use them, or `-l` on Darwin when there are none.
- M5: a lone LF (cooked input from before raw mode, or Ctrl-J) continues the message unless it ends the read, so input from before raw mode is one message. herdr-shell's error path retries only on an empty line. It collects lines with text and passes them to the stand-in as one message in `HERDR_STANDIN_PENDING`. The stand-in removes that variable from the environment with libc `unsetenv`, so the agent and the shell never inherit it. When a shell starts instead, the lines are dropped with a note.
- L1: every failed wake reports `blocked` again. A repeated empty wake shows its reason on screen only once.
- L2: errors inside the wake and process-level uncaught errors and rejections take the missing-session path. The process stays alive. `main.ts` no longer awaits.
- `STANDIN_APP` is imported from recipes.js.
- Tests: bun 61 pass, herdr-shell (sh and dash) pass, node suite 301 pass, installer tests pass. AOT build RSS is 7.7 MB (measured in-process, because `footprint` and `ps` are blocked in the sandbox).
- Ticket 17 must update `tests/suspend.integration.sh`. (a) The expected stand-in command line becomes `... herdr-standin <agent> <t> <name> -l` on macOS. (b) The fake Claude needs `$HOME/.claude/projects/<any>/$claude_session.jsonl` in the disposable HOME.

