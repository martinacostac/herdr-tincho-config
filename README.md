# herdr-tincho-config

My Herdr app setup: layouts, mods, themes and an optional Pi recovery extension,
kept here and installed on any machine with one script. Nothing in it is tied to one machine: paths come
from `$HOME` and the XDG variables.

## Set up a machine

Needs the Herdr app (`herdr-app`, `hc`), `git` and a POSIX shell.

```sh
git clone <this repo> && cd herdr-tincho-config
./install.sh
herdr-app do layout.switch --name tincho
```

## How it's laid out

```
herdr/            mirrors the Herdr app home (~/.config/herdr-app)
  layouts/          tincho.json
  mods/             tab-tree/, tab-menu/, tag-prompt/, tab-picker/, tincho-status/
                    tincho-files/, tincho-changes/ (personal panel copies)
  themes/           catppuccin-latte.json, catppuccin-frappe.json
pi/              mirrors Pi's agent directory (~/.pi/agent)
  extensions/       herdr-recovery/ (session metadata for the ↻ button)
tests/           recovery and isolated installer tests
install.sh       copies herdr/ and pi/ into their respective homes
```

`install.sh` puts every file under `herdr/` at the same path in the Herdr app
home: `$HERDR_APP_HOME`, else `$XDG_CONFIG_HOME/herdr-app`, else
`~/.config/herdr-app`. A new mod, layout or theme only needs its file in the
right folder here.

**Pi installation is conditional.** The installer copies `pi/` only when
`~/.pi` is already a directory, or you explicitly set `PI_CODING_AGENT_DIR` to
a nonempty path. The destination is `$PI_CODING_AGENT_DIR`, otherwise
`~/.pi/agent`. Without either condition, it prints `pi: skipped` and does not
create a Pi directory or change its installation manifest. `--force` does not
opt in. An explicit custom directory opts in even if it does not exist yet:

```sh
PI_CODING_AGENT_DIR="$HOME/custom-pi-agent" ./install.sh
```

The recovery extension has no npm dependencies. When it is installed, run
`/reload` in existing Pi sessions to load it; new Pi sessions discover it
automatically. If you set up Pi later, rerun `./install.sh`.

- Copies, not symlinks: Herdr doesn't reload a mod through a symlink. Each
  file is written whole and renamed into place, since Herdr reads a file the
  moment it changes and keeps the old one if it catches it half-written.
- It records what it installed (`$XDG_STATE_HOME/herdr-tincho-config/installed`,
  default `~/.local/state/...`; Pi uses a separate `installed-pi` manifest).
  A file changed on that machine since the last
  install is skipped and reported, with the `diff` to compare. `--force`
  overwrites it and keeps the old one as `<file>.orig`.
- A file removed from the repo is reported on every run, never deleted.
- The files Herdr writes into mod folders (`gpui-kit.d.ts`, `jsconfig.json`)
  are ignored by git and never installed.

## Working on it

```sh
./install.sh                                      # install after edits, before testing
herdr-app check ~/.config/herdr-app/mods/<name>   # after each mod change
herdr-app status                                  # file and mod errors
herdr-app shot /tmp/herdr.png                     # what the window shows
node --test tests/*.test.mjs                      # Node 22.19+; no live sessions
sh tests/install.test.sh                         # disposable homes; includes --watch
```

Use one-shot installs while developing; no watcher needs to run between edits.
The optional `./install.sh --watch` mode remains available, but repeatedly
hashes enabled source trees while idle, so avoid leaving it running unnecessarily.
It notices when `~/.pi` appears or disappears; while Pi is skipped, it does not
hash the Pi source tree or recreate a removed Pi directory.

Edit here, never in `~/.config/herdr-app` (the next install reports that as
a conflict). Shipped Herdr mods and layouts are replaced on every Herdr start:
clone them (`herdr-app do mod.clone --name <mod> --as <new>`) and move the
clone here.

Reference: `herdr-app --skill`, `~/.config/herdr-app/AGENTS.md`, and the
generated `herdr.d.ts` / `gpui-kit.d.ts` next to it.

## Settings

Herdr's `settings.json` isn't in this repo: Herdr writes it itself (zoom keys,
for example), so the installer would keep reporting it as changed. Set these
by hand in `~/.config/herdr-app/settings.json` on each machine:

```json
{ "telemetry": false, "font": "GeistMono Nerd Font Mono", "minimum_contrast": 2 }
```

