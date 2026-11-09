# Herdr app 0.1.13 → installed 0.1.14

## Release boundary and evidence

This report uses the **shipped tag**, not current `master`:

- `v0.1.13` = `93b097f6e29fcb2d90a30dea2f03ce4e5dee7981`.
- `v0.1.14` = `2405bf388c568c3ed479f05b8e405ccfa44b3f2c` ([tag API](https://api.github.com/repos/herdrdev/herdr-app/git/ref/tags/v0.1.14), [release commit](https://github.com/herdrdev/herdr-app/commit/2405bf388c568c3ed479f05b8e405ccfa44b3f2c)). The [tagged changelog](https://github.com/herdrdev/herdr-app/blob/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/CHANGELOG.md#L3-L38) dates it **2026-11-08**.
- [Exact comparison](https://github.com/herdrdev/herdr-app/compare/93b097f6e29fcb2d90a30dea2f03ce4e5dee7981...2405bf388c568c3ed479f05b8e405ccfa44b3f2c): **45 commits**. The [GitHub releases API](https://api.github.com/repos/herdrdev/herdr-app/releases) returned an empty list; `gh release view v0.1.14` failing does **not** mean the tag is absent. There is no GitHub release body to cite from this repository at inspection time.
- Prior research checkout `adf94cb2c9b6f1cadbb31c51f84114b1aa332f0a` is an ancestor **five commits before** the release, not the release itself. Those final commits include the important mod-code reuse change below.
- Installed `~/.config/herdr-app/update-notes.json` records `last_run: "0.1.14"`. Installed `herdr.d.ts` exactly matches the tagged file: SHA-256 `814d0115fbf97638ff030fde8ea2836710244d3093ebc28aa56f696d6dc34e03`.

Research used a separate read-only source checkout in a temporary directory; the prior checkout was not modified. No installation, commits, native/UI edits, or subagents were used. Only this report was written in the config repository.

## Highest-priority implications for this config

### 1. Mod lifetime changes: real compatibility consideration

**New behavior:** unchanged module code and module-scope state are shared across copies and persist even after all copies close. Keep per-copy state and host calls in `constructor`/`init`; instances, tasks, and `localStorage` remain per-copy. This fixes accumulating mod memory and the eventual “This view could not be re-rendered” failure; upstream also reports faster opening. Sources: [029323e — reuse mod code](https://github.com/herdrdev/herdr-app/commit/029323e10ccc6e862790adb4102941341d89b3b7), [tagged author guidance](https://github.com/herdrdev/herdr-app/blob/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/defaults/AGENTS.md#L879-L893), [reload semantics](https://github.com/herdrdev/herdr-app/blob/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/vendor/gpui-kit/crates/shell/README.md#L149-L155).

**Config consequence:** at initial inspection, [`herdr/mods/tab-tree/resume.js`](../../herdr/mods/tab-tree/resume.js) used module-global `let queue = Promise.resolve()` and chained recovery work onto it. Under 0.1.14 that queue survived closing/reopening a copy. Parent t4's audit identified this as the custom mods' mutable module-global state; other inspected state was class-owned or constant. If a cancelled copy leaves queued work unresolved, a future copy could remain behind it. **At initial inspection this was an unverified risk. The authorized follow-up reproduced it with the actual TabTree and mocked host boundaries, then fixed it** (see results below). This affects Pi too because recovery shares the queue with other recovery paths.

### 2. Pi recovery remains custom; app fixes do not replace the labels

The app update does **not** add a Pi session-resume API or replace this config's `herdr.last-agent` / `herdr.pi-recovery` metadata. The [Pi extension](../../pi/extensions/herdr-recovery/index.js) records the session file, ID, cwd, and launch args; the [recovery mod](../../herdr/mods/tab-tree/resume.js) validates the session header and chooses exact resume versus picker. Retain that mechanism.

Relevant shipped improvements:

- [0e1b180 — reconnect/layout preservation](https://github.com/herdrdev/herdr-app/commit/0e1b180cfdeecece1101339c1f47fb4207fc7efe): an attach/reconnect failure is not treated as proof of program exit; removing an ended layout terminal preserves surrounding layout structure. This is layout/connection recovery, **not conversation recovery**.
- [933b671 — unavailable inherited cwd](https://github.com/herdrdev/herdr-app/commit/933b671d4c784875c4a4da50bbba91c44807e5fe) and [b9ec933 — rapid launches](https://github.com/herdrdev/herdr-app/commit/b9ec93398e957b3e14bbb779921ac69b7926eca5): new spaces/tabs/splits retry a failed inherited folder in the machine's home and retain correct launch folders during rapid creation. Explicit invalid folders still fail. Do not assume this repairs a custom shell command's `cd` or invalid Pi session path.
- [3958447 — Codex identity](https://github.com/herdrdev/herdr-app/commit/3958447240b2dceda5b94a9354237c973e431db5): built-in menu launches use `codex --no-daemon` so sessions do not share the first terminal's identity/lifetime. Requires Codex **0.156+**, per the tagged changelog. This is not a Pi change and does not rewrite independently authored launch commands.

Parent observes **herdr-core 0.1.19**, but the prior installed core version was not recorded. App and core have independent versions; do not attribute all current core recovery/identity behavior to the app's 0.1.13→0.1.14 diff.

### 3. Custom jobs previews: keep the inset, respect focus targeting

The native/default visual fixes are specific, not a general rounded clipping fix:

- [df2d998](https://github.com/herdrdev/herdr-app/commit/df2d99833ee228dd5d9d2dd25137016e99dd4986): Settings stops painting a square inner background over the dialog frame's rounded background.
- [4ec317d](https://github.com/herdrdev/herdr-app/commit/4ec317d5e82a4aa869255924c020fe583c7ad7ac): Confirm's own background gains `.rounded(8)`.
- [87e57ca](https://github.com/herdrdev/herdr-app/commit/87e57ca9df4b3a989b493cb151825bfb79f6c2f6): Confirm is content-sized instead of fixed-height.
- [be1e225](https://github.com/herdrdev/herdr-app/commit/be1e225884999439921ccb7d20fc2d3383749542): Settings layout-card images get explicit height and overflow containment. These “previews” are **Settings cards**, not background-job terminal peeks.

There is no `defaults/mods/peek` change in the tag diff. Nothing in these fixes establishes rounded clipping for the custom terminal composition. Keep the 8px inset in [`tincho-status/preview.js`](../../herdr/mods/tincho-status/preview.js); removal is not justified by these release notes.

[96c7b56 — overlay-terminal focus](https://github.com/herdrdev/herdr-app/commit/96c7b56748e695c5f6fe4083b2844a485e2c6aa7) changes `focused()` when a terminal in an overlay layout holds the keyboard: `terminal`/`cwd` describe that terminal and `pane`/`shown` are null. **Implicit pane commands still act on the focused pane underneath that window.** Custom preview/menu actions should use their explicit terminal/pane target, not assume all commands follow `focused().terminal`. [Installed-compatible type documentation](https://github.com/herdrdev/herdr-app/blob/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/defaults/herdr.d.ts#L220-L232).

### 4. Custom Files/Changes: separate copies do not inherit every fix

Parent t4 owns the detailed installed-vs-config comparison and supplied these results:

- Shipped Files `main.js` and assets are unchanged against recorded provenance.
- Shipped Changes has only the [#474 layout/scroll fix, e4906d2](https://github.com/herdrdev/herdr-app/commit/e4906d25073810afe35cce2a980fdd2019051c9a): replace the capped 200px `overflow_y_scrollbar()` list with a flex-sized wrapper, inner `overflow_y_scroll()`, and explicit `Scrollbar`.
- At initial inspection `tincho-changes` retained the old layout and **did not inherit that fix**. The subsequent authorized port now includes the exact upstream render-tree change while retaining our idle/polling guards (see results below).
- All installed repo-owned files byte-match the repository. Parent reports **all seven custom mods pass native checks** (tree, status, Files, Changes, menu, picker, tag prompt) and **all 126 Node tests pass** under the current environment. These checks were not repeated here; they do not prove cancellation/reopen safety for the recovery queue.

## Notifications, sounds, blocked state, and custom status/tree

**New:** toast agent names use the same programs table as mods (including user overrides), rather than a hardcoded name switch. An explicit terminal name still wins. `terminal.keep`'s fallback naming benefits too. [71ddd21](https://github.com/herdrdev/herdr-app/commit/71ddd21398e0a356a845631ea3f23c4d0af9859a).

**Unchanged policy:** a transition into `blocked`/`error` from outside that pair alerts; finishing from a busy state alerts only when not being watched. Sub-agent alerts and terminals outside the app's panes are filtered out. Sounds are gated by `settings.sounds.enabled`; a blocked alert can sound while watched, but the toast is suppressed when watched. `error` maps to UI `blocked`. Sources: [status/alert rules](https://github.com/herdrdev/herdr-app/blob/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/src/model.rs#L461-L537), [sound/toast routing](https://github.com/herdrdev/herdr-app/blob/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/src/window.rs#L2082-L2131); these rules and `src/sound.rs` are unchanged by the exact tag diff. Do not advertise new blocked-state detection or new sound controls in 0.1.14.

Built-in Agents now lists kept sub-agents once under their parent (unless pinned; collapsed behavior differs), focuses their pane when present, and uses individual agent titles when several share a tab: [2c4b73f](https://github.com/herdrdev/herdr-app/commit/2c4b73f611bd62d848bfbf9c0d5cdee8534cc335), [a167060](https://github.com/herdrdev/herdr-app/commit/a167060ef1bf5180ba93e4cd7de4f92267b9775b). These are **default Agents mod changes**, not automatic rewrites of our custom tab-tree/status rendering. [d9f9c5c](https://github.com/herdrdev/herdr-app/commit/d9f9c5c16487068467a55f146fa02ef27c9d6acc) is a host/model fix: focusing another pane while zoomed now shows that pane, so custom navigation using host focus can benefit directly.

The PR on/off feature remains custom: [`tincho-status/main.js`](../../herdr/mods/tincho-status/main.js) reads the shared toggle and gates polling/results. The app release adds no equivalent PR switch and provides no reason to enable it or remove the custom guards. No setting was changed.

## Palette: execution still does not imply discoverability

0.1.14 fixes scrolling past group headings and uses the command-symbol icon only on macOS: [a58ad8b](https://github.com/herdrdev/herdr-app/commit/a58ad8b95bd1d06fb3220929ed020e53773d2ace), [9532072](https://github.com/herdrdev/herdr-app/commit/953207277714d9187b0566b6cf25ee0db3b76d17).

It **does not add custom-command registration**. [Tagged palette entries](https://github.com/herdrdev/herdr-app/blob/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/defaults/frame/palette/main.js#L80-L98) still derive from named built-ins, layouts, and `commands()`; [the host catalog](https://github.com/herdrdev/herdr-app/blob/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/src/mods.rs#L1047-L1055) still returns compile-time `commands::COMMANDS`. A custom keybinding is not a palette contribution. The previous [palette research](herdr-command-palette.md) conclusion therefore still holds for the shipped tag: `tincho-status.background-jobs` can execute without becoming discoverable in the built-in palette.

## Performance, terminal behavior, and other API changes

| Shipped change | User/config significance | Primary source |
|---|---|---|
| Shared mod code and watcher revalidation | Avoid cumulative mod-memory exhaustion; unchanged source is reused; watcher rescans revalidate sources without needless hot reloads. No benchmark was run here. | [029323e](https://github.com/herdrdev/herdr-app/commit/029323e10ccc6e862790adb4102941341d89b3b7), [7fe7ac3](https://github.com/herdrdev/herdr-app/commit/7fe7ac34fef8a3ee76cb5d2f17bc8d6331e50bd8) |
| Toast clocks only while toast is mounted | Eliminates each idle mod root waking 20 times/sec just to check an empty toast list; separate from custom polling guards. | [cfcf836](https://github.com/herdrdev/herdr-app/commit/cfcf836404f932817f10f88455c33e33c94fd1df) |
| Wait briefly for terminal layout before replay | Prevents truncated long lines/output at initial attachment; bounded 100ms wait, with retry if size changed during attach. Relevant to terminal previews too, but not a promise of faster throughput. | [0b24b69](https://github.com/herdrdev/herdr-app/commit/0b24b692b29c9f064781a463deaf644b1d576a03) |
| Mouse-aware selection and wide search matches | Clicking a mouse-handling program clears stale app selection; search includes the full trailing wide character. | [c281f52](https://github.com/herdrdev/herdr-app/commit/c281f52ad624cef48b918a8ea3b29853bc83da5a), [4ed0efd](https://github.com/herdrdev/herdr-app/commit/4ed0efd3af37fdbfcae5b9f5d491d82d36a371b9) |
| `exec(cmd, args, { timeout })` | Additive millisecond option: default 30,000, maximum 600,000; local and remote. Default remains unchanged. Large worktree operations use it; our calls do not become long-running automatically. | [e77f112](https://github.com/herdrdev/herdr-app/commit/e77f112ac2ea136b84fe510efa42d41163bfd776), [types](https://github.com/herdrdev/herdr-app/blob/2405bf388c568c3ed479f05b8e405ccfa44b3f2c/defaults/herdr.d.ts#L10-L14) |
| `pane.swap {pane?, target}` | Additive explicit-ID swap within the same tab; choose `direction` or `target`, not both. Focus stays with the same pane. Existing directional calls remain supported. | [207dbdc](https://github.com/herdrdev/herdr-app/commit/207dbdcc59e941fc127a6280dbd646421e67b539) |
| Safer `herdr-app check` | On macOS no stray Dock icon/caller-coalition behavior that could terminate terminals; check uses transient empty shared state instead of touching live `shared.json`. Relevant to our validation workflow. | [ab4dfef](https://github.com/herdrdev/herdr-app/commit/ab4dfefebe4a063615f0061042d60287802ba255), [f92d0f1](https://github.com/herdrdev/herdr-app/commit/f92d0f1ee7b404475dda96bdf1c16ce586ef3b35) |
| Close shortcuts respect modal UI | Implicit Cmd+W/Cmd+Shift+W close Settings/palette/picker rather than terminal behind it. Explicit target commands retain their targeting. | [1eb838f](https://github.com/herdrdev/herdr-app/commit/1eb838f13bb82c74aff317c065f0bd8db1d7b754) |
| Core connection/setup diagnostics | Connection errors are explained rather than misrepresented as missing installation; unusable connect binary can still offer installation. Add-machine prompts give commands to run instead of launching a setup terminal. | [e5ba294](https://github.com/herdrdev/herdr-app/commit/e5ba294ac187aa12d6f7e72ebfb59eb4ebeabd65), [72c7f3d](https://github.com/herdrdev/herdr-app/commit/72c7f3dc6e6a9ab7ec247f701355a9bd06d78dd7), [adf94cb](https://github.com/herdrdev/herdr-app/commit/adf94cb2c9b6f1cadbb31c51f84114b1aa332f0a) |

The `herdr.d.ts` tag diff contains only the `exec` timeout addition, `pane.swap` arguments, and overlay `focused()` clarification. That narrow signature diff is **not** proof of unchanged runtime semantics: module lifetime is the important extra contract change.

## Follow-up results

**Automatically inherited:** host mod-memory/idle-clock fixes, terminal attachment/selection fixes, host navigation/focus behavior, and the shipped Settings/Confirm changes. **Not automatically inherited:** source edits to separately copied custom mods, notably Changes' list layout; default Agents rendering changes likewise do not rewrite our tab-tree.

After the user authorized both follow-ups:

1. **Recovery lifetime reproduced and corrected.** `tests/recovery-lifecycle.test.mjs` exercises the real TabTree init/button/close flow with mocked native operations. Cancelling a pending Claude sleep with queued Pi work left replacement recovery blocked in the original code. The native scheduler confirms cancelled sleeps/host awaits remain pending. `createRecovery()` now owns its queue per sidebar instance; synchronous `close()` invalidates old queued work and guarded follow-ups. New copies proceed independently. Tests cover pending hc/exec/sleep, late completions, `/exit` boundaries, rejected work, once-only exact Pi recovery, bounded Claude retries, and independent copies. Disabling the close guard in a mutation caused 10 of 13 lifecycle tests to fail. Already-issued commands cannot be recalled; separate sidebar copies no longer share serialization. No real user recovery session was exercised.
2. **Changes scrolling ported.** The render tree now matches shipped 0.1.14 exactly, with no changes to our idle guards or Git actions. The regression test went red on the old code and green after the port; it checks empty, 2-, 50-, and 1,000-file lists, viewport/scrollbar structure, and last-row selection. All 48 panel tests and the native loading check passed. This structural test is not a native wheel/drag interaction test.
3. **Existing integrations retained.** Pi recovery labels, jobs-preview inset, custom PR toggle behavior, and current palette workaround remain in place. None is superseded by this release.

Final follow-up verification: **140 Node tests** and all **nine installer test
groups** passed. One-shot `./install.sh` installed the two code fixes and Changes
provenance with no conflicts. Installed TabTree and Changes native checks passed;
the running app reported no errors. No real user recovery session was interrupted.

Evidence is tagged source inspection plus the explicit installed-file checks above and parent-reported compatibility results. No native interaction/recovery stress test, performance benchmark, or app-binary reproducibility check was performed by this researcher.
