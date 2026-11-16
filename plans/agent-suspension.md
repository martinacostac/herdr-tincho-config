# Plan: suspend unused agents

Free the memory of agents nobody is using (about 250 MB each for Pi), the way
Chrome discards idle tabs. Other agents can still reach a suspended agent with
plain `hc send`; hc is not modified.

- Vocabulary: [`GLOSSARY.md`](../GLOSSARY.md) (Suspend, Suspended agent, Wake,
  Stand-in, Unused agent, Pinned agent, Recovery, Launch options).
- Why the design works this way: [ADR 0001](../docs/adr/0001-suspended-agents-reached-through-a-stand-in.md).
- Status: designed and agreed (grilling session, Q1–Q37). No code yet.

## Agreed design

### Who gets suspended

1. **Unused agent**: a resumable agent (Claude or Pi, with session labels)
   where all of these are true:
   - it is idle (`idle` or `done`) for `after_minutes` or longer, measured
     from the later of its `status_ms` and the last time its tab was focused
   - its tab is not focused
   - it is not `working` or `blocked`
   - it is not pinned
   - it is local (no `machine/` prefix)
   - it has no descendant processes except **helpers**: command lines that
     match the `helpers` allow-list, which matches MCP servers by default
2. Child terminals don't prevent suspension. They survive it (verified), and
   a parent waiting on children already counts as `working`.
3. Settings, read with `settings()` from `~/.config/herdr-app/settings.json`:
   ```json
   "tincho.suspend": { "after_minutes": 30, "helpers": ["mcp"] }
   ```
   When the key is missing: 30 minutes and `["mcp"]`. `false` or
   `after_minutes: 0` turns automatic suspension off; manual suspension still
   works.
4. Manual actions in `tab-menu`: **Suspend now** (skips the time threshold,
   but every other rule applies, and the menu says why when one fails) and
   **Never suspend** (the label `herdr.never-suspend=1`).
5. A mod in the Herdr app runs the policy. One copy leads, chosen through
   `setShared`/`shared`. Suspension happens only while the app is open.

### Suspending (in order; abort if any check fails)

1. Check that the agent is still unused (`hc get`).
2. `hc keep <t>`.
3. Check status and `turn` again. Abort if either changed.
4. Set the label `herdr.suspended` to a JSON value:
   `{"version":1,"agent":"pi","root":"shell"|"agent","cwd":"/…","since":<ms>}`.
   `cwd` comes from `foreground.cwd`.
5. Send `SIGTERM` to the terminal's **main program** (`pid`): the agent
   itself when started by `hc run`, or the shell (fish) when the agent runs
   inside one. See open fact F3.
6. hc treats the program as lost and starts its configured `shell`, which is
   `herdr-shell`. Sends during the switch fail with `unavailable` (verified).
   `herdr-shell` sees the label and replaces itself with the stand-in.
   Remaining risk: a message pasted milliseconds before step 5 is lost. Fully
   preventing that would need an hc change.

### `herdr-shell` (`/bin/sh`, a few lines)

- `hc get "$HC_TERMINAL_ID" --json` (about 15 ms; `HC_TERMINAL_ID` is set in
  recovery shells, verified). If the answer has `"herdr.suspended":`,
  `exec herdr-standin "$HC_TERMINAL_ID"`.
- A successful answer without the label means `exec "$SHELL" "$@"`, falling
  back to `/bin/sh` when `$SHELL` is unset.
- If hc is `unavailable` or still starting, retry for up to about 2 s, then
  print an error and wait for input instead of starting a shell. It never
  falls back to a plain shell unless hc answered without the label (F4).

### The stand-in (`herdr-standin`, Bun AOT)

- Build: `bun compile --trim-locales en --no-compile-function-source`
  (about 6.6 MB footprint, 46 MB on disk). Without `bun compile`, fall back
  to `bun build --compile --minify` (about 7 MB footprint, 132 MB on disk).
  Without `bun`, skip the feature and print `suspend: skipped (no bun)`.
- Process name `herdr-standin`, with arguments
  `herdr-standin <agent> <address> <name>`.
