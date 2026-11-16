# 04: Unused agent rules with reasons

**What to build:** The policy module's eligibility rules: given a terminal, the settings and the last focus time of its tab, it says whether the agent is an unused agent, and when it is not, which rule failed. It is pure logic over host data, tested with a mocked Herdr host. It is not yet connected to the mod (ticket 07 does that).

The rules, each with its own failure reason:

- Resumable: the agent is Claude or Pi, with its session label or record.
- Idle: status `idle` or `done` for at least the threshold, counted from the later of the status time and the last focus time of its tab. After an app restart there is no focus time, so only the status time counts.
- Not focused, not `working`, not `blocked`.
- Not pinned (`herdr.never-suspend=1`).
- Local (the address has no machine prefix).
- Every descendant process of the agent is a helper: its command line contains an entry of the helper allow-list.

Child terminals do not prevent eligibility.

Settings come from the Herdr app settings key `tincho.suspend` (`after_minutes` and `helpers`). A missing key gives 30 minutes and `["mcp"]`. The value `false` or `after_minutes: 0` turns automatic suspension off. A manual mode skips only the threshold rule and still applies all other rules, also when automatic suspension is off.

**Blocked by:** 02 (shared recipe module: labels and record parsing)

**Status:** done

- [x] Mocked-host tests cover every rule and its failure reason
- [x] The idle clock uses the later of status time and focus time, and only the status time when no focus time is known
- [x] Helper matching uses "the command line contains the entry"; tests cover the default allow-list, a custom allow-list, and a non-helper descendant
- [x] Tests cover the settings defaults, `false`, and `after_minutes: 0`
- [x] The manual mode skips only the threshold and works while automatic suspension is off
- [x] A remote terminal and a terminal with child terminals give the expected results
- [x] The module is a new file. No existing file is changed

## Comments

Done in f9f2743 and 3f19990 (review fixes). New files: `herdr/mods/tab-tree/suspend-policy.js` and `tests/suspend-policy.test.mjs` (27 tests). No existing file is changed.

- `unusedAgent(terminal, { now, focusedAt, manual })` returns `{ unused: true, agent }` or `{ unused: false, reason }`. The checks run in this order: `off`, `remote`, `not-resumable`, `pinned`, `focused`, `working`, `blocked`, `not-idle`, `recent`, `processes-unknown`, `background`. The terminal can come from `terminals()` or from `hc get`. The process check needs `foreground.pid`.
- `suspendSettings()` reads `tincho.suspend` and returns `{ auto, afterMinutes, helpers }`. It drops empty helper entries. Invalid fields keep their defaults.
- `NEVER_SUSPEND` (`herdr.never-suspend`) is exported from the policy module, because recipes.js could not be changed in this ticket.
- Descendant processes come from `ps -axo pid=,ppid=,command=` through the host `exec`.

Open points for ticket 07: helpers apply to every descendant, including the children of an MCP server. `focused()` sees only the focus of its own window. A missing `status_ms` gives the reason `recent`.
