# Idle-work audit: Tincho layout and mods

Scope: repository mods/layout, referenced shipped mods in the installed Herdr 0.1.13 home, the installer watch mode, and Pi recovery extension. Source inspection only: no controlled CPU, wakeup, or battery measurement. Work frequencies below follow timers and call paths, not a measured power budget. No unrelated optimizations were implemented.

## Implementation follow-up

The findings below describe the pre-fix baseline; their line references are
historical. The requested changes now implement:

- **Claude-only session polling:** current app/program/command-position metadata
  selects local live Claude processes before any probe. Pi/Codex/shells and
  remote/exited terminals trigger no session-probe commands. Each successful
  Claude probe now uses two core identity reads around one session-file read;
  same-PID session changes remain detectable, while unchanged IDs skip writes.
  The final check-to-label race remains because the host has no atomic API.
- **Personal Files/Changes copies:** `tincho.json` references `tincho-files` and
  `tincho-changes`; shipped originals remain untouched. Hidden callbacks start
  no background I/O or redraw follow-ups. Visible local watches use a 60-second
  safety refresh; remote, failed-watch, or full-wait-budget paths use 10 seconds.
  Unchanged refreshes suppress redraws; ordinary render calls do not serialize
  large trees/diffs. Explicit user commits finish even if the panel is hidden.
- **Bounded lifecycle costs:** an in-flight process/read can finish, one fallback
  may wake after hide, and native watch promises cannot be cancelled. Waits are
  reused per root and capped at four per copy; overflow uses fallback polling.
  Reveal refreshes after observed suspension. An unobserved brief hide/reveal
  retains the existing freshness bound, not an unconditional immediate refresh.
- **One-shot installs:** development instructions use `./install.sh`. No
  `fswatch` dependency or new watcher was added; optional `--watch` is unchanged.

Verification uses actual-module host-mocked regression tests, including async
hide/focus races, remote fallback, unchanged redraws, commit completion, and
repeated quiet hide/reveal. Native loading checks caught and corrected sibling
imports outside Herdr's per-mod application root. See
`herdr/mods/tincho-panel/CONTRACT.md` for the exact lifecycle guarantees.
These are verified work-path reductions, **not measured battery savings**.

## Follow-up: built-in filesystem watching

Verified the installed `herdr.d.ts:404–414`, shipped Files/Changes source,
our personal `work.js` helpers, and the app source checkout (including the
v0.1.13 `src/files.rs` implementation):

- Herdr embeds QuickJS through its Rust GPUI shell, not Node or Bun. The
  inspected shell exposes a limited `fs/promises` compatibility module without
  `watch`; a Node-compatible import name does not imply the full Node API.
- The supported mod primitive is `import { watchFolder } from "herdr"`.
  `src/mods.rs` routes it to `files::next_change`, backed by Rust `notify`'s
  recommended native OS watcher. This is event-driven, not repeated file reads.
- **The shipped panels already used this watcher AND a 10-second refresh timer.**
  Our copies reuse the native primitive; the improvement was suppressing hidden
  refreshes and reducing the redundant visible safety polling, not inventing
  file watching. No Node/Bun helper process is needed.
- Watch notifications invalidate a view; they do not supply file contents or
  Git status. Reads/Git queries remain necessary when a relevant event occurs.
  Remote watches have no `on` option. Linux ignores some directories and can
  reject oversized trees. Git metadata outside a watched working directory
  can also require separate coverage, so removing every safety refresh needs
  more correctness work than swapping APIs.
- The inspected native watcher batches events with a 150ms receive timeout in
  its worker loop, even when idle. That is a native-thread wakeup, not a disk
  rescan; eliminating it or adding explicit unsubscription would require a
  Herdr change rather than a personal-mod change. No power impact was measured.

Node's official documentation confirms the distinction: `fs.watch` uses OS
notifications; `fs.watchFile` uses stat polling. Source:
https://nodejs.org/api/fs.html#fswatchfilename-options-listener

## Prioritized findings

### 1. Claude recovery probes also run for non-Claude agents

