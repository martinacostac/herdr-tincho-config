# 08: Suspended and waking tabs in the sidebar; recovery refuses stand-ins

**What to build:** The sidebar shows which agents are suspended, and recovery can never type into a stand-in.

- A terminal with the `herdr.suspended` label shows a dimmed name and 💤.
- It shows "waking…" from when its stand-in reports `working` (syntax from fact F5) until the woken agent reports its own status.
- The ↻ button never appears on a suspended terminal.
- Recovery checks the label before it types and refuses a stand-in, because its "at a shell" check (the foreground process is the main program) also passes for a stand-in. A stale click therefore types nothing.
- A kept terminal whose agent crashed after a suspension still shows a shell and ↻ as today.

Documentation is done in ticket 13.

**Blocked by:** 01 (fact F5), 07 (shares the tab-tree mod's main module)

Status: done

- [x] A suspended terminal's row shows a dimmed name and 💤, in both the wide and the narrow sidebar
- [x] A waking terminal shows "waking…" until the woken agent's own status arrives
- [x] ↻ is not offered for a suspended terminal
- [x] Tests in the recovery-lifecycle style show that recovery types nothing into a terminal with the suspension label
- [x] A kept terminal back at a shell without the label still offers ↻
- [x] The existing recovery tests still pass

## Comments

Done in d4857a0 and c39bff7 (review fixes).

- tab-tree `main.js`: `heldState()` gives "suspended" (the `herdr.suspended` label is set) or "waking" (the stand-in's `working` report, which stays after execvp until the woken agent reports, per F5). A suspended row shows a dimmed name, a dimmed icon and 💤 in the wide and the narrow sidebar, and in pane rows. A waking row shows "waking…" (the spinner in the narrow rail). A stand-in that cannot wake still shows "Needs you". A stand-in goes by its agent's name. ↻ is never offered on a terminal a stand-in holds. The tab popup height is now 270 (parent's request, for ticket 09's items). No new timers.
- `resume.js`: recovery reads the terminal just before it types (Claude: one new `hc get` first; Pi: the existing check). It refuses when the label is set or the stand-in's report is still there.
- `suspend-policy.js`: when the step-5 signal fails while the main program still runs, the label is removed again. When the program had already ended (new pid, or not live), the label stays for herdr-shell. A manual request's result says `failed`.
- Tests: `tests/sidebar-suspension.test.mjs` (new), plus new cases in `recovery-lifecycle`, `resume` and `suspension`. The recovery-lifecycle boundary indexes moved by one get.
- Open: a woken agent that never reports (it exits first, or Claude misses its OSC 7501 query) leaves "waking…" with no end. The stale report also makes the row an agent, so ↻ stays hidden. An automatic pass does not record a signal failure anywhere: `results` exists only for requests.
