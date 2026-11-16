# Spec: suspend unused agents

Status: ready-for-agent

Sources: the agreed design in the agent-suspension plan (decisions Q1–Q37), the glossary, and ADR 0001 (suspended agents are reached through a stand-in started by hc's `shell` setting). This spec does not reopen those decisions.

## Problem Statement

I run many Claude and Pi agents at the same time, each in its own hc terminal. Most of them sit idle for hours after they finish a task, but each one still holds its memory (about 250 MB for a Pi agent, plus its MCP servers). With enough agents open, the machine runs short of memory, even though I use only a few agents at any moment.

I cannot just close the idle agents. Their conversations matter. Other agents (parents, siblings, children) still send them messages with `hc send`, wait for them with `hc wait`, and depend on their addresses, labels and parent/child links. If I end a terminal, its address disappears and every later message fails. If I end only the agent and leave a shell, the next message that arrives gets run as a shell command. Today I must choose between memory and a working agent team.

## Solution

Herdr suspends unused agents automatically, the way Chrome handles idle browser tabs. When an agent has been idle past a threshold, is not in the focused tab, has no background work of its own, is not blocked, and is not pinned, Herdr ends its process to free memory. Its terminal stays live with the same address, labels, parent and children.

A small stand-in program holds the suspended agent's terminal. It shows the agent's last screen with a 💤 line. It never runs anything that it receives. When a message arrives (from another agent, from hc itself, or typed by me), or when I keep the agent's tab focused for one second, the stand-in wakes the agent from its session, with the same launch options. The messages it received become the agent's first prompt. Agents that send messages do not need to know about suspension. Plain `hc send` keeps working, and hc itself is not changed.

The sidebar shows suspended agents dimmed with 💤, and "waking…" while they start. The right-click menu offers **Suspend now** and **Never suspend**. A settings key controls the threshold and the helper allow-list, or turns automatic suspension off. The installer builds and installs the stand-in and points hc's `shell` setting at a tiny launcher script, without overwriting a different value that I set.

## User Stories

### Freeing memory

1. As a Herdr user, I want unused agents suspended automatically, so that idle agents stop holding memory that I need for active work.
2. As a Herdr user, I want only resumable agents (Claude or Pi, with session labels) suspended, so that no agent is ended when Herdr cannot start it again with its conversation.
3. As a Herdr user, I want an agent suspended only after it has been idle or done for the configured number of minutes, so that agents I just used stay ready.
4. As a Herdr user, I want the idle clock to start from the later of the agent's last status change and the last time its tab was focused, so that an agent I was just reading is not suspended right after I leave it.
5. As a Herdr user, I want the agent in my focused tab never suspended, so that the agent I am looking at never disappears under me.
6. As a Herdr user, I want working and blocked agents never suspended, so that running tasks and pending questions are never interrupted.
7. As a Herdr user, I want agents with background processes of their own (dev servers, watchers, long builds) never suspended, so that suspension never kills work that the agent started.
8. As a Herdr user, I want MCP server processes treated as helpers that do not prevent suspension, so that almost every Pi agent can still be suspended.
9. As a Herdr user, I want to configure the helper allow-list, so that I can mark other harmless child processes as helpers.
10. As a Herdr user, I want agents on remote machines never suspended, so that suspension acts only on terminals in this machine's core.
11. As a Herdr user, I want a parent agent whose children are still running left alone, so that coordination is not broken (a parent that waits on children already counts as working).
12. As a Herdr user, I want child terminals to survive when their parent is suspended, so that suspending a parent never ends its children's work.

### Settings and manual control

13. As a Herdr user, I want to set the idle threshold in minutes in my Herdr app settings, so that I can choose how aggressively memory is freed.
14. As a Herdr user, I want sensible defaults (30 minutes, MCP servers as helpers) when I have not set anything, so that the feature works without configuration.
15. As a Herdr user, I want to turn automatic suspension off with one setting, so that I can stop it without uninstalling anything.
16. As a Herdr user, I want manual suspension to keep working when automatic suspension is off, so that I can still free memory on demand.
17. As a Herdr user, I want a **Suspend now** item in the tab's right-click menu, so that I can free an agent's memory immediately without waiting for the threshold.
18. As a Herdr user, I want **Suspend now** to skip only the time threshold and still apply every other rule, so that a manual suspension is never unsafe.
19. As a Herdr user, I want the menu to tell me why **Suspend now** cannot suspend an agent (focused, working, blocked, background processes, pinned, not resumable, remote, feature not installed), so that I understand what to change.
20. As a Herdr user, I want a **Never suspend** item that pins an agent, so that agents I want always ready are never suspended.
21. As a Herdr user, I want to remove the pin from the same menu, so that a pinned agent can become eligible again.

### Reaching a suspended agent

22. As an agent that sends messages, I want plain `hc send` to a suspended agent's address to work, so that I do not need to know about suspension.
23. As an agent that sends messages, I want my message delivered as the woken agent's first prompt, so that nothing I sent is lost or changed.
24. As an agent that sends messages, I want several messages that arrive close together delivered together in one wake, so that the agent starts once and sees all of them.
25. As an agent that sends messages, I want a suspended agent to look idle to `hc send --if idle`, `hc wait` and `hc send --wait`, so that my coordination commands behave as with an idle agent.
26. As a parent agent, I want hc's own notes about a child to wake that child when it is suspended, so that every kind of message reaches it.
27. As a Herdr user, I want a suspended agent's address, name, labels, parent and children unchanged, so that every other agent and mod keeps working with it.
28. As a Herdr user, I want a message to a suspended agent never run as a shell command, so that text from another agent can never execute on my machine.
29. As a Herdr user, I want messages sent while a terminal switches to the stand-in refused by hc (as unavailable) instead of lost or executed, so that the sender sees a clear, retryable failure.

### Waking

30. As a Herdr user, I want a suspended agent woken when I keep its tab focused for one second, so that the agent is ready when I come back to it.
31. As a Herdr user, I want stepping past tabs with ⌘P or the next-agent command not to wake anything, so that browsing my tabs does not undo suspension.
32. As a Herdr user, I want to wake an agent by pressing Enter in its stand-in, so that I can wake it from a plain terminal through `hc attach`.
33. As a Herdr user, I want text that I type in the stand-in and confirm with Enter delivered as the first prompt, so that I can talk to a suspended agent directly.
34. As a Herdr user, I want a woken agent started from its exact session in its recorded working folder, so that it continues the same conversation in the same place.
35. As a Herdr user, I want a woken agent started with the same launch options it had before (model, sandbox, tools), so that it behaves as before it was suspended.
36. As a Herdr user, I want an agent that ran inside my shell to return to a shell prompt when I exit it after a wake, so that the terminal behaves as before suspension.
37. As a Herdr user, I want an agent that hc started directly to end its terminal when I exit it after a wake, as it does today, so that waking does not change exit behavior.
38. As a Herdr user, I want a wake that cannot find the agent's session to keep the messages safe in a file, show me where they are, and report the agent as blocked, so that nothing is lost and the parent is notified.

### Seeing suspension in the sidebar

39. As a Herdr user, I want a suspended agent's tab shown with a dimmed name and 💤, so that I can see which agents are suspended.
40. As a Herdr user, I want a waking agent's tab shown as "waking…", so that I know it is starting and not stuck.
41. As a Herdr user, I want the stand-in to show the agent's last screen and a line that says when it was suspended and what wakes it, so that the terminal explains itself.
42. As a Herdr user, I want the recovery button (↻) never shown on a suspended agent, so that I cannot type a recipe into a stand-in by mistake.
43. As a Herdr user, I want recovery to refuse to type into a stand-in even if it is asked to, so that a stale click can never feed text to the stand-in.

### Robustness

44. As a Herdr user, I want each suspension to check again that the agent is still unused immediately before it acts, and to stop if anything changed, so that an agent that started work is never ended.
45. As a Herdr user, I want only one copy of the policy acting at a time, even with several Herdr windows open, so that an agent is never suspended twice at once.
46. As a Herdr user, I want suspended agents to stay suspended through `hc server stop` and a reboot, so that they still wake on the next message (pending fact F1).
47. As a Herdr user, I want a stand-in that finds no suspension record to hand over to my normal shell, so that a stale stand-in never blocks a terminal.
48. As a Herdr user, I want every new terminal to start my normal shell when it is not suspended, with only a small delay (about 15 ms), so that the feature does not change normal terminals.
49. As a Herdr user, I want the shell launcher to wait while the core starts and never fall back to a plain shell unless hc confirmed the terminal is not suspended, so that a message can never reach a shell during start-up.
50. As a Herdr user, I want an agent that crashes after its first suspension to leave a kept terminal with a shell and ↻, so that recovery is easier than today.
51. As a Herdr user, I want nothing suspended unless the stand-in and its launcher are installed and configured as hc's shell, so that a partial install can never let a message run in a shell.

### Installing

52. As a Herdr user, I want the installer to build the stand-in with Bun, so that I get the small (about 6.6 MB) native build when it is available.
53. As a Herdr user, I want the installer to fall back to Bun's standard compile when the small build is not available, so that stable Bun still works.
54. As a Herdr user, I want the installer to skip the feature and say so when Bun is missing, so that the rest of the install still succeeds.
55. As a Herdr user, I want the stand-in and its launcher installed outside my PATH, so that they do not pollute my commands.
56. As a Herdr user, I want the installer to change only the `shell` key of herdr-core's config and keep my other keys, so that my core settings stay mine.
57. As a Herdr user, I want a different existing `shell` value reported as a conflict and kept, unless I pass `--force`, which keeps a copy of the original file, so that the installer never silently replaces my choice.
58. As a Herdr user, I want repeated installs to rebuild the stand-in only when its sources change, so that installs stay fast and the manifest stays stable even with non-reproducible builds.

### Maintaining

59. As a maintainer, I want the recipe that starts an agent shared by recovery and waking, so that both always start agents the same way.
60. As a maintainer, I want Claude's launch options recorded with the same allow-list rules as Pi's (never prompts, credentials or session selectors), so that no secret is stored in a label.
61. As a maintainer, I want a by-hand integration script with throwaway terminals, so that I can check the full flow end to end without touching live agents.
62. As a maintainer, I want the README to document the settings, the behavior and the limits, and the CHANGELOG to record the feature, so that users know what to expect.

## Implementation Decisions

### Modules

- **Shared recipe module (modified).** Today each recipe returns a shell line to type. It changes to return a working folder and a command word list (fields `cwd` and `argv`), per agent. Recovery turns that into the same shell line it types today, through the existing quoting. The stand-in imports the same module at build time, so a recipe change requires a stand-in rebuild. The module keeps the label names and the Pi record parser. It gains the Claude launch options parser and the suspension record parser.
- **Claude launch options (new).** An allow-list parser modeled on Pi's launch options parser: only known reusable options are kept, with canonical names. Prompts, credentials, system prompts and session selectors are dropped. An unknown option stops capture instead of guessing its arity, and `--` stops capture. The input is Claude's `foreground.argv`, read where the session poller already records `herdr.claude-session`. The result goes to a new label `herdr.claude-options`, written alongside the session label. Its value is validated like Pi's record (version, printable strings). A malformed value is ignored, and the agent then starts without options. The exact allow-list is fixed after fact F2.
- **Pi launch options (unchanged).** The Pi extension keeps recording its launch options in its recovery record.
- **Suspension policy module (new), run by a Herdr mod.** It holds the eligibility rules, the idle clock, the helper check, the leader choice, the ordered suspension steps with aborts, and wake on focus. One copy leads, chosen through the app's shared state (`setShared`/`shared`), and only the leader acts. Suspension happens only while the app is open. It records the last focus time of each tab in memory. After an app restart, only the status timestamp counts.
- **Stand-in (new program, TypeScript for Bun, compiled ahead of time).** It handles input parsing, batching, status reports, the screen, the wake, and the missing-session path.
- **Shell launcher, herdr-shell (new, POSIX sh, a few lines).** It is hc's configured `shell`.
- **tab-tree mod (modified).** It shows the suspended and waking states, keeps recovery away from stand-ins, and records Claude launch options.
- **tab-menu mod (modified).** It adds the **Suspend now** and **Never suspend** items on agent tabs.
- **Installer (modified).** It builds and installs the stand-in and the launcher, and manages the `shell` key.

### Unused agent: eligibility

An agent is eligible when all of these are true:

- It is resumable: the agent is Claude or Pi, with its session label or record.
- Its status is `idle` or `done` for at least the threshold, counted from the later of its `status_ms` and the last time its tab was focused.
- Its tab is not focused.
- It is not `working` or `blocked`.
- It is not pinned (label `herdr.never-suspend=1`).
- It is local (its address has no machine prefix).
- Every descendant process of the agent is a helper. A helper is a process whose command line contains an entry of the helper allow-list. The default allow-list is `mcp`, which matches the observed MCP servers under each Pi agent.

Child terminals do not prevent eligibility.

### Settings

The setting is read with `settings()` from the Herdr app settings, under the key `tincho.suspend`, with `after_minutes` (a number) and `helpers` (a list of strings). When the key is missing, the defaults are 30 minutes and `["mcp"]`. The value `false` or `after_minutes: 0` turns automatic suspension off. Manual suspension still works then.

### Suspension steps

The steps run in this order. Any failed check aborts the suspension and changes nothing more.

1. Read the terminal again with `hc get` and confirm that the agent is still unused (for **Suspend now**: every rule except the threshold).
2. Run `hc keep` on the terminal.
3. Read status and `turn` again. Abort if either changed.
4. Set the label `herdr.suspended` to a versioned JSON record with these fields: `version` 1, `agent` (`claude` or `pi`), `root` (`shell` when the terminal's main program is a shell that hosts the agent, `agent` when hc started the agent directly), `cwd` (from `foreground.cwd`), and `since` (milliseconds).
5. Send `SIGTERM` to the terminal's main program (`pid`). Fact F3 can change this to `SIGKILL` for shell main programs.
6. hc treats the program as lost and starts its configured `shell`. Sends during the switch fail with `unavailable`. The launcher sees the label and replaces itself with the stand-in.

The policy suspends nothing, and **Suspend now** gives the reason, unless the stand-in and the launcher are installed and the launcher is hc's configured `shell`.

### herdr-shell

- It reads its own terminal (from `HC_TERMINAL_ID`) with `hc get` as JSON. If the label `herdr.suspended` is present, it replaces itself with the stand-in for that address.
- If hc answered and the label is absent, it replaces itself with `$SHELL` and passes its arguments on. When `$SHELL` is unset, it uses `/bin/sh`.
- If hc is unavailable or still starting, it retries for up to about 2 s. Then it prints an error and waits for input, without starting a shell. The exact error to retry on comes from fact F4.
- The label is the only record of suspension. There is no marker file.

### Stand-in

- Process name `herdr-standin`. Arguments: agent, address, name.
- On start, it reads its own label. If the label is missing, it replaces itself with `$SHELL`.
- Screen: the terminal's restored last screen (hc's restore-screen option), then one line in this form: 💤, the agent, "suspended at" HH:MM, "wakes on a message or when focused", "Enter wakes it".
- It reports `idle` over OSC 7501 on start. It reports `working` once a wake begins. It reports `blocked` on the missing-session path. The report syntax comes from fact F5.
- Input: raw mode with bracketed paste. Each pasted block, or each typed line followed by Enter, is one message. An empty Enter wakes the agent with no prompt. The stand-in never runs input.
- Batching: after the first message, it waits 500 ms for more, then wakes the agent with all messages joined by blank lines.
- Wake, in order:
  1. Change to the recorded `cwd`.
  2. Remove the `herdr.suspended` label.
  3. Replace itself (`execvp` through Bun's FFI) with the shared recipe's command, then `--`, then the messages.
  4. For `root=shell`, the command runs under `/bin/sh -c`, followed by an exec of `$SHELL`, so that exiting the agent returns to a prompt. For `root=agent`, the command runs directly.
- Missing session: for Pi, the session file is absent or has a different id. For Claude, there is no session id. In both cases the stand-in does not wake the agent. It writes the messages to a file named after the address and the time, in an `undelivered` folder under the project's XDG state folder. It shows the path and reports `blocked`, and hc then notifies the parent.

### What wakes an agent

- Any message, including hc's own notes to a parent.
- The agent's tab staying focused for 1 s. The leading policy copy then presses Enter in the stand-in with `hc keys` (an empty Enter, so the agent wakes without a prompt).
- Enter typed in the stand-in.

### tab-tree and tab-menu

- A terminal with the `herdr.suspended` label shows a dimmed name and 💤. It shows "waking…" from when its stand-in reports `working` until the woken agent reports its own status.
- The ↻ button never appears for a suspended terminal. Recovery checks the label before it types, because its "at a shell" check (foreground process is the main program) also passes for a stand-in.
- **Suspend now** applies every rule except the threshold. When a rule fails, the menu says which one. **Never suspend** sets or clears `herdr.never-suspend=1`, and the item shows its current state.

### Installer

- It builds the stand-in with Bun's small ahead-of-time compile (trimmed locales, no function source), about 6.6 MB footprint. If that is not available, it falls back to Bun's standard compile with minify, about 7 MB footprint. Without Bun, it prints `suspend: skipped (no bun)` and leaves hc's `shell` key unchanged.
- It installs the stand-in and the launcher into a bin folder under the project's XDG data folder, which is not on PATH.
- It changes only the `shell` key of herdr-core's config file and keeps every other key. A different existing value is reported as a conflict and kept. `--force` replaces it and keeps the original file as `.orig`, like the existing `--force` behavior.
- It records the built binaries in the install manifest by the hash of their sources (the stand-in sources and the shared recipe module), not by the hash of the output. A rebuild happens only when the sources change.

### Recovery and crashes

- Suspended agents stay suspended through `hc server stop` and a reboot, subject to fact F1.
- After its first suspension, an agent's terminal is kept. A later crash of that agent leaves a kept terminal with a shell and ↻.

### Docs

- A README section covers the settings, the behavior and the known limits. The CHANGELOG gets an entry. `herdr-app check` passes for each changed mod.

## Testing Decisions

A good test checks external behavior through a module's public interface: the commands sent to hc, the labels written, the command that is started, and what is shown or reported. It does not check internal state or private helpers. Each test uses fakes only at the process boundary (the Herdr host, hc on PATH, the file system of a disposable home), so the production logic runs unchanged. No test touches live agents, real sessions or the real hc core, except the by-hand integration script.

The user approved these seams:

- **Suspension policy module, tested with a mocked Herdr host** (node --test). The tests cover every eligibility rule and its failure reason; the idle clock (status time against focus time, and restart behavior); helper matching and custom allow-lists; the settings defaults and both ways to turn suspension off; leader choice with two copies; the ordered steps (check, keep, re-check status and `turn`, label, signal) and an abort at each step; `root` detection; the signal choice; refusal when the stand-in is not installed; and the wake on 1 s of focus, but not on stepping past. Prior art: the host fakes in the resume, recovery-lifecycle, claude-polling and panel-idle tests.
- **Shared recipe module** (node --test). The tests cover the working folder and command for each agent and session case; recovery still types exactly the same lines as before (the existing resume and recovery-lifecycle tests keep passing unchanged); the Claude launch options parser drops prompts, credentials and session selectors, stops at unknown options and at `--`, and rejects control characters; and the suspension record parser rejects malformed, future-version and control-containing records. Prior art: the resume tests and the Pi recovery tests for the Pi launch options parser.
- **Stand-in input, batching, status and wake logic** (bun test). The tests cover bracketed paste, typed lines, an empty Enter, and pastes that contain newlines or escape sequences; the 500 ms batching window; the status reports emitted in each state; the wake command for each `root`, including `--` and the joined messages; label removal before the replacement; the stale-label handover to `$SHELL`; and the missing-session path (file written, path shown, `blocked` reported). The replacement with `execvp` and the terminal I/O stay behind a thin boundary that the tests replace with fakes.
- **herdr-shell, with a fake hc on PATH** (sh). The tests cover: label present starts the stand-in; label absent starts `$SHELL` with its arguments; `$SHELL` unset falls back to `/bin/sh`; an unavailable core is retried; and the launcher never falls back to a shell when hc never answers. Prior art: the fake commands and disposable roots in the installer tests.
- **Installer, extending the installer shell tests with disposable homes.** The tests cover the ahead-of-time, standard and skip paths (with fake bun commands on PATH); a missing config file; an existing config with other keys kept; an identical `shell` value; a conflicting value reported and kept; `--force` replacing it with a `.orig` copy; manifest entries keyed by source hash; and no rebuild on an unchanged second run. Prior art: the existing fixtures in the installer tests.
- **Integration script with throwaway hc terminals, run by hand only.** It creates one agent started by `hc run` and one fake agent hosted by fish. It suspends each one and sends a message. It checks that the message arrives as the first prompt, that address, labels and parent are unchanged, and that nothing ran in a shell. It also checks the 10 MB footprint limit for the stand-in. It is not part of the automatic test run.

## Out of Scope

- Any change to hc or herdr-core. An upstream hook that runs a command on a send to a labeled terminal would make the stand-in unnecessary. It is worth requesting separately (ADR 0001).
- Automatic suspension while the Herdr app is closed.
- Suspending agents on remote machines.
- Suspending agents other than Claude and Pi, or agents that are not resumable (no session labels).
- Keeping every agent terminal from the start. Only suspension keeps a terminal.
- Preventing the loss of a message pasted milliseconds before the signal. That needs an hc change.
- Preserving unsent text typed into an agent's input and left there past the threshold.
- Stopping processes with `SIGSTOP`, ending terminals, or shell-specific hooks as alternatives (rejected in ADR 0001).
- A memory usage display or per-agent memory thresholds.

## Further Notes

### Prerequisites: open facts to check before building

The first implementation task checks these facts on a disposable core, so that live agents are not touched. It records the results in the plan. If a result contradicts this spec, the design changes before building continues.

- **F1**: Do kept terminals keep their address and labels after `hc server stop` and the next core start? Check with a separate terminal socket or state folder. User story 46 depends on this fact.
- **F2**: What does `foreground.argv` show for Claude? (Pi hides its own.) Does `claude --resume <id> -- "<message>"` submit the message interactively? The Claude launch options allow-list and the Claude wake command depend on this fact.
- **F3**: When fish is the terminal's main program and receives `SIGTERM`, does hc treat that as a loss (keep recovery runs) or as a normal exit (the terminal finishes)? If fish exits normally, use `SIGKILL` for shell main programs. Also check that the agent inside then exits cleanly on SIGHUP, with its session saved.
- **F4**: Which error kind and text does `hc get` return while the core is starting? The launcher's retry depends on this fact.
- **F5**: What is the exact OSC 7501 report syntax? Confirm `idle`, `working` and `blocked` reports from a probe. Confirm that `hc send --if idle`, `hc wait` and `hc send --wait` treat the stand-in as an idle agent.

### Known and accepted limits

- Automatic suspension happens only while the Herdr app is open.
- A message pasted milliseconds before the signal can be lost.
- Unsent text typed into an agent and left past the threshold is lost.
- Every new terminal pays about 15 ms for the launcher's label check.
- Bun's small ahead-of-time compile is experimental and available only in canary builds today. The standard compile fallback covers stable Bun (about 7 MB footprint, larger on disk).

### Additions beyond the plan's wording (confirmed by the parent agent, with the user's delegated authority)

- The policy refuses to suspend when the stand-in and launcher are not installed and configured (user story 51). This closes the case where Bun was missing at install time. Without it, a message would reach a plain shell.
- Helper matching uses "the command line contains the entry".
- The `herdr.claude-options` value is a versioned JSON value, validated like Pi's record.
- The policy module runs inside the tab-tree mod. tab-tree is always loaded in the `tincho` layout and already tracks labels, focus and recovery. A separate mod placed nowhere would only run where a layout puts it. Several tab-tree copies can run at once, so the leader choice still applies.
- The "waking…" display runs from the stand-in's `working` report until the woken agent reports its own status.
- Without Bun, the installer leaves hc's `shell` key unchanged.