`minimum_contrast: 2` makes Herdr swap terminal text below 2:1 against its
background for near-white or near-black. Without it, programs that draw
ANSI 0 on Base or light text on a blue selection (Fresh's "system" theme)
are hard to read.

## Keys

`keys.json` isn't in this repo either (it holds every key, Herdr's defaults
included). Add this section by hand to `~/.config/herdr-app/keys.json`, so
⌘P opens `tab-picker` instead of the shipped picker in this layout:

```json
"layout:tincho": { "cmd-p": "mod.open:tab-picker" }
```

And this line to its `"terminal"` section, so ⌘F opens Herdr's find bar
(screen and scrollback, since 0.1.13). A `keys.json` written by an older Herdr
doesn't get it:

```json
"cmd-f": "terminal.search",
```

## Layout: `tincho`

The shipped `main` layout without the spaces list, agents list and top tab
bar. The left sidebar is a single `tab-tree` list between the brand bar and
the settings footer. Pane headers and the Files/Changes UI stay as in
`main`; the panels use the personal copies below. The status bar is
`tincho-status`.

### Files and Changes

Use **Files** and **Changes** on the right side of the status bar, just before
**Commands**, to open the side panel. The visible panel's button is highlighted;
click it again to hide the panel, or click the other button to switch views.
No extra keyboard shortcuts are installed.

#### Idle work

`tincho-files` and `tincho-changes` preserve the shipped UI and Git actions
without changing the shipped originals. Hidden ancestors and inactive stack
tabs stop background reads and refresh follow-ups. In-flight results are
ignored after an observed hide or location change; explicit user commits can
finish while hidden.

Visible local panels refresh on filesystem events, with a 60-second safety
refresh. Remote locations, failed watches, and exhausted watch slots retain a
10-second fallback. Unchanged refreshes do not request redraws, and unrelated
renders do not serialize the entire tree or diff.

Herdr has no hide/show callback or cancellable `watchFolder` API. One pending
fallback may wake after hiding, then stops; outstanding native waits remain
until an event. Same-root waits are reused, with at most four pending waits per
panel copy. Reveal refreshes after an observed suspension. A very brief
hide/reveal without any intervening callback retains the existing freshness
bound rather than guaranteeing an immediate refresh.

See `herdr/mods/tincho-panel/CONTRACT.md` for the lifecycle contract and each
panel's `PROVENANCE.md` for its source. The small `work.js` helper is copied
identically into both mods because Herdr forbids sibling-directory imports;
a test enforces equality.

## Themes

Catppuccin, following its style guide
(https://github.com/catppuccin/catppuccin/blob/main/docs/style-guide.md):

- `catppuccin-latte` (light) and `catppuccin-frappe` (dark). `tincho` uses
  `{ "light": "catppuccin-latte", "dark": "catppuccin-frappe" }`, so it
  follows the macOS appearance. The theme picker overrides it.
- Terminal colors: the guide's ANSI mapping (black/white from Surface/Subtext,
  brights generated with its formula), cursor Rosewater, selection Overlay 2
  at 25% over Base. One deviation: Frappé's bright black (ANSI 8) is Overlay 2
  instead of Surface 2, because programs use it for comments and hints and
  Surface 2 is too dim on Base.
- Interface: Base for panes, Mantle for the sidebar, Crust behind the cards,
  Surface 0/1 for hover and selection, Overlay 0 borders, Lavender for the
  focused pane (accent), Subtext 0 labels, Overlay 1 subtle text. Agent
  status: working Blue, needs you Yellow, done Green, idle Overlay 1.

## Mod: `tab-tree`

Every tab, grouped by its Herdr space (one group per space, in the spaces'
order).

- Group header: avatar (same colors as the shipped spaces list), space name,
  machine and the branch of its main-checkout tab when it isn't main/master.
  Hover for `+` (new tab, in the repo's main checkout when its tabs are in
  one), chevron folds it, click shows the space, right-click opens its menu.