- Evidence: `herdr/mods/tab-tree/main.js:91-93,207-217`; `herdr/mods/tab-tree/resume.js:97-102`.
- Every 10 seconds the sidebar scans all local live agent/reporting terminals, including idle Pi and Codex terminals. Each eligible terminal gets `hc get`; when it has a foreground PID, a shell reads the corresponding Claude session file. That is up to six probes and six shell invocations per minute per terminal, although the result cannot help non-Claude agents.
- Recommendation: identify Claude more narrowly before probing. Preserve Claude `/clear` and `/resume` detection, including cases where program metadata is incomplete. Pi already writes recovery metadata on events.
- Effort: small. Risk: medium because false-negative Claude detection harms recovery. Confidence: high for unnecessary probes; battery impact unmeasured.

### 2. Files and Changes continue refreshing after their panel is hidden

- Evidence: `herdr/layouts/tincho.json:77-88`; installed `mods/files/main.js:42-46,72-105`; installed `mods/changes/main.js:32-44,60-109`; installed `AGENTS.md:795-800`.
- Important qualification: a mod starts on its **first showing**, not just because it exists under a hidden layout node. Once shown, its timers continue when hidden. Opening both panel tabs once can therefore leave both refresh loops running.
- Files refreshes every 10 seconds: one directory-listing shell per root/expanded directory and two Git commands in a Git repository. Changes refreshes every 10 seconds: four Git commands for an existing HEAD (five for an unborn HEAD), plus an open file's diff/preview. Both call `notify()` after unchanged successful refreshes. Together a simple initialized Git-folder case costs seven direct commands per ten seconds before extra directories/diffs. Watcher events can trigger additional passes.
- Recommendation: suspend when hidden, refresh on reveal, and prefer local filesystem watches with a slower fallback. Preserve polling for remote folders and unavailable watches. Compare visible data before requesting redraws. Clone shipped mods rather than patching their installed files.
- Effort: medium. Risk: medium (freshness, remote behavior, and watch failure). Confidence: high for source behavior; battery impact unmeasured.

### 3. Installer watch mode repeatedly hashes the entire source tree

- Evidence: `install.sh:33-50,122-141`.
- `./install.sh --watch` sleeps one second, then rediscovers and hashes every source file, even without changes. It creates multiple command processes per file. This is opt-in development work, not a normal layout cost. It does not reinstall or rewrite destination files when the snapshot is unchanged.
- Recommendation: do not leave watch mode running outside active config editing. A later improvement could use filesystem events and debouncing, preserving content hashing to catch same-size edits and renames; retain a portable slower polling fallback.
- Effort: medium. Risk: medium (installer correctness). Confidence: high. This is a documented tradeoff, not a correctness bug.

## GitHub PR checks: addressed by the requested setting

Before the toggle, `tincho-status/main.js` installed a 15-second redraw timer and refreshed focused-branch data after roughly 60 seconds: normally two `gh` commands per successful PR lookup, or up to three for the no-PR branch-check fallback. GitHub checks are now explicitly opt-in via a global status-bar setting, default off. Disabled mode stops its refresh timer and new requests, not merely the output. An already-started `gh` command can finish; subsequent requests and stale results must be suppressed. See the PR-setting tests and README for implemented lifecycle behavior.

## Considered and not ranked as idle-drain problems

- The sidebar's 3-second agent-label loop scans snapshots but skips subprocesses once labels match (`tab-tree/main.js:190-202`). Lower priority than the 10-second session probes.
- Git repo discovery is cached per machine/folder, including failures (`tab-tree/main.js:166-185`). Split-tree retrieval is driven by changed pane signatures, not periodic subprocess polling (`main.js:106-140`).
- Sidebar outline and space-color shared writes are guarded against unchanged values (`main.js:271-287,534`). Folding writes only on interaction.
- Working-agent spinners animate natively and stop when not shown. They are active-work rendering, not an idle-agent polling loop. Avoid replacing them with JavaScript animation timers.
- Background-job lists use live Herdr snapshots with no refresh timer or subprocesses. A large terminal tree could make repeated selectors more expensive, but no profiling establishes it as a priority.
- Pi recovery is event-driven and skips unchanged metadata (`pi/extensions/herdr-recovery/index.js:14-40`). No background timer.
- Picker/menu actions and bounded recovery retries run on opening or explicit recovery, not continuously at idle.

Not audited: native Herdr/core internals, agent/model CPU use, renderer wakeups, actual battery consumption, or the user's system-wide background processes. The current source findings support targeted follow-up work, not a claim that any one item explains observed machine-wide drain.
