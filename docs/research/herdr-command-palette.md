# Herdr custom command-palette entries

## Scope and conclusion

Inspected official `herdrdev/herdr-app` master at `adf94cb2c9b6f1cadbb31c51f84114b1aa332f0a`, released `v0.1.13` at `93b097f6e29fcb2d90a30dea2f03ce4e5dee7981`, and this machine's installed palette. Custom mod commands execute, but neither version provides a registration mechanism to make them discoverable in the built-in command palette. This is a source-code finding, not merely missing documentation.

The exact gap is tracked by open upstream [issue #211: Mods can't add entries to the command palette](https://github.com/herdrdev/herdr-app/issues/211). Its comments also describe affected mods on macOS and Windows.

## Source trace

- [Palette entries](https://github.com/herdrdev/herdr-app/blob/adf94cb2c9b6f1cadbb31c51f84114b1aa332f0a/defaults/frame/palette/main.js#L80-L98) come from the fixed named entries, layouts, and `commands()`. Keybindings supply shortcut labels, not new entries. There is no mod metadata or shared-storage contribution lookup.
- [JavaScript `commands()`](https://github.com/herdrdev/herdr-app/blob/adf94cb2c9b6f1cadbb31c51f84114b1aa332f0a/src/mods.rs#L1044-L1053) returns only Rust's compile-time [`commands::COMMANDS`](https://github.com/herdrdev/herdr-app/blob/adf94cb2c9b6f1cadbb31c51f84114b1aa332f0a/src/commands.rs#L12-L30). It merges no dynamic registry. The complete host-module builder has no custom command registration export.
- [Custom execution](https://github.com/herdrdev/herdr-app/blob/adf94cb2c9b6f1cadbb31c51f84114b1aa332f0a/src/window.rs#L2771-L2780) is a separate fallback: split an unknown dotted name and send its suffix to the mod's `nextCommand()` channel. Executability does not register a label or description for discovery.
- [`mod.json` hints](https://github.com/herdrdev/herdr-app/blob/adf94cb2c9b6f1cadbb31c51f84114b1aa332f0a/src/mods.rs#L336-L386) cover place, size, and focusability. The separate overlay metadata controls opening a mod, not catalog contributions. No hidden `commands`/`palette` field is consumed.
- [`app.palette`](https://github.com/herdrdev/herdr-app/blob/adf94cb2c9b6f1cadbb31c51f84114b1aa332f0a/src/window.rs#L3327-L3336) targets `frame-palette` directly. [Frame files are overwritten at startup](https://github.com/herdrdev/herdr-app/blob/adf94cb2c9b6f1cadbb31c51f84114b1aa332f0a/src/mods.rs#L75-L80), so patching the installed palette is temporary.

## Verification

Cloned source into a temporary directory; fetched tag `v0.1.13` without changing the checkout. No source build or installed-app modification.

An isolated Node harness evaluated the actual palette JavaScript for master, v0.1.13, and the installed copy:

1. A custom keybound `tincho-status.background-jobs` command does not appear in entries or search results.
2. Positive control: injecting that command into the mocked host `commands()` catalog makes it discoverable and executing the result dispatches the expected custom command.
3. All three variants passed these assertions.

Harness: a temporary local `check-palette.mjs` script (not included in this repository). Upstream `bun test scripts/palette.test.ts`: 3 passed, 0 failed. Backend conclusions are static inspection; no Rust build/tests were run. Master-v0.1.13 palette differences concern icon selection and scrolling, not entry discovery.

## Implication for this config

`tincho-status.background-jobs` is executable but cannot be contributed to the built-in palette through an existing config/API hook. This repo's Set tag action belongs to its custom right-click menu, not the palette.

Durable built-in integration requires upstream palette contribution support. A personal replacement palette is possible but would replace rather than extend the built-in UI and require maintenance; it was not implemented. No shortcuts were installed and no upstream issue/PR was created during this investigation.