- On start, read its own label. If the label is missing (stale), replace
  itself with `$SHELL`.
- Screen: the restored last screen (`restore_screen = true`), then
  `💤 <agent> suspended at HH:MM · wakes on a message or when focused · Enter wakes it`.
- Report `idle` over OSC 7501 (F5).
- Input: raw mode with bracketed paste enabled. Each pasted block or typed
  line followed by Enter is one message; an empty Enter wakes with no prompt.
  It never runs input.
- On the first message, wait 500 ms for more, report `working`, then wake
  with all of them.
- **Wake**:
  1. `chdir(cwd)`.
  2. Remove the `herdr.suspended` label.
  3. `execvp` (through `bun:ffi`, verified to work under AOT) into the shared
     recipe's `argv` plus `--`, then the messages joined with blank lines.
  4. `root=shell` runs it as `/bin/sh -c '<argv> ; exec "$SHELL"'` (about
     1 MB), so `/exit` returns to a prompt. `root=agent` runs it directly, so
     `/exit` ends the terminal, as today.
- Session missing (Pi's file absent or with a different id, or no Claude
  id): don't wake. Write the messages to
  `$XDG_STATE_HOME/herdr-tincho-config/undelivered/<address>-<ms>.txt`, show
  the path, and report `blocked`. hc then notifies the parent.

### What wakes an agent

- Any message, including hc's own notes to a parent.
- The tab staying focused for **1 s** (the mod presses Enter on an empty line
  with `hc keys <t> enter`). Stepping past tabs with ⌘P or `agent.next` wakes
  nothing.
- Enter typed inside the stand-in, for example during `hc attach` from a
  plain terminal.

### Recipes, recovery and launch options

- `recipes.js` returns `{cwd, argv}`. Recovery turns it into the shell line it
  types, as today. The stand-in imports the same module at build time.
- Pi keeps its existing `args.js` launch options (`--no-sandbox`, `--model`,
  and so on; never prompts, credentials or `--name`).
- **Claude gains launch options**: read from `foreground.argv`, filtered
  through an allow-list like Pi's `args.js`, stored in the
  `herdr.claude-options` label, and used by both recovery and waking (F2).
- `tab-tree`: suspended tabs show a dimmed name and 💤, and "waking…" while
  starting. Recovery (↻) never appears for them and refuses to type into a
  stand-in. Its "at a shell" check (`foreground.pid === pid`) passes for
  stand-ins, so it must check the label.
- Suspended agents stay suspended through `hc server stop` or a reboot (F1).
- A crash after the first suspension now leaves a kept terminal with a shell
  and ↻ (an improvement). Keeping every agent terminal is out of scope.

### Install

- Build `herdr-standin` and copy `herdr-shell` into
  `$XDG_DATA_HOME/herdr-tincho-config/bin/` (not on `PATH`).
- `install.sh` changes only the `shell` key in
  `~/.config/herdr-core/config.toml` and keeps the other keys. A different
  existing value is a conflict that gets reported. `--force` replaces it and
  writes `config.toml.orig`.
- Track the built binaries in the install manifest by source hash, not by
  output hash. AOT builds are reproducible, but the JIT fallback is not.

## Verified facts (2026-11-16)

| Fact | Evidence |
|---|---|
| `hc send` only pastes and presses Enter; no hooks anywhere | `hc schema` (36 methods), `events.subscribe` kinds, config keys from the binary's strings |
| A normal exit finishes the terminal, even with keep | `hc run --bg --keep sleep 2` became `finished` |
| A signal on a kept terminal keeps the address, labels, parent and children | `sp-parent` probe: new `fish`, same `t1j2`, child survived |
| Sends during the switch are refused | `unavailable: … is lost, waiting for its new shell` |
| `HC_TERMINAL_ID` is set in recovery shells; the label is readable | `lbl-probe`: `hc get` in about 15 ms |
| Background processes started with plain `&` die; ones started with `nohup` survive | `bg-probe` |
| Pi agents have MCP server children in their own process group | `npm exec shadcn@latest mcp` under each `pi` |
| Most local agents run inside fish | `t1`, `t11p`, `t11q`, `t1h9`: `argv[0]` is fish, the foreground is `pi` |
| Bun AOT: about 6.6 MB footprint, and `bun:ffi` `execvp` works | Bun 1.4.5 canary, measured with `footprint` |
| Both CLIs accept a first prompt when resuming | `claude [options] [prompt]`, `pi [options] [messages...]` |

