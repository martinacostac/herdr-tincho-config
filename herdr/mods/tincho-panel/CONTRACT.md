# Panel work contract

This folder contains documentation only, not a runtime mod. Each personal panel
includes a local `work.js`: Herdr confines module imports to that mod's application
directory, including during `herdr-app check`. The two helper copies must remain
byte-identical; `tests/panel-idle.test.mjs` enforces this. There is no runtime
sibling-folder dependency.

The installed Herdr `AGENTS.md` and `herdr.d.ts` document the live `layout()`
tree, hidden ancestors, and active stack children. A hidden copy remains alive;
`close()` runs on removal, not hide. There is no supported hide/show callback.
The helper reads visibility at render and asynchronous work boundaries, not on a
separate live-snapshot polling loop. It assumes one copy of each personal panel
in the layout, as in `tincho.json`.

- A hidden panel starts no background exec/read/watch follow-up and sends no
  background redraw notifications.
- In-flight exec/read results are ignored after observed hide, focus change, or
  close. An already-running process cannot be cancelled by this helper.
- A one-shot fallback timer may wake once after hiding, then stops. An outstanding
  native `watchFolder` promise cannot be cancelled through the documented API.
  A pending wait is retained and reused if the same root becomes visible again;
  quiet hide/reveal cycles do not allocate more native waits or promise continuations.
  Its event then refreshes the currently visible same-root context using fresh reads.
  If it finishes while hidden, closed, or observing a different root, it does not
  refresh or rearm. Up to four distinct-root waits can remain outstanding per copy;
  additional roots use the 10-second fallback until a wait frees a slot.
- While visible, a local watcher refreshes on events with a 60-second safety
  refresh for missed/ignored changes. Remote and failed-watch paths use a
  10-second fallback; failed local watches and roots beyond the four-wait budget
  retry on refresh.
- Render resumes refresh after an observed suspension or changed location.
  A hide/reveal interval with no intervening callback is not observable. Such
  a panel keeps its existing watcher/fallback freshness bound (60 seconds local,
  10 seconds remote/failed); immediate refresh on every reveal is not guaranteed.
- Explicit user commits are not background refresh. Once requested, add+commit
  can finish while hidden. No hidden background refresh follows the commit.
- No callback context is stored; timer and spawn callbacks use their own context.

The UI and bounded parsing remain in the personal clones. Host-mocked tests in
`tests/panel-idle.test.mjs` load those actual modules.
