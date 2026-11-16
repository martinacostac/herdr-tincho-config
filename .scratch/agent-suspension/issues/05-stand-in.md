# 05: Stand-in program

**What to build:** The stand-in, a TypeScript program for Bun that holds a suspended agent's terminal, receives the messages sent to it, never runs them, and wakes the agent with them. It is compiled ahead of time. Its sources live outside the Herdr tree that the installer copies, and it imports the shared recipe module at build time.

Behavior:

- Process name `herdr-standin`. Arguments: agent, address, name.
- On start it reads its own `herdr.suspended` label. If the label is missing, it replaces itself with `$SHELL`.
- Screen: the terminal's restored last screen, then one line with 💤, the agent, "suspended at" HH:MM, "wakes on a message or when focused", "Enter wakes it".
- It reports `idle` over OSC 7501 on start, `working` once a wake begins, and `blocked` on the missing-session path, in the syntax recorded for fact F5.
- Input: raw mode with bracketed paste. Each pasted block, or each typed line followed by Enter, is one message. An empty Enter wakes the agent with no prompt. Input is never run.
- Batching: after the first message it waits 500 ms for more, then wakes the agent with all messages joined by blank lines.
- Wake, in order: change to the recorded `cwd`; remove the label; replace itself (`execvp` through Bun's FFI) with the shared recipe's command, then `--`, then the messages. For `root=shell` the command runs under `/bin/sh -c` followed by an exec of `$SHELL`, so that exiting the agent returns to a prompt. For `root=agent` it runs directly. The Claude wake command follows what fact F2 found.
- Missing session (Pi: the session file is absent or holds another id; Claude: no session id): it does not wake. It writes the messages to a file named after the address and the time, in an `undelivered` folder under the project's XDG state folder, shows the path, and reports `blocked`.

The process replacement and the terminal I/O stay behind a thin boundary that tests replace with fakes. A by-hand build command produces the binary, and a footprint check shows 10 MB or less.

**Blocked by:** 01 (facts F2 and F5), 02 (shared recipe module)

**Status:** done

- [x] bun tests cover bracketed paste, typed lines, an empty Enter, and pastes that contain newlines or escape sequences
- [x] bun tests cover the 500 ms batching window and the joined messages
- [x] bun tests cover the status report emitted in each state
- [x] bun tests cover the wake command for each root, including `--` and the messages, and label removal before the replacement
- [x] bun tests cover the stale-label handover to `$SHELL`
- [x] bun tests cover the missing-session path: file written, path shown, `blocked` reported, no wake
- [x] The stand-in uses the shared recipe module and the shared Pi session check, not copies
- [x] The ahead-of-time build runs by hand and the measured footprint is 10 MB or less

## Comments

Done in 547b381 (stand-in) and 2385d12 (review fixes).

- Sources: `suspend/standin.ts` (logic), `suspend/input.ts` (paste and key parser), `suspend/system.ts` (the real boundary: terminal, hc, files, clock), `suspend/libc.ts` (execvp through bun:ffi, libc.dylib or libc.so.6), `suspend/main.ts` (entry), `suspend/build.sh` (build by hand). Tests: `tests/standin.test.ts` (bun test, 27 pass).
- Uses `recipe`, `suspension`, `piRecovery` and `holdsPiSession` from `herdr/mods/tab-tree/recipes.js`, so Claude's launch options (ticket 03) come along without code of their own.
- Build: `sh suspend/build.sh <out>` runs `bun compile --trim-locales en --no-compile-function-source`, or `bun build --compile --minify` when `bun compile` is missing. Measured footprint of an idle stand-in with `footprint <pid>` on macOS (Bun 1.4.5 canary): about 7.5 MB for the small compile, and 7.6 to 8.5 MB for the standard compile.
- Checked end to end in throwaway hc terminals with a fake `claude` on PATH: `hc send --if idle` to the stand-in wakes it in place (same pid). The message arrives after `--`, with its newlines. The label is removed, and the recorded folder and options are used. With `root=shell`, a zsh prompt follows. A missing Pi session file writes the messages to the undelivered folder and reports `blocked`, and the stale-label handover starts `$SHELL`.
- Beyond the ticket, all for safety:
  - Before exec, signals that Bun ignores (SIGPIPE) are reset to their default. Ignored signals survive exec, and without the reset the shell after the agent would ignore SIGPIPE.
  - A failed chdir, label removal or exec takes the missing-session path (messages saved, `blocked`). A failed exec also puts the label back.
  - When hc cannot read the terminal, or the record is unreadable, the stand-in reports `blocked` on start and never starts a shell.
  - An empty wake that cannot happen reports `blocked` only once.
- A Pi record without `sessionFile` counts as a missing session, because the stand-in cannot verify it. The Pi extension always records a file.
- Open: the restored last screen needs `restore_screen = true` in herdr-core's config. No ticket sets it today. The stand-in prints its line below whatever hc shows.
