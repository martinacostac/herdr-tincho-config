# 09: Suspend now and Never suspend menu items

**What to build:** Manual control over suspension from the tab's right-click menu, for agent tabs on this machine.

- **Suspend now** requests a manual suspension through the policy's shared-state entry point (ticket 07). It skips only the time threshold. When a rule fails, the menu says which one: focused, working, blocked, background processes, pinned, not resumable, remote, or feature not installed.
- **Never suspend** sets or clears `herdr.never-suspend=1` on the terminal, and the item shows the current state, so that a pinned agent can be unpinned from the same menu.

Manual suspension works also when automatic suspension is turned off.

**Blocked by:** 07 (manual suspension entry point and reasons)

Status: done

- [x] Agent tabs show Suspend now and Never suspend; other tabs, panes, spaces and remote terminals do not show them
- [x] Suspend now on an eligible agent requests the suspension
- [x] Suspend now on an ineligible agent shows the failing rule, for each reason in the list
- [x] Never suspend sets the pin, and the item then offers to remove it
- [x] Tests with a mocked host cover the items, the reasons and the pin toggle
- [x] Only the tab-menu mod changes

## Comments

Done in 7c4dc7d (implementation and tests) and a8ced3f (review fixes).

- herdr/mods/tab-menu/main.js: agent tabs on this machine (program.agent, an agent report, or the `herdr.suspended` label) get **Suspend now** and **Never suspend**. Plain tabs, panes, spaces, the global menu and remote terminals do not get them.
- Suspend now merges `{[address]: Date.now()}` into `tincho.suspend.requests`. The menu stays open: "Suspending…" until `results[address].requested >= at`, then "Suspended" or "Can't suspend: <reason>". After 60 s (REQUEST_MS) with no result, the item shows "no answer from tab tree". This is checked on render, with no timer. A pending request is not sent again.
- Before a request, the item shows "Can't suspend: <reason>" from the labels (suspended, pinned) and from `agents[address].manual`. The item stays clickable, so the rules are checked again. Every policy reason has its own text. An unknown reason shows as its own word.
- Never suspend runs `hc label <t> herdr.never-suspend=1`. When the agent is pinned, the item reads "Remove Never suspend" and runs `hc label <t> herdr.never-suspend=`. A failed change posts an error notification.
- tests/tab-menu.test.mjs: 14 tests with a mocked Herdr host and UI kit.
- Open: the tab popup height (200 px in tab-tree/main.js) clips the last item. Ticket 08 changes it to 270, as agreed with t4.
