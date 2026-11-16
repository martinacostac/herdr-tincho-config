# Final whole-branch review: agent-suspension

Fixed point: `main` (merge-base 6a70066). 44 commits (tickets 01–14). Read-only review.
Method: the code-review skill (two pi sub-agents, Standards and Spec, in fresh contexts; their reports were at
`/tmp/asr/standards-report.md` and `/tmp/asr/spec-report.md` and are merged below where they found the same
issues), plus my own cross-ticket pass over the contracts, the lifecycle and safety. Both reviewer terminals
(t1nj, t1nk) were killed and removed. No file in the repo changed.

Counts: **1 critical, 2 high, 5 medium, 11 low**, plus standards notes.

---

## CRITICAL

### C1. Suspending an agent that hc started directly (root=agent) ends the terminal when the agent is a real Pi
- `suspend-policy.js:604` sets `root = "agent"` when `pid === foreground.pid`, and `:167`/`:620` send `kill -TERM <pid>` to it.
- Real Pi catches SIGTERM and exits **with code 0**: `pi-coding-agent/dist/modes/interactive/interactive-mode.js:3711-3724`
  (`registerSignalHandlers` → `shutdown({ fromSignal: true })`) and `:3622-3635` (`process.exit(0)`).
- hc rules (`hc --skill`): "Signal death without an exit code is loss… **Ordinary exits and explicit kills remain final.**"
  So `hc keep` does not save the terminal. It finishes, its address is gone, and every later `hc send` fails. That is the
  problem the feature exists to solve (spec user story 27, README "the terminal stays live").
- `die_with_parent` children of that terminal also end ("Child terminals still end with their parent"), which breaks story 12.
- Observed in this review: the two pi reviewers I started with `hc run --bg pi …` had `pid == foreground.pid` (root=agent). After
  `hc kill`, hc recorded `"exit_code":0,"signal":null` for both. Pi turns the signal into a normal exit.
- Why the earlier checks missed it: F3 tested only a **fish** main program (`plans/agent-suspension.md:180-181`), then applied the
  result to "both kinds of main program" (`:191`). The integration script's root=agent agent is a fake `sh` script
  (`tests/suspend.integration.sh:142-160`), and the default action kills `sh`, which hc counts as a loss.
- Scope: every Pi subagent started with `hc run pi …`, which is the herdr subagent pattern. It also covers every agent after a root=agent
  wake (the woken agent is the main program again). Claude as root=agent was never verified either.
- Fix direction: for root=agent, use a signal that the agent cannot turn into an exit code (SIGKILL). Pi's session file is
  written on each append, but check that. Or verify per agent on a disposable core, and add a real-Pi root=agent case to the integration script.

---

## HIGH

### H1. A Claude session id without a transcript is treated as resumable. The wake then fails and **loses the messages**
- Policy: `suspend-policy.js:37` accepts any printable `herdr.claude-session`. Stand-in: `standin.ts:91` checks only that the id is printable.
- The id comes from `~/.claude/sessions/<pid>.json` (`resume.js` `claudeLaunch`). F2 found that this file can name a session
  that has **no `.jsonl`** (`plans/agent-suspension.md:178`), for example a fresh Claude that never got a prompt and sat idle past the threshold.
- The wake runs `claude --resume <id> -- <messages>` (`standin.ts:118-122`). Claude cannot find the conversation. The messages are gone, because they were
  passed as argv and are not in an undelivered file. root=agent: the terminal then ends (an ordinary exit). root=shell: a plain `$SHELL` starts.
- Spec story 38 requires the messages to be kept in a file and the agent reported as blocked. README:439-442 covers only "no session id".
- Fix direction: check `~/.claude/projects/<cwd-slug>/<id>.jsonl` in the policy (not resumable) and in `sessionMissing()`.

### H2. A woken agent that never reports leaves hc's state at "working, app=herdr-standin" forever
- After `execvp`, hc keeps the last report until the new program reports (F5 extra 3, `plans/agent-suspension.md:185`).
  `resume.js:18-23` says that Claude can miss its OSC 7501 handshake and then never reports. Recovery deals with this by retrying (`TRIES`, `REPORT_MS`). The wake does not.
- Effects across tickets:
  - hc: the terminal stays `working`. Then `hc wait`, `hc wait --children` (the parent) and `hc send --if idle` behave as if the agent were busy indefinitely (story 25).
  - `claude-polling.js:36-37` `isClaude()` returns `claude("herdr-standin")` = false, because `report.app` wins. The session and options poller
    (`main.js:244`) stops updating `herdr.claude-session` and `herdr.claude-options`.
  - Policy `agentOf()` (`suspend-policy.js:27-31`) returns null, giving "not-resumable". The agent is never suspended again.
  - Only the sidebar recovers: `shownPane()` (`main.js:303-309`) hides the stale report after 30 s. The core state stays wrong.
- Fix direction: after a wake, the leader could treat a stale stand-in report (older than WAKE_MS, stand-in not in front) the way recovery treats a
  silent resume. At least document it as a known limit. The README's "A 'waking…' that no agent ends clears after 30 s" (README:481)
  suggests that the problem is solved, but only the sidebar row changes.

