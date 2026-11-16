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

**Status:** ready-for-agent

- [ ] bun tests cover bracketed paste, typed lines, an empty Enter, and pastes that contain newlines or escape sequences
- [ ] bun tests cover the 500 ms batching window and the joined messages
- [ ] bun tests cover the status report emitted in each state
- [ ] bun tests cover the wake command for each root, including `--` and the messages, and label removal before the replacement
- [ ] bun tests cover the stale-label handover to `$SHELL`
- [ ] bun tests cover the missing-session path: file written, path shown, `blocked` reported, no wake
- [ ] The stand-in uses the shared recipe module and the shared Pi session check, not copies
- [ ] The ahead-of-time build runs by hand and the measured footprint is 10 MB or less
