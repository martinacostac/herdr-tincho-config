# 14: Repair stale suspension states

**What to build:** Two failure paths leave a terminal in a state that does not match what runs in it. The sidebar and the policy repair both on their own, so a tab never shows 💤 or "waking…" for a live agent, and ↻ is never hidden on a terminal that only has a shell.

1. **Stale "waking…"**: after a wake, the stand-in's `working` report stays until the woken agent reports. If the agent never reports (it exits first, or Claude misses its status handshake), the row shows "waking…" forever, and ↻ stays hidden. A terminal counts as waking only while both of these hold: its report comes from the stand-in (`app=herdr-standin`), and either the foreground program is still the stand-in or the wake began less than 30 s ago. After that, the row shows what actually runs there, using the foreground evidence: a shell with ↻, or a plain program.
2. **Label without a stand-in**: the `herdr.suspended` label can stay on a terminal whose main program is not a stand-in. That happens when the mod closes between suspension step 4 (label) and step 5 (signal), or when the label is set by hand. The leading policy copy repairs it in its regular pass, at no extra idle cost. When a labeled terminal is live, its foreground program is not the stand-in, and the label's `since` is older than 60 s, it removes the label and records the repair in the shared results.
3. **Failures in automatic passes**: automatic suspension failures (signal failed, rolled back, repaired) are recorded in the same shared results that manual requests use, so the menu and the docs can show them.

**Blocked by:** 08 (done).

**Status:** ready-for-agent

- [ ] "waking…" ends at the latest 30 s after a wake when the woken agent never reports. Then ↻ appears if a shell is in front.
- [ ] A label on a live terminal without a stand-in, older than 60 s, is removed by the leader's regular pass. A label younger than 60 s, or on a terminal whose stand-in runs, is left alone.
- [ ] Automatic failures and repairs appear in the shared results.
- [ ] No new periodic timer: the recovery-lifecycle timer list stays [3000, 10000, 15000].
- [ ] Tests with the mocked host cover each case, including the 30 s and 60 s boundaries.
