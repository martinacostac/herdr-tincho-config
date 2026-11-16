# 15: Policy and sidebar fixes from the final review

**What to build:** Fix the policy-side findings of the whole-branch review (`.scratch/agent-suspension/final-review.md`), so that a suspension never ends a terminal, never suspends an agent that cannot wake, and never kills work.

- **C1 (critical)**: Pi turns `SIGTERM` and `SIGHUP` into an exit with code 0, verified in Pi's interactive mode. hc treats that as a final exit, so suspending an agent that is the terminal's main program (`root=agent`) ends the terminal. For `root=agent`, suspension sends `SIGKILL` to the main program, which no agent can turn into an exit code. Then it sends `SIGTERM` to the helper processes it saw in its process snapshot just before, so MCP servers don't leak. `root=shell` keeps `SIGTERM` to the shell (F3 verified that this is a loss, and the agent inside exits cleanly). Claude as `root=agent` gets the same `SIGKILL` path.
- **H1 (policy part)**: a Claude session counts as resumable only when its transcript exists, as a `<id>.jsonl` file in any folder under Claude's projects folder.
- **M1**: a Pi record counts as resumable only when its session file holds the recorded session (the existing `holdsPiSession` check), read before step 2.
- **M3**: the sidebar never records a stand-in as the terminal's last agent. Skip the last-agent labeling for a terminal whose report comes from the stand-in, or that has the suspension label.
- **M4**: for `root=shell`, the shell's other children must also be helpers, so a background job in that shell blocks suspension.
- **L3**: the "installed" check is cached for 5 minutes instead of running on every pass while nothing is installed.
- **L7**: the leader removes handled requests older than the request timeout from the shared requests.
- **L8**: 💤 shows only when the stand-in or herdr-shell is in front, not on a live agent that carries a stale label.
- **L11 and wording**: update the shared-state comment in tab-menu with the new result fields, and replace "resume" with "wake" in comments about waking.

**Blocked by:** 14 (done).

**Status:** ready-for-agent

- [ ] `root=agent` suspension sends `SIGKILL` to the main program, then `SIGTERM` to the helpers from its snapshot. `root=shell` still sends `SIGTERM` to the shell. Tests cover both.
- [ ] A Claude session without a transcript, and a Pi record whose file doesn't hold the session, are not resumable.
- [ ] The last-agent label is never set from a stand-in.
- [ ] A background job in the hosting shell blocks suspension.
- [ ] The installed check is cached; old requests are pruned; 💤 never shows on a live agent; the comments are fixed.
- [ ] No new periodic timer (the timer list stays [3000, 10000, 15000]). The full test suite passes.
