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

## Open facts: answers (2026-11-16)

All five facts were checked on a disposable core, hc 0.1.21, Claude Code
2.1.325, Pi 1.5.2. The setup:

- Session `HC_SESSION=f1`, with `XDG_STATE_HOME`, `XDG_CONFIG_HOME` and
  `XDG_RUNTIME_DIR` under `/tmp/hcf`, and `HC_TERMINAL_SOCKET`,
  `HC_TERMINAL_ID` and `HC_SOCKET` unset.
- Core id `8c957a13…`, socket `/tmp/hcf/run/herdr-core/f1.sock`. The real
  core is `1897801a…`.
- The core was started from a throwaway `--rm` terminal (`hcf-*`) on the real
  core, because a core started inside the agent's sandbox cannot spawn
  programs (`spawn_failed: Operation not permitted`). That terminal was the
  only use of the real core.
- F3 and F5 also ran on the disposable core, not on the real one.
- Afterwards all disposable terminals were removed and the disposable core
  was stopped. The real core kept the same pid (60961) and its uptime, and no
  `hcf-*` terminal was left.
- The throwaway Claude and Pi sessions are under `~/.claude/projects/-private-tmp-hcf-wd/`
  and `~/.pi/agent/sessions/--private-tmp-hcf-wd--/`. They were left in place.

