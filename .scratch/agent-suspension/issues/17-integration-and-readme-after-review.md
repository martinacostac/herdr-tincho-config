# 17: Integration check with a real Pi, and README corrections

**What to build:** Prove the C1 fix end to end, and make the README match the code after tickets 15 and 16.

- Extend the by-hand integration script with a real Pi started by `hc run` (`root=agent`) on the disposable core. Suspend it with the policy's signal choice, `SIGKILL` for `root=agent`, then check that the terminal stays live with the same address, that the stand-in takes over, and that the helper processes are gone. A Pi without network access is enough, because no wake is needed for this check. Also check that `SIGTERM` would have ended the terminal, and record the result as evidence.
- Correct the README: the "refused as unavailable" claim covers only part of the switch (M5); waking now has a watchdog (H2) instead of "clears after 30 s"; login shells on macOS (M2); the signal per root (C1); the transcript check for Claude (H1); the limits that remain.
- Run the integration script and the full test suites. Record the results in the ticket.

**Blocked by:** 15, 16.

Status: done

- [x] The integration script passes with the real-Pi `root=agent` case.
- [x] The README matches the code for every point above.
- [x] All test suites pass, and herdr-app check passes for tab-tree and tab-menu.

## Comments

Done in dfb8302 (implementation) and a544f2b (fixes from the code review).

- Integration script (`tests/suspend.integration.sh`). Step 1 takes a process snapshot. For root=agent, the script sends `SIGKILL` to the main program, then `SIGTERM` to every process under the agent in that snapshot. root=shell still sends `SIGTERM` to the shell. On macOS the expected stand-in line ends in `-l`. The fake Claude has a transcript under `$HOME/.claude/projects/`. `PI_*` variables are unset.
- Real Pi, root=agent: real `pi` 1.5.2, started with `hc run` on the disposable core, with a throwaway HOME (and so a throwaway session). An extension in that HOME starts a fake MCP server, a helper with a child of its own. Pi reached idle and reported without network.
  - `SIGKILL`: the terminal stays live at the same address, with the same name, labels and parent. The stand-in is the main program 2 s later. Pi and the 3 processes under it ended.
  - Evidence for C1: in a second kept terminal (with the suspension label set), `SIGTERM` to the real Pi gives `finished, exit_code 0, signal null`. The terminal ended.
- Also checked: 30 s after the wakes, the watchdog left the woken agents' reports alone. Cleanup waits for the watchdogs before it stops the disposable core, because their `hc get` would start a stopped core again.
- Run: twice, through a throwaway `hc run --rm --no-notify` terminal on the real core (the core cannot spawn programs inside the sandbox). Both runs: 49 ok, "all checks passed". The last run was after the review fixes. The runner terminals and the scratch folders are gone. The real core id is still 1897801a.
- README corrections:
  - M5: sends are refused only while hc shows no program. After that, they arrive and are read as one message, with a caveat.
  - H2: the watchdog replaces "clears after 30 s".
  - M2: `-l` on macOS.
  - C1: the signal per root.
  - H1/M1: the transcript and the session file count for resumable.
  - M4: shell jobs count as processes of the agent.
  - L8: 💤 shows only while the stand-in or herdr-shell is in front.
  - Remaining limits: helper substring match, Claude `SIGKILL` not checked, watchdog report without an app, L4, L5, L6, L10, and the L7 prune race.
  - CHANGELOG updated.
  - ADR 0001: one sentence corrected to match M5, with t4's approval.
- Flaky `FAIL: watch exited`: the cause is in install.sh. It is a check-then-copy race under `set -e`: `[ -f "$from" ]`, then `cp` fails when the file is renamed in between, and the watcher exits. An editor that saves by renaming during a pass can hit it too. install.sh is not edited. Fix it there separately, for example by skipping a file that vanished (`cp … || continue`). The test now uses a fake `sleep` that records each poll, and it renames or removes sources only after two new polls (the watcher is between passes). Stress: 42 + 12 parallel runs passed, against 1 failure in 28 before the fix.
- Tests: `node --test tests/*.test.mjs` 301/301; `sh tests/install.test.sh` passes; `bun test tests/standin.test.ts` 61 pass; `sh tests/herdr-shell.test.sh` passes (sh, dash).
- `herdr-app check`: the parent ran it after ticket 15, and tab-tree and tab-menu both pass. Tickets 16 and 17 changed no mod file.
- Review: Standards found the ADR 0001 conflict (fixed), duplicates and names in both scripts (fixed), and the glossary has no term for "agent that hc started directly" / root=agent (open, for /domain-modeling). Spec found that results were not yet recorded (done here), the CHANGELOG mixing two cases (fixed), the Pi session claim (source cited), and the "one message" caveat (added). Not changed: the reviewer said that `not_helpers` checks less than the policy, but the policy also checks only the agent's direct children. The watchdog check stays, because cleanup needs that wait anyway.