- Drag and drop (a drag starts after the pointer moves 4px, so a click still
  clicks; a ghost of the row follows the pointer and a line shows the drop
  slot: the upper half of a row drops above it, the lower half below;
  leaving the sidebar cancels):
  - a space's header onto another space: reorders the spaces (`space.move`),
    so `ctrl-1..9` and space next/prev follow the sidebar.
  - a tab within its space: reorders it (`tab.move`).
  - a tab into another space on the same machine: moves it there, programs
    still running. Herdr has no command for it, so the mod parks each of the
    tab's terminals (`terminal.park`: the pane goes, the process stays), then
    points their `herdr.space` / `herdr.tab` labels at the target
    (`hc label`), and Herdr adopts them there as one new tab. Dropped on a
    space's header, the tab goes first.
- Worktree tabs carry `- <worktree>` after their name. A split pane shows
  its own worktree only when it differs from its tab's.
- Tab row: its primary pane (the first pane of its split tree). Shows the
  tab name when someone named it, else what runs there:
  - agent: program icon, its session name (the title it sets, e.g. Claude
    Code's `/rename`; the program's name when it has none), status (spinner /
    Needs you / done dot / idle ring)
  - shell at its prompt: muted, the folder name (or the shell, when the
    folder is the workspace itself)
  - program (nvim, lazygit, ...): its icon and name, then its title or folder
- Split panes list under their tab at one level, indented past the tab's
  icon, in the order of the split tree (depth first), however deep a split or
  sub-agent is. The tree comes from
  herdr-core's `herdr-app` document (`doc.get` over `hc connect`), re-read
  whenever the panes change. Pane rows focus that pane on click.

Grey detail text never repeats the workspace or the row's own name.

The mod shares its outline (groups, tab names, icons, status) as
`tab-tree.outline` for `tab-picker`.

### Resuming agents (`herdr/mods/tab-tree/resume.js`)

herdr-core keeps nothing of a program it lost (`hc server stop`, a restart, a
crash): the terminal comes back as a fresh shell. So the mod records it
itself: every few seconds it labels each local terminal running an agent with
`herdr.last-agent=<program key>` (`claude`, `pi`, `codex`, ...). The core keeps
labels across restarts.

Hover a tab back at a shell prompt for ↻. It types the resume command for the
agent that terminal last ran, from `RECIPES` in `recipes.js`:

- `claude`: `claude --resume <session id>`, the exact conversation that
  terminal last ran. Every 10 seconds the mod reads each running Claude's id
  from `~/.claude/sessions/<pid>.json` and labels its terminal
  `herdr.claude-session=<id>`, so several agents in one folder each get their
  own back. Without an id yet: `claude --resume '<tab name>'` in a named tab,
  else `claude --resume` (the picker). Never `--continue`: it takes the
  folder's latest conversation, often another tab's. Only positively identified
  local, live Claude processes are probed; Pi, Codex, shells, remote and exited
  terminals cause no session-probe commands. Current app/program metadata or
  conservative command-position argv identifies Claude, never recovery labels.
  Identity checks reject process changes during probes, and unchanged sessions
  skip label writes. Claude stays polled so same-process `/clear` and `/resume`
  changes are detected. Herdr has no atomic PID-conditional label operation,
  so the final check-to-write race cannot be eliminated completely.
- `pi`: `pi --session '<absolute session file>'` plus supported launch options.
  The extension below records the exact conversation; an ID-only record uses
  `pi --session '<id>'` from the recorded working directory. Missing/invalid
  metadata or a missing, empty or mismatched session file opens `pi --resume`
  (the picker), never `--continue`. With valid metadata, that fallback keeps the
  recorded directory and launch options. Pi is sent once, after checking
  the terminal is still at its shell; it does not use Claude's report timeout
  and `/exit` retries, which could interrupt the picker.
- `codex`: still commented out until its flags are checked. Recipes live in
  `herdr/mods/tab-tree/recipes.js`.

Recovery requests run serially within each sidebar copy. The queue belongs to
the view instance—not module scope, which Herdr 0.1.14 shares across copies.
Closing the sidebar invalidates its queued work and follow-ups; a replacement
sidebar can recover independently even if an old native promise never settles.
Already-issued commands cannot be recalled. Separate sidebar copies have
independent queues. Hiding the sidebar does not close it or cancel recovery.

No label, or no recipe for it: no button. A tab whose agent ran before this
mod labelled it gets one after that agent runs there once. Remote machines get
no button.

### Pi recovery metadata (`pi/extensions/herdr-recovery/`)

The extension identifies its terminal through `HC_TERMINAL_ID`. On
`session_start` (startup, `/reload`, `/new`, `/resume`, and `/fork`), it saves
`herdr.last-agent=pi` and one JSON label, `herdr.pi-recovery`, with `hc label`:

