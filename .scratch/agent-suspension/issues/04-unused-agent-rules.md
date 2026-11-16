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

**Status:** ready-for-agent

- [ ] Mocked-host tests cover every rule and its failure reason
- [ ] The idle clock uses the later of status time and focus time, and only the status time when no focus time is known
- [ ] Helper matching uses "the command line contains the entry"; tests cover the default allow-list, a custom allow-list, and a non-helper descendant
- [ ] Tests cover the settings defaults, `false`, and `after_minutes: 0`
- [ ] The manual mode skips only the threshold and works while automatic suspension is off
- [ ] A remote terminal and a terminal with child terminals give the expected results
- [ ] The module is a new file. No existing file is changed
