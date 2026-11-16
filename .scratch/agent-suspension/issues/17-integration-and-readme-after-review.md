# 17: Integration check with a real Pi, and README corrections

**What to build:** Prove the C1 fix end to end, and make the README match the code after tickets 15 and 16.

- Extend the by-hand integration script with a real Pi started by `hc run` (`root=agent`) on the disposable core. Suspend it with the policy's signal choice, `SIGKILL` for `root=agent`, then check that the terminal stays live with the same address, that the stand-in takes over, and that the helper processes are gone. A Pi without network access is enough, because no wake is needed for this check. Also check that `SIGTERM` would have ended the terminal, and record the result as evidence.
- Correct the README: the "refused as unavailable" claim covers only part of the switch (M5); waking now has a watchdog (H2) instead of "clears after 30 s"; login shells on macOS (M2); the signal per root (C1); the transcript check for Claude (H1); the limits that remain.
- Run the integration script and the full test suites. Record the results in the ticket.

**Blocked by:** 15, 16.

**Status:** ready-for-agent

- [ ] The integration script passes with the real-Pi `root=agent` case.
- [ ] The README matches the code for every point above.
- [ ] All test suites pass, and herdr-app check passes for tab-tree and tab-menu.
