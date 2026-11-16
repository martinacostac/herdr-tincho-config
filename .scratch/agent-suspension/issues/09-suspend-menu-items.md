# 09: Suspend now and Never suspend menu items

**What to build:** Manual control over suspension from the tab's right-click menu, for agent tabs on this machine.

- **Suspend now** requests a manual suspension through the policy's shared-state entry point (ticket 07). It skips only the time threshold. When a rule fails, the menu says which one: focused, working, blocked, background processes, pinned, not resumable, remote, or feature not installed.
- **Never suspend** sets or clears `herdr.never-suspend=1` on the terminal, and the item shows the current state, so that a pinned agent can be unpinned from the same menu.

Manual suspension works also when automatic suspension is turned off.

**Blocked by:** 07 (manual suspension entry point and reasons)

**Status:** ready-for-agent

- [ ] Agent tabs show Suspend now and Never suspend; other tabs, panes, spaces and remote terminals do not show them
- [ ] Suspend now on an eligible agent requests the suspension
- [ ] Suspend now on an ineligible agent shows the failing rule, for each reason in the list
- [ ] Never suspend sets the pin, and the item then offers to remove it
- [ ] Tests with a mocked host cover the items, the reasons and the pin toggle
- [ ] Only the tab-menu mod changes
