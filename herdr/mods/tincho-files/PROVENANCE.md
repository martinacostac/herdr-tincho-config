# Personal Files clone

Source: the installed Herdr Files mod at
`<Herdr app home>/mods/files/`. Runtime files were read before
copying. This is a personal clone, not a replacement for Herdr's shipped mod.

`<Herdr app home>` is `$HERDR_APP_HOME` when set, otherwise
`${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app`.

The original directory supplied no LICENSE or copyright notice. Existing source
comments and SVG contents are retained; no new license is asserted for upstream
code or assets. The chevron/folder SVGs identify Lucide in their original markup.
Generated editor tooling (`gpui-kit.d.ts` and `jsconfig.json`) is not vendored.

Original runtime-file SHA-256 values:

| File | SHA-256 |
| --- | --- |
| main.js | 33a7f26f03b9b3579d30fc97498b9f3cbbdcb59b983c91ce6bea3cc2eabe273b |
| mod.json | e8e0a91d23a0addf19f9f4dab48f597f252a1d44e5063e4d6ae884a88cbf735d |
| chevron-down.svg | be2f2e86753c4c6bc19b1cc196611b18597cc7a553580ed2bdf80f26a5e2440d |
| chevron-right.svg | 280d2c796344a22fb6cb7086edc90868a27c7812405cffb9be66a3c5835aa898 |
| file.svg | aad5bc0712faa95774727b83b9b7d1bc3ff28d781a838fc7693b9c9ae7383a4b |
| folder.svg | 9d7567649afffe0523114fcff3ac9da0504ac24cabc35e0b1dc0a4d90a34beb8 |

Personal changes: visibility/context guards, stale-result rejection, bounded
watcher/fallback refresh, unchanged-snapshot redraw suppression, editor cleanup,
and asset prefix renamed to `mods/tincho-files/`. The file tree and preview UI,
directory parsing (including remote Windows fallback), and selection behavior
remain based on the shipped implementation.

Includes local `work.js` because Herdr forbids imports outside each mod's
application directory. Keep it identical to Changes' helper; the regression test
checks equality. `../tincho-panel/CONTRACT.md` documents visibility and the bounded
native-wait budget; it is not a runtime dependency. These copies target the unique
Files and Changes layout blocks, not arbitrary duplicate mod panes or overlays.
