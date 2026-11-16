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

Status: done

- [x] `root=agent` suspension sends `SIGKILL` to the main program, then `SIGTERM` to the helpers from its snapshot. `root=shell` still sends `SIGTERM` to the shell. Tests cover both.
- [x] A Claude session without a transcript, and a Pi record whose file doesn't hold the session, are not resumable.
- [x] The last-agent label is never set from a stand-in.
- [x] A background job in the hosting shell blocks suspension.
- [x] The installed check is cached; old requests are pruned; 💤 never shows on a live agent; the comments are fixed.
- [x] No new periodic timer (the timer list stays [3000, 10000, 15000]). The full test suite passes.

## Comments

Done in 8b086cd (implementation) and b33ee87 (review fixes).

- C1: root=agent sends SIGKILL to the main program, then SIGTERM to every process under the agent in the step-1 process snapshot (the reviewer noted that wrappers like uvx may not pass SIGTERM on). If the SIGKILL fails, no helper gets a signal. root=shell still sends SIGTERM to the shell.
- H1/M1: a new slow rule (it starts a process) after the cheap rules: Claude needs `~/.claude/projects/*/<id>.jsonl`, and Pi needs a session file whose header holds the recorded session (`piSessionHeld`, shared with recovery in resume.js). The pass skips the slow rules. When a suspension is refused with "not-resumable", the pass holds the agent back for 5 minutes, as it does for "background" (manual requests check again at once).
- M4: for root=shell, every child of the hosting shell except the one that leads to the agent must be a helper.
- M3: `remember()` skips a stand-in report and any terminal with the suspension label. L8: 💤 shows only while the stand-in or herdr-shell is in front (`holderInFront`). ↻ stays hidden while the label is set.
- L3: the pass checks the installation at most every 5 minutes, and each suspension still checks it. L7: the leader's pass removes requests that can no longer act. L11: the tab-menu state comment and the wake wording are fixed.
- Tests: `node --test tests/*.test.mjs` passes 301 of 301, and `sh tests/install.test.sh` passes. The timer list is still [3000, 10000, 15000].
- Open: the L7 prune writes the whole requests key. If another mod's `setShared` is not visible yet in this mod's `shared()`, a "Suspend now" request made at that moment can be lost, and the menu then says "no answer" after a minute. The herdr-app docs do not say whether that write is visible at once across mods. Also, `herdr-app check` could not run in this sandbox (launchd bootstrap error).