| Fact | Answer | Evidence |
|---|---|---|
| **F1** server stop/start | **Yes.** Kept terminals keep their address and labels. On the next core start, the configured `shell` starts as the new main program, also in terminals that were already in recovery. | `hc run --bg --keep sleep` as `t3` (with labels `herdr.suspended={…}` and `x.y=1`) and as `t4` (SIGKILLed first, so it was already in its recovery shell). Then `hc server stop` and `hc server start`: `t3` and `t4` were `live`, with the same names and labels, `keep: true`, and new pids running `fish -l`. A second run used `shell = ["/tmp/hcf/probe-shell"]`, and every terminal started the probe shell after the restart. |
| **F2** Claude argv | **The full argv is visible**, with the prompt in it. `foreground.argv` was `["claude","--model","haiku","--permission-mode","default","--add-dir","/tmp","<prompt>"]` from fish. `foreground.name` is the version (`"2.1.325"`), not `claude`. Pi shows `["pi","",""]`, which hides its words. | `hc get f2 --json` while Claude ran in a fish terminal. Wake shapes seen: `["claude","--model","haiku","--resume","<id>","--","<msg>"]` and `[…,"--","first…\n\nsecond…"]`. |
| **F2** resume + `--` + message | **Yes.** `claude --resume <id> -- "<msg>"` resumes the session (the old turns are shown) and submits the message interactively as the first prompt. This also works when the message starts with `-`, and when it has several lines in one argument (one prompt). | The screen showed the old `❯ …pong4`, then `❯ …pong5` and a request in progress, with status `working`. The same happened for `-Reply…pong8`, and for a two-paragraph argument started through `exec claude … -- "$(printf 'a\n\nb')"`. Pi gave the same result: `pi --session <file> -- "-Reply…pong7"` resumed and answered `pong7`. |
| **F2** variadic options | **Claude has variadic options that swallow later words.** `--add-dir <directories...>` took a trailing prompt as a second folder: `claude … --add-dir /tmp "<prompt>"` submitted nothing, and no session file was written. With `--add-dir /tmp -- "<prompt>"`, the prompt was submitted. The variadic options in `claude --help` are `--add-dir`, `--allowedTools`/`--allowed-tools`, `--disallowedTools`/`--disallowed-tools`, `--tools`, `--betas`, `--mcp-config` and `--file`. Options with an optional value are `-r/--resume [value]`, `-d/--debug [filter]`, `-w/--worktree [name]`, `--remote-control [name]`, `--teleport [session]`, `--from-pr [value]`, `--cloud […]` and `--prompt-suggestions [value]`. | Two fresh starts with `--add-dir /tmp "<prompt>"`: the input box was empty and `~/.claude/sessions/<pid>.json` named a session that had no `.jsonl`. The same command with `--` submitted the prompt. |
| **F2** model not kept by resume | **`--resume` alone does not restore the model.** Without `--model`, the resumed session started with the settings default (`qwen3.5-4b-4bit`) instead of `haiku`. This confirms that Claude needs launch options. | The Claude banner after `claude --resume <id> -- …` |
| **F3** SIGTERM to a fish main program | **Loss.** hc starts the configured shell in the same terminal (same address, same labels, new pid). `SIGKILL` is not needed. `SIGHUP` and `SIGKILL` also give a loss. `SIGINT` is ignored, and fish keeps running. | Kept fish terminals `t7`–`t10` with label `probe=1`. TERM: pid 4345 became 4921. HUP: 5166 became 5208. KILL: 5280 became 5343. INT: still 5225. All stayed `live`, `keep: true`, with their labels. |
| **F3** agent inside fish | **The agent exits cleanly with its session saved.** Claude (idle, in fish) exited about 600 ms after SIGTERM to fish. It wrote a final `cost-state` line, every line stayed valid JSON, it removed `~/.claude/sessions/<pid>.json`, and `--resume <id>` showed the old turns. Pi (`done`, in fish) exited within 250 ms. Its session file stayed complete (all lines valid JSON, with the `pong6` answer), and the `herdr.pi-recovery` label was kept. | `kill -TERM <fish pid>`, then `ps -p <agent pid>`, and the session files read afterwards. |
| **F4** `hc get` while the core starts | **`hc get` never failed while the core was starting.** It waits for a starting core, and it starts a stopped core itself. Racing 30 to 60 `hc get` calls against `hc server start`, `hc server stop` and the autostart gave no error. Recovery shells started by a core start got an answer on the first try, about 25 ms after they started. The only failure seen was during `hc server restart`: exit code **5**, `{"error":{"kind":"unavailable","message":"the core restarted while this ran (an update?)","hint":"run the command again; terminals kept running"}}`. `herdr-shell` must retry on exit 5 / `kind: unavailable`. Any other error (for example `not_found`, exit 3) is not retryable, and the launcher must not start a shell for it. | The race loops in `/tmp/hcf/f4*.sh`. `/tmp/hcf/probe-shell` (as the configured `shell`) logged `t3`–`t6 try 1 rc=0` 25 ms after it started. `hc` ignores `HC_TERMINAL_SOCKET` (a dead path still reached the core): it finds the core from `HC_SESSION`, `HC_SOCKET` and the XDG paths, which recovery shells inherit from the core. |
| **F5** report syntax | `ESC ] 7501 ; state=<idle\|working\|done\|blocked\|error>[:app=<[A-Za-z0-9_.+-]{1,32}>][:kind=<permission\|question\|auth>][:msg=<base64 UTF-8>] ESC \`. Use `kind` only with `blocked`. The query `ESC]7501;?ESC\` gets the answer `ESC]7501;?:states=idle,working,done,blocked,error:kinds=permission,question,auth`. | Pi's `pi-tui/dist/program-status.js` (`formatProgramStatus`). A Python probe that sends these reports showed `status: {app: "probe", state: …, msg: …}` in `hc get`. |
| **F5** coordination commands | **A program that reports `idle` counts as an idle agent.** `hc send --if idle` delivers (`started: true`). `hc wait` returns `reason: status, status: idle` when the probe goes back to idle, and `turn` goes up. `hc send --wait` returns after the turn, with `wait.status: idle`. This is the same when the probe is the main program of `hc run` and when it is a kept terminal's configured `shell`, started after a SIGKILL. While the probe is `blocked`, both `hc send` and `hc send --if idle` refuse with exit 9 (`kind: blocked`), and `hc wait` returns at once with `status: blocked`. A program that never reported is `silent`, and `hc send --if idle` refuses it with exit 10 (`status_mismatch`, "t1g is silent, not idle"). | `/tmp/hcf/f5.sh` on `f5a` (`hc run`) and on `f5b` (the probe as the `shell`). |
| **F5** extras for the stand-in | (1) When the program has bracketed paste on, `hc send` writes `ESC[200~<text>ESC[201~`, then `\r` about 200 ms later in a separate read. (2) A blocked child makes hc paste `<hc>t1k f5c is blocked (question). See: hc read t1k</hc>` into its parent. (3) After `execvp`, the last report stays: `working` stayed in place under `sleep` (same pid) until the new program reported. This supports "waking…". | The probe's input log, and a parent probe `t1j` with a child probe `t1k`. |

### Contradictions with the spec

None of the five facts contradicts an agreed decision:

- SIGTERM stays the signal for both kinds of main program. The F3 escape
  hatch (SIGKILL) is not needed.
- F1 confirms user story 46.
- F4 refines the launcher's retry: retry on exit 5 / `unavailable`.
- F5 confirms the stand-in's reports.

Three points need attention in later tickets. None of them changes a spec
decision:

1. **Ticket 03 (Claude launch options).** The argv contains the prompt, so
   the allow-list is required. For variadic options, Claude itself takes the
   words up to the next option as values, so `--add-dir /x "<prompt>"` means
   a folder named `<prompt>`. A parser that copies Claude's arity would store
   that text in the label. Safer choices: drop the variadic options, or keep
   their values only when the next word is an option or `--`. Options with an
   optional value (`--resume`, `--debug`, `--worktree` and the others listed
   above) must stop capture or be dropped. Because the wake command always
   puts `--` before the messages, recorded variadic options cannot swallow the
   messages.
2. **Ticket 05 (`herdr-shell`).** Retry only on exit code 5 (`kind:
   unavailable`). Never fall back to `$SHELL` on another error. A stopped core
   is never seen, because `hc get` starts the core itself.
3. **Not verified:** whether a first-run Claude dialog shown during a wake
   (folder trust, or the "fullscreen renderer" offer) drops the first prompt.
   Such a dialog would report `blocked`, and hc would tell the parent.
   Folders that already have a session are trusted already.

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
