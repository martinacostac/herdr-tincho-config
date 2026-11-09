# Personal Changes clone

Source: the installed Herdr Changes mod at
`<Herdr app home>/mods/changes/`. All runtime files were read before
copying. This is a personal clone, not a replacement for Herdr's shipped mod.

`<Herdr app home>` is `$HERDR_APP_HOME` when set, otherwise
`${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app`.

The original directory supplied no LICENSE or copyright notice. Existing source
comments and SVG contents are retained; no new license is asserted for upstream
code or assets.

Original 0.1.13 runtime-file SHA-256 values (before the port below):

| File | SHA-256 |
| --- | --- |
| main.js | 2bd69311fd3dbfc001f8bb9fbfd7bffe203e7455df0bf1a06516405b82bbc0fa |
| mod.json | e8e0a91d23a0addf19f9f4dab48f597f252a1d44e5063e4d6ae884a88cbf735d |
| changes.svg | 8370414f7d5bd16e2a21e0b83c4e95c75674bd241ce4d83cf91762d620647fb3 |

Upstream port: Herdr 0.1.14's [Changes list sizing/scroll fix (#474)](https://github.com/herdrdev/herdr-app/commit/e4906d25073810afe35cce2a980fdd2019051c9a).
The file list uses a flex-sized viewport and an explicit scrollbar instead of
an implicitly wrapped, fixed-200px list. The port is limited to the render tree;
it does not replace our idle lifecycle or Git actions.

Personal changes: visibility/context guards, stale-result rejection, bounded
watcher/fallback refresh, unchanged-snapshot redraw suppression, and input cleanup.
The Git status/diff rendering, selected diff, and add-all/commit action remain
based on the shipped implementation. A requested commit finishes even if the
panel hides; background refresh and notification do not follow it while hidden.

Includes local `work.js` because Herdr forbids imports outside each mod's
application directory. Keep it identical to Files' helper; the regression test
checks equality. `../tincho-panel/CONTRACT.md` documents visibility and the bounded
native-wait budget; it is not a runtime dependency. These copies target the unique
Files and Changes layout blocks, not arbitrary duplicate mod panes or overlays.
