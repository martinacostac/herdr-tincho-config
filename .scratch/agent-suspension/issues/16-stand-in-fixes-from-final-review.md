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

**Status:** ready-for-agent

- [ ] A Claude session without a transcript takes the missing-session path, and the messages are saved.
- [ ] The watchdog writes `idle` exactly once, only when the stand-in's report is stale and the stand-in is not in front. It is tested with a fake hc.
- [ ] On macOS, herdr-shell and the stand-in start `$SHELL -l` when they have no arguments.
- [ ] Input from before raw mode becomes one message. herdr-shell's error path keeps delivered lines.
- [ ] No failed wake leaves `working`. Unexpected errors never end the process.
- [ ] bun tests, herdr-shell tests and the node suite pass. The stand-in's footprint stays at 10 MB or less.
