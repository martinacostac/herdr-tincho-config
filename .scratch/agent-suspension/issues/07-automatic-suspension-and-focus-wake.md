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

**Status:** done

- [x] Mocked-host tests cover the ordered steps and an abort at each step, with nothing done after the abort
- [x] Tests cover root detection for a shell-hosted agent and an agent that hc started directly
- [x] Tests cover the signal choice from F3
- [x] Tests cover refusal when the stand-in or launcher is missing, or the launcher is not hc's shell
- [x] Tests cover leader choice with two copies: only one acts
- [x] Tests cover wake on 1 s of focus, and no wake when focus moves on before 1 s
- [x] Tests cover a manual request: threshold skipped, other rules applied, reason available to the requester
- [x] Automatic suspension does nothing when it is turned off in the settings, while manual requests still work
- [x] The existing tab-tree tests still pass

## Comments

Done in eff0054 and 608b792 (review fixes).

- `herdr/mods/tab-tree/suspend-policy.js`: `createSuspender()` holds the leader choice, focus tracking across windows, wake on focus, manual requests and the ordered steps (recheck, `hc keep`, recheck status/turn/program, `herdr.suspended` label with `root` from main pid vs foreground pid, `kill -TERM` on the main program per F3). Nothing is suspended (reason `not-installed`) unless `$XDG_DATA_HOME/herdr-tincho-config/bin/{herdr-standin,herdr-shell}` exist and herdr-core's `shell = [...]` names that herdr-shell. Helpers: a descendant under a helper is part of it. New rule reason `suspended` (the label is already set).
- `main.js`: no short timer. `render` calls `observe()` (focus and requests, no side effects); `act()` runs in `cx.spawn` (publish, one 1 s `cx.timer.after` per focused suspended agent, cancelled when the focus moves, requests). One 15 s pass: heartbeat (60 s), shared reasons, automatic suspension. It starts no process while no agent is past its threshold. The unused `SESSION` import is gone.
- Entry point for ticket 09 (shape in the comment above `SUSPEND_REQUESTS`): other mods set `tincho.suspend.requests[address] = Date.now()`; the leader writes `tincho.suspend.state` = `{ agents: { [address]: { auto, manual } }, results: { [address]: { requested, suspended, reason, at } } }`. Shared reasons skip the process rule (a `background` reason shows only after an attempt and in results).
- Tests: `tests/suspension.test.mjs` (32), `tests/suspension-mod.test.mjs` (1), `tests/suspend-policy.test.mjs` (30). Stub host names added to the claude-polling and recovery-lifecycle mocks, and their timer list is now `[3000, 10000, 15000]` (approved by t4).
- Open: `root` is `shell` whenever the main program is not the agent (a non-shell wrapper also counts as `shell`). The 60 s heartbeat `setShared` is idle work that README "Idle work" should mention (ticket 13). GLOSSARY "Unused agent" says "the focused tab"; the code means the focused tab of any window.
