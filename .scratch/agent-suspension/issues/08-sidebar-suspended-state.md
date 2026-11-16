# 08: Suspended and waking tabs in the sidebar; recovery refuses stand-ins

**What to build:** The sidebar shows which agents are suspended, and recovery can never type into a stand-in.

- A terminal with the `herdr.suspended` label shows a dimmed name and 💤.
- It shows "waking…" from when its stand-in reports `working` (syntax from fact F5) until the woken agent reports its own status.
- The ↻ button never appears on a suspended terminal.
- Recovery checks the label before it types and refuses a stand-in, because its "at a shell" check (the foreground process is the main program) also passes for a stand-in. A stale click therefore types nothing.
- A kept terminal whose agent crashed after a suspension still shows a shell and ↻ as today.

Documentation is done in ticket 13.

**Blocked by:** 01 (fact F5), 07 (shares the tab-tree mod's main module)

**Status:** ready-for-agent

- [ ] A suspended terminal's row shows a dimmed name and 💤, in both the wide and the narrow sidebar
- [ ] A waking terminal shows "waking…" until the woken agent's own status arrives
- [ ] ↻ is not offered for a suspended terminal
- [ ] Tests in the recovery-lifecycle style show that recovery types nothing into a terminal with the suspension label
- [ ] A kept terminal back at a shell without the label still offers ↻
- [ ] The existing recovery tests still pass