## Open facts: check before building

- **F1**: Do kept terminals keep their address and labels after
  `hc server stop` and the next core start? Test on a disposable core
  (`HC_TERMINAL_SOCKET` / a separate state folder) so live agents are not
  touched.
- **F2**: What does `foreground.argv` show for Claude (Pi hides its own as
  `["pi","","",""]`)? Does `claude --resume <id> -- "<msg>"` submit the
  message interactively?
- **F3**: When fish is the main program and gets `SIGTERM`, is that a loss
  (keep recovery runs) or a normal exit (the terminal finishes)? If fish
  exits normally, use `SIGKILL` for shell main programs. Also check that the
  agent inside then exits cleanly (SIGHUP) with its session saved.
- **F4**: What error kind and text does `hc get` return while the core is
  starting? `herdr-shell`'s retry depends on it.
- **F5**: The exact OSC 7501 report syntax (the binary shows the query
  `ESC]7501;?` and the answer `]7501;?:states=…`). Confirm `idle`/`working`/
  `blocked` reports from a probe, and that `hc send --if idle`, `hc wait` and
  `hc send --wait` treat the stand-in as an idle agent.

## Tasks

Each task is done when its tests pass and its acceptance check holds.

1. **Check open facts F1–F5.** Record the results in this file, and change
   the design if any fact contradicts it.
2. **Shared recipes.** `recipes.js` returns `{cwd, argv}`; recovery still
   types the same lines as before (the existing `tests/resume.test.mjs` and
   `tests/recovery-lifecycle.test.mjs` pass), plus new tests for argv.
3. **Claude launch options.** An allow-list parser like `args.js`, the
   `herdr.claude-options` label written alongside `herdr.claude-session`,
   and use in the recipe. Unit tests cover secrets and prompts being dropped.
4. **Stand-in.** `suspend/standin.ts`: input parsing (bracketed paste, typed
   lines, empty Enter), 500 ms batching, status reports, wake through
   `execvp`, the missing-session path. Tests with `bun test` for the logic.
   AOT build and a footprint check of 10 MB or less.
5. **`herdr-shell`.** The label check, the retry while the core starts, the
   `$SHELL` handoff. Shell tests with a fake `hc` on `PATH`.
6. **Policy (mod).** The eligibility rules, the idle clock, the helper
   allow-list, leader choice, the ordered suspension steps with aborts, wake
   on 1 s focus. Unit tests with a mocked host, like the existing mod tests.
7. **`tab-tree` and `tab-menu`.** 💤 and "waking…" display; recovery refuses
   stand-ins; Suspend now and Never suspend.
8. **Installer.** Build, AOT/JIT/skip fallbacks, the `config.toml` `shell` key
   with conflict and `--force`, manifest entries. Extend
   `tests/install.test.sh` with disposable homes.
9. **Integration script** (run by hand only):
   `tests/suspend.integration.sh` creates throwaway hc terminals for an
   `hc run` agent and a fish-hosted fake agent. It suspends each, sends a
   message, and checks that the message arrives as the first prompt, that
   the address, labels and parent are unchanged, and that nothing ran in a
   shell.
10. **Docs.** A README section (settings, behavior, limits), a CHANGELOG
    entry, and `herdr-app check` for each changed mod.

## Known limits (accepted)

- Automatic suspension only happens while the Herdr app is open.
- A message pasted milliseconds before `SIGTERM` can be lost.
- Unsent text typed into an agent and left for 30 minutes or more is lost.
- Every new terminal pays about 15 ms for `herdr-shell`'s label check.
- Bun AOT is experimental and canary-only today; the JIT fallback covers
  stable Bun.
- Upstream request worth filing: an hc hook that runs a command on a send to
  a labeled terminal would make the stand-in unnecessary (ADR 0001).