```json
{
  "version": 1,
  "sessionId": "01a1b208-example",
  "sessionFile": "/home/me/.pi/agent/sessions/.../session.jsonl",
  "cwd": "/home/me/project",
  "args": ["--thinking", "high", "--tools", "read,bash"]
}
```

Herdr keeps this metadata across restarts, separately for each terminal. The
conversation stays in Pi's own session file; the extension does not copy it.
Before opening a saved file, the button reads at most 4096 bytes and checks
that its first JSON line is a session header with the recorded ID. This avoids
Pi silently creating a new conversation for an empty or missing file.
It leaves the label on exit, clears it for ephemeral (`--no-session`) sessions,
and retries failed writes at the next agent turn without polling. Print, JSON,
and RPC runs do not change labels, so a nested Pi command cannot replace its
interactive parent's metadata in those modes.

Launch options come from Pi's `process.argv`, not Herdr's process inspection:
Pi changes its process title, which can hide its arguments from the OS.

- Preserved value options: `--provider`, `--model`, `--models`, `--thinking`,
  `--tools`, `--exclude-tools`, `--use-theme`, and `--tui-mode`.
- Preserved paths: `--extension`, `--skill`, `--prompt-template`, `--theme`,
  and `--session-dir`. Relative paths become absolute against the launch
  directory; `builtin:` extension identifiers stay unchanged.
- Preserved switches: `--no-tools`, `--no-builtin-tools`, `--no-extensions`,
  `--no-mcp`, `--no-skills`, `--no-prompt-templates`, `--no-themes`,
  `--no-context-files`, `--no-approve`, `--no-sandbox`, `--offline`, and `--verbose`.
  Supported short aliases are normalized to their long forms.
- Not replayed: initial prompts, `@file` inputs, old session selectors, and the
  launch-time session name. `--api-key`, inline system prompts and trust
  approvals are not saved. Unknown flags (including extension-specific flags)
  stop option capture: their values cannot safely be distinguished from later
  options. These omissions are silent; values are not logged. A warning is
  shown only if saving the recovery metadata fails.

These are **launch options**, not a snapshot of all runtime settings. For
example, a saved `--model` or `--thinking` overrides changes made later inside
Pi. Shell wrappers, environment variables, credentials and Node runtime flags
are not captured. Arguments are stored as an array and shell-quoted on replay
for sh/bash/zsh/fish; control characters in recovery metadata are rejected.

The tracking extension must be loaded. With `--no-extensions`, explicitly add
`-e ~/.pi/agent/extensions/herdr-recovery/index.js` (adjust for a custom agent
directory). Disabling it means metadata cannot follow that run; old terminal
metadata may remain. A conversation that never reached disk, was deleted, or
ran with `--no-session` cannot be restored; the button opens the picker instead.
This extension targets Pi's current `session_start` lifecycle (verified with
Pi 1.5.0).

## Mod: `tab-picker`

⌘P (see Keys). Herdr's shipped picker, cloned, showing the tabs as the
sidebar does: grouped by space, and named as the sidebar names them, with the program's icon instead of its name
("Claude Code"). It reads `tab-tree.outline`; in a layout without `tab-tree`
it falls back to one group per space. "new tab" and "new space" stay pinned
under the list, ↑/↓ reach them too.

## Mod: `tincho-status`

The status bar. The shipped `workspace-status` (machine, branch, agents,
palette hint), with the branch of the focused pane instead of the space's,
plus an always-visible **PR off / PR on** toggle. PR lookup is **disabled by
default**. Click the toggle to enable or disable GitHub PR, CI and review-bot
data globally across live status-bar copies. The choice persists through
Herdr's shared state (`tincho-status.pr-enabled`); only boolean `true` enables
it, so an absent or malformed value stays off. The focused pane's branch
remains visible while PR lookup is off.

With PR lookup enabled:

```text
⎇ TBD-1890   PR on   ⇄ #6131   CI ✓   CodeRabbit ✓   Cursor ● 2   Copilot ✓   Sonar ✓   Review ● changes · 3 open
```

- `#6131` opens the PR in the browser. Every item has a tooltip with details
  (who approved, how many threads are open).
