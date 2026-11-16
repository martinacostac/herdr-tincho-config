# 07: Automatic suspension and wake on focus in tab-tree

**What to build:** Unused agents are suspended automatically while the Herdr app is open, and a suspended agent wakes when its tab stays focused for one second. The policy module runs inside the tab-tree mod, on a timer. Only one copy leads, chosen through the app's shared state, also with several windows open; only the leader acts.

Suspension steps, in order; any failed check aborts and changes nothing more:

1. Read the terminal again and confirm the agent is still unused (manual requests: every rule except the threshold).
2. Keep the terminal.
3. Read status and turn again; abort if either changed.
4. Set `herdr.suspended` to the versioned record: agent, root (`shell` when the main program is a shell hosting the agent, `agent` when hc started the agent directly), `cwd` from the foreground folder, and `since`.
5. Signal the terminal's main program with the signal that fact F3 found gives a loss.

Nothing is suspended, and the reason is "feature not installed", unless the stand-in and the launcher are installed in the project's XDG data bin folder and the launcher is hc's configured `shell`.

The mod records the last focus time of each tab in memory and passes it to the idle clock. When a suspended agent's tab stays focused for 1 s, the leader presses an empty Enter in the stand-in. Stepping past tabs with ⌘P or the next-agent command wakes nothing.

Other mods can, through the app's shared state, request a manual suspension of a terminal (threshold skipped) and read each agent's current eligibility reason. Ticket 09 builds the menu on this.

**Blocked by:** 01 (fact F3), 03 (shares the tab-tree mod's main module), 04 (eligibility rules)

**Status:** ready-for-agent

- [ ] Mocked-host tests cover the ordered steps and an abort at each step, with nothing done after the abort
- [ ] Tests cover root detection for a shell-hosted agent and an agent that hc started directly
- [ ] Tests cover the signal choice from F3
- [ ] Tests cover refusal when the stand-in or launcher is missing, or the launcher is not hc's shell
- [ ] Tests cover leader choice with two copies: only one acts
- [ ] Tests cover wake on 1 s of focus, and no wake when focus moves on before 1 s
- [ ] Tests cover a manual request: threshold skipped, other rules applied, reason available to the requester
- [ ] Automatic suspension does nothing when it is turned off in the settings, while manual requests still work
- [ ] The existing tab-tree tests still pass
