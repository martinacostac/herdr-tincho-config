# 14: Repair stale suspension states

**What to build:** Two failure paths leave a terminal in a state that does not match what runs in it. The sidebar and the policy repair both on their own, so a tab never shows 💤 or "waking…" for a live agent, and ↻ is never hidden on a terminal that only has a shell.

1. **Stale "waking…"**: after a wake, the stand-in's `working` report stays until the woken agent reports. If the agent never reports (it exits first, or Claude misses its status handshake), the row shows "waking…" forever, and ↻ stays hidden. A terminal counts as waking only while both of these hold: its report comes from the stand-in (`app=herdr-standin`), and either the foreground program is still the stand-in or the wake began less than 30 s ago. After that, the row shows what actually runs there, using the foreground evidence: a shell with ↻, or a plain program.
2. **Label without a stand-in**: the `herdr.suspended` label can stay on a terminal whose main program is not a stand-in. That happens when the mod closes between suspension step 4 (label) and step 5 (signal), or when the label is set by hand. The leading policy copy repairs it in its regular pass, at no extra idle cost. When a labeled terminal is live, its foreground program is not the stand-in, and the label's `since` is older than 60 s, it removes the label and records the repair in the shared results.
3. **Failures in automatic passes**: automatic suspension failures (signal failed, rolled back, repaired) are recorded in the same shared results that manual requests use, so the menu and the docs can show them.

**Blocked by:** 08 (done).

Status: done

- [x] "waking…" ends at the latest 30 s after a wake when the woken agent never reports. Then ↻ appears if a shell is in front.
- [x] A label on a live terminal without a stand-in, older than 60 s, is removed by the leader's regular pass. A label younger than 60 s, or on a terminal whose stand-in runs, is left alone.
- [x] Automatic failures and repairs appear in the shared results.
- [x] No new periodic timer: the recovery-lifecycle timer list stays [3000, 10000, 15000].
- [x] Tests with the mocked host cover each case, including the 30 s and 60 s boundaries.

## Comments

Done in f4eeb01 and a4ec43f (review fixes).

- `resume.js`: `frontProgram()` (what runs in front, from the foreground argv; a `sh -c '"$@"; exec …'` wrapper counts as its command; herdr-shell is named as such), `standinInFront()`, `waking()` (the stand-in's `working` report, and the stand-in in front or `status_ms` less than `WAKE_MS` = 30 s ago). Recovery refuses a terminal with the label, or with a stand-in report while it is waking or no shell is in front. So after a stale wake, ↻ works again when a shell is in front.
- `main.js`: `shownPane()` drops a stale stand-in report. The row shows the shell (with ↻) or a plain program from the foreground evidence, and the tab's status is computed again. One `cx.sleep` re-renders at the earliest end of a wake; the timer list stays [3000, 10000, 15000]. A live agent that reports its own status never shows 💤, even with a leftover label.
- `suspend-policy.js`: the leader's pass removes a label from a live local terminal when hc shows a program in front that is neither the stand-in nor herdr-shell, and the label's `since` is 60 s old or more (or unreadable, e.g. set by hand). It reads the terminal again first. This runs also while automatic suspension is off. Results gain `source` ("manual", "auto" or "repair"), `step` ("keep", "label" or "signal") and `rolledBack` (signal failures). The existing fields stay. Automatic failures (`reason: "failed"`) and repairs (`reason: "repaired"`) are shared. An automatic or repair result keeps the `requested` value of the result it replaces, so a request is answered once.
- `recipes.js`: `STANDIN_APP` lives here now.
- Tests: new cases in `sidebar-suspension` (whole-sidebar render, 30 s boundary, re-render sleep), `recovery-lifecycle` (stale wake with shell, agent or wrapper in front) and `suspension` (60 s boundary, stand-in/herdr-shell/no foreground left alone, re-read, leader only, auto failures per step, no double request).
- Interpretation: the label is also left alone while herdr-shell is in front, because herdr-shell waits without a shell when it cannot start the stand-in. Removing the label there would let the next message start a shell (user story 28).
- Open: (1) tab-menu's REASONS has no text for "repaired", so a menu still open could show "Can't suspend: repaired". (2) GLOSSARY.md has no entry for the label repair. (3) A review suggested that `frontProgram`/`waking` belong in recipes.js or their own module, not in resume.js. They stay in resume.js (file limits). (4) The stand-in (`suspend/standin.ts`) still has its own APP literal.