- CI: every check but CodeRabbit's and Sonar's, the newest run of each
  (skipped ones left out): a spinner and passed/total while any runs, an
  orange dot and "n failed" (the tooltip names them) when one failed, ✓ when
  all passed. A pushed branch with no PR still shows `no PR  CI …`, from
  the checks on its newest commit on GitHub (`gh api .../commits/<branch>/check-runs`
  and `/status`).
- CodeRabbit, Cursor, Copilot: a spinner while CodeRabbit's check runs, an
  orange dot with the number of unresolved threads it opened, a check when it
  reviewed and none are open, a grey dot when it hasn't reviewed.
- Sonar: SonarQube Cloud's check (only in repos that run it).
- Review: people only (bots left out): changes requested, approved,
  commented or none, plus their unresolved threads.

When enabled, GitHub is reached only through `gh`, in the focused pane's
folder and on its space's machine: `gh pr view <branch>`, then one
`gh api graphql` for review threads. If `gh pr view` reports no PR, the mod
tries the branch's check runs, then commit statuses when check runs are
available. With no PR or checks, the data section stays hidden. Bots are
recognized by login, the same list as resolve-ticket's `watch-lib.js`.

Enabling starts a fresh focused-branch lookup immediately. Each live
status-bar copy owns at most one 60-second refresh timer while enabled;
focus changes also look up uncached or stale branches. A lookup already in
progress for a branch is not duplicated. Hidden copies remain alive under
Herdr's lifecycle rules and can still refresh while enabled.

Disabling hides PR/CI/bot data, cancels the refresh timer and owned lookup
tasks, clears cached results, and invalidates in-flight work. No new `gh`
requests start while disabled; a pending result cannot trigger follow-up
GraphQL/check/status requests or overwrite a newer off/on cycle. An `exec`
that has already started **cannot be killed by this toggle** and may finish.
Closing cancels the copy's owned tasks; Herdr also stops owned tasks on mod
reload. The background-jobs popup never starts PR lookups or a PR timer.

### Background jobs

Beside the agent count, `2 background jobs` counts live terminals launched
under the **focused terminal**, including nested descendants. It includes
agents, builds, tests, and servers, but excludes terminals that already have
panes and terminals whose processes have exited. A live agent reporting `done`
still counts; it can accept another task. The item is hidden when there are no
matching jobs, and uses the attention color if any job is blocked or in error.

Click the count for a compact, jobs-only list with names, terminal addresses,
and statuses—no header or footer. It fits up to seven rows before scrolling.
Jobs that need attention come first. Click a row (or use ↑/↓ and Enter) to
**peek** at its terminal without creating a permanent pane; Esc or clicking
outside closes the job list. The terminal preview keeps Herdr's standard
header with Keep and Close controls. It adds an 8px inset so the header and
terminal backgrounds stay inside the rounded frame. Escape inside the preview
goes to the terminal, as it does in Herdr's built-in preview. The popup keeps the parent it was opened for even
while it takes keyboard focus, and its contents update as jobs start, finish,
or move into panes. Plain commands show `Running`, not an invented agent
status. Launch arguments are not displayed. Keyboard navigation scrolls the
selected row into view, including when wrapping through long lists.

No keyboard shortcut is installed. A built-in command-palette entry is blocked
by Herdr's missing mod-command discovery support; see
[`docs/research/herdr-command-palette.md`](docs/research/herdr-command-palette.md).
The corner workaround applies only to this job list and its preview, not
Herdr's Settings or previews opened elsewhere.

The count and popup read Herdr's live `terminals()` and `panes()` snapshots;
there are no extra subprocesses or polling timers. Ancestry uses full terminal
addresses so local and remote terminal IDs do not collide.

## Tags

One short tag per terminal, to tell agents apart at a glance: it shows as a
chip after the row's name in the `tab-tree` sidebar (tab rows and pane rows).
It's the terminal's `tag` label in herdr-core, so it survives restarts.

- Right-click a tab or pane row > Set tag… (Change tag… once it has one)
  opens `tag-prompt`: Enter saves, an empty box removes the tag, Esc cancels.
  The sidebar's right-click menu is `tab-menu`, a copy of Herdr's `menu` mod
  (v0.1.13) with that item added: Herdr's menu has fixed items. Herdr's
  command palette lists only the app's own commands, so it can't offer it.
- From a shell or an agent: `hc label t4r tag=review-me`, `hc label t4r tag=`
  to remove it, `hc ls --label tag=review-me` to find it.