---

## MEDIUM

### M1. A Pi record whose `sessionFile` does not exist yet is suspended, and its stand-in stays blocked indefinitely
- `suspend-policy.js:40` requires only a `sessionFile` path in the record. `standin.ts:93-95` then reads the file header and refuses when it is missing.
- The Pi extension records `getSessionFile()` from `session_start` (`pi/extensions/herdr-recovery/index.js:18-24`). If Pi writes the file
  lazily (only after the first message), a fresh idle Pi with no turns is eligible. Its first message then gets "not woken", a file and blocked. That is safe
  but useless. The policy can run the same `holdsPiSession()` check (it already has `readTextFile`) before step 2.

### M2. Every new terminal probably loses login-shell mode on macOS
- Today hc starts `fish -l` (F1 evidence, `plans/agent-suspension.md:175`). The hc docs say that a configured `shell` is used as written ("Each list
  item is one argument"). `herdr-shell:94-95` runs `exec "$shell" "$@"`, and the stand-in runs `[shell]` (`standin.ts:75`) and `exec "${SHELL:-/bin/sh}"` (`standin.ts:38`).
  None of them adds `-l`. zsh users would lose `.zprofile` and `.zlogin` (Homebrew PATH). fish's `status is-login` blocks would stop running.
- Not verified on a core (the shell key is not installed on this machine). Check `hc get` argv on a disposable core. Fix: `shell = ["…/herdr-shell", "-l"]`,
  or have herdr-shell add `-l` on Darwin when it receives no arguments.

### M3. `herdr.last-agent` is probably overwritten with `agent` while a stand-in holds a terminal
- `main.js:223-229` `remember()` writes `herdr.last-agent=<p.program.key>` for any pane with `p.program.agent`. The stand-in reports an app
  that is not in the program table, so the app's generic `agent` entry describes it (herdr-app `programs.json` has `"agent": {…}`; AGENTS.md: "only the generic `agent`
  fallback yields to a `match`"). Herdr calls every reporting program an agent (AGENTS.md:153).
- The sidebar test fixture assumes `program: { key: "agent", agent: false }` (`tests/sidebar-suspension.test.mjs:63`). That is a guess, and it hides the problem.
- Effect: within 3 s the label reads `agent`. `RECIPES["agent"]` is undefined, so if the woken agent crashes before it reports (see H2), the kept terminal shows
  a shell **without ↻**, which breaks story 50 and README:474-475. It corrects itself only when the real agent reports.
- Fix: skip `remember()` when `p.app === STANDIN_APP` or the terminal has the `herdr.suspended` label. Check `program.agent` for a stand-in in a live app.

### M4. root=shell: SIGTERM to the hosting shell can end that shell's other jobs, and the process rule never sees them
- `onlyHelpers()` (`suspend-policy.js:139-142`) checks only the **agent's** direct children (`foreground.pid`). For root=shell, the signal goes to the
  shell (`:604`, `:620`). A background job in the same fish (`npm run dev &` before the agent started) is the shell's child, so the rule does not check it.
  It receives SIGHUP when the shell dies. Story 7 says "suspension never kills work". Fix: for root=shell, also require that the main program has no
  children other than the agent.
- Related judgement call: helper matching is a substring of the whole command line (`child.command.includes(h)`). With the default `mcp`, any child
  whose path contains "mcp" (for example `~/projects/mcp-foo/node_modules/.bin/vite`) counts as a helper. The spec mandates "contains", but this is easy to hit.

### M5. README's claim "refused by hc as unavailable" covers only part of the switch window
- README:436-437 and spec story 29. Sends fail only while hc has no program. Once `herdr-shell` runs (about 15 ms plus the stand-in's Bun start and its own `hc get`), the
  terminal holds a silent program. Plain `hc send` still delivers to silent programs (recovery depends on that: `resume.js` `send()` types into a shell).
  Bracketed paste is still off. Effects:
  - The text waits in the cooked-mode pty buffer (echoed). The stand-in later reads it as typed lines, so a multi-line message splits into several "messages"
    that are joined with blank lines (`input.ts:75-79`, `standin.ts:118`). The text changes.
  - On herdr-shell's error path, `read -r _` (`herdr-shell:109`) consumes a delivered line as "Enter". That message is lost.
  - Nothing runs as a command: the label is set before the signal (`suspend-policy.js:613` before `:620`). Safety holds, but the README overstates the result.

---

## LOW

- **L1. The stand-in can stay at `working`.** `standin.ts:111` reports `working` before the chdir, label and exec steps. On a second failed **empty** wake,
  `keepUndelivered` returns early (`:150`, `else if (blocked) return;`) and does not report again. While the stand-in is in front, `waking()`
  (`resume.js:82`) stays true, so the sidebar shows "waking…" with no end. `idleStandin()` is false, so focus wakes stop. (The Spec reviewer found the same.)
- **L2. An unhandled rejection in the stand-in ends a kept terminal.** If `void wake()` (`standin.ts:168`) throws, Bun exits non-zero. That is an ordinary exit, which hc
  treats as final. `system.ts:17` also exits with 0 on stdin end. herdr-shell's comment (`herdr-shell:9-10`) states this rule, but the stand-in does not guard against it
  (for example with a top-level `process.on("unhandledRejection")` that keeps the process alive).
- **L3. Repeated work while not installed.** When the stand-in is not installed (the default without Bun) and any agent is past its threshold, each 15 s pass runs
  `sh -c INSTALL_PATHS` and reads config.toml (`suspend-policy.js:674-676`). This happens every pass, with no backoff. That matches README:522-524 to the letter but is wasteful in the
  most common unconfigured state.
- **L4. The path contract depends on the environment.** `install.sh:33-34` and `suspend-policy.js:203-206` both derive the paths from `XDG_DATA_HOME` and `XDG_CONFIG_HOME`, in two
  different processes: the installer's login shell and the Herdr app or mod environment. If they differ (a macOS GUI app without shell rc variables), the policy
  reports "not-installed" indefinitely, or it checks a different config than the one hc reads. `$(cd "$bin" && pwd)` (`install.sh`) is a logical path and
  is compared literally against the mod's string.
- **L5. A manual request can race an automatic suspension.** When "Suspend now" queues behind an automatic suspension of the same terminal (`serial`), its
  step 1 sees the label and answers "Can't suspend: already suspended", although the terminal was just suspended (`suspend-policy.js:85`, `:556-561`).
- **L6. The no-answer text needs a render.** The menu's "no answer from tab tree" is computed only on render (`tab-menu/main.js:99-103`, "No timer"). If nothing re-renders the popup, it
  keeps showing "Suspending…".
- **L7. Old requests stay forever.** `tincho.suspend.requests` is only merged into (`tab-menu/main.js:236`), and neither side prunes it. Old addresses accumulate in shared state.
- **L8. A live agent can show 💤.** `heldState()` (`main.js:291-295`) shows 💤 for a live agent with no report (Claude before its handshake) that carries a stale label, until the 60 s
  repair. README:476 says "A live agent never shows 💤".
- **L9. Stand-in arguments are dropped.** The stand-in's handover and the root=shell tail start `$SHELL` with no arguments (`standin.ts:75`, `:38`). The spec says herdr-shell
  "passes its arguments on". The stand-in path loses them (see also M2).
- **L10. The core may read the shell key only at start.** The Spec reviewer flagged README:506 ("hc uses the new shell for programs it starts after that"). The hc docs say shell "changes
  apply on the next launch", so this is probably correct. The story-51 guard reads config.toml, not the running core. This is low risk but unverified.
- **L11. Stale comment.** The STATE shape comment in `tab-menu/main.js:21-22` lacks `source`, `step` and `rolledBack` (compare `suspend-policy.js:303-305`).

---

## Contracts that agree (checked)
- Label names (`herdr.suspended`, `herdr.never-suspend`, `herdr.claude-options`, `herdr.claude-session`, `herdr.pi-recovery`) are the same in recipes.js,
  suspend-policy.js, tab-menu, herdr-shell's awk and the stand-in.
- The suspension record `{version:1, agent, root, cwd, since}`: the writer (`suspend-policy.js:605`, which round-trips through `suspension()`) and the readers
  (stand-in, `staleLabel`, sidebar `describe`, herdr-shell's agent regex) agree.
- Shared keys `tincho.suspend.requests` and `tincho.suspend.state`, `REQUEST_MS`, and the complete Outcome→text map in tab-menu agree.
- `STANDIN_APP` matches the stand-in's `APP` ("herdr-standin"). They are duplicated even though standin.ts imports recipes.js, which is the strongest standards smell.
- The bin and config paths are the same (subject to L4). herdr-shell finds `herdr-standin` beside itself, and the installer writes both there.
- Safety core: messages reach the agent only as argv after `--`, through `"$@"` (`standin.ts:38`, `:118-119`) or through a direct execvp. The input parser never runs anything.
  herdr-shell starts a shell only when hc answered with labels but without the suspended label. The label is set before the signal. I found no path where
  message text is evaluated by a shell.
- Timers: the 15 s pass in each copy, the 60 s heartbeat, one 1 s timer per focused suspended tab, and one `cx.sleep` for the end of a wake. There is no polling beyond that (but see L3).

## Standards (from the Standards sub-agent, condensed)
- Ticket `Status:` lines use `done`, which is not one of the triage roles in `docs/agents/triage-labels.md`, and they mix the formats `Status:` and `**Status:**`.
- GLOSSARY.md does not define the cross-file terms "label repair / stale label" and "leader" (domain.md asks for that).
- Comments use "resume" for waking (`main.js:239`, `standin.ts:89`). GLOSSARY says "Wake … Avoid: Resume".
- Duplicated constants that must agree: the `APP`/`STANDIN_APP` pair (avoidable), the label strings in four files, the install paths and the TOML `shell` reader in two
  places, the hc retry policy in two places, and `report.app ?? status.app` in five places.
  `statusOf` (suspend-policy.js:58) and `stateOf` (resume.js:67) are near-duplicates. resume.js now covers both recovery and front-program and wake detection (Divergent Change).
