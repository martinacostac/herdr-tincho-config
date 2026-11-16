# 02: Shared recipe module returns a working folder and a command word list

**What to build:** A preparatory refactoring of the shared recipe module, so that recovery and the stand-in start agents the same way. Each recipe returns a working folder and a command word list (`cwd` and `argv`) instead of a shell line. The recipe input comes from the terminal's labels, so that a later label (such as Claude's launch options) needs no change in the callers. Recovery turns the result into exactly the same shell line that it types today, through the existing quoting. Recovery behaves exactly as before.

The module also gains:

- The `herdr.suspended` label name and a parser for its versioned record (version 1, agent `claude` or `pi`, root `shell` or `agent`, absolute `cwd`, `since` in milliseconds). Malformed, future-version and control-containing records are rejected.
- The check that a Pi session file still holds the recorded session (the header id matches), as a pure helper over the file's first line. Recovery uses it instead of its own copy, and the stand-in (ticket 05) uses it later.

The module keeps the existing label names and the Pi record parser. It must stay importable without the Herdr host, because the stand-in imports it at build time.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Each recipe returns a working folder and a command word list for every agent and session case (Claude: session id, tab name, picker; Pi: session file, session id only, picker, no record)
- [ ] The existing resume and recovery-lifecycle tests pass unchanged: recovery types exactly the same lines as before
- [ ] New tests cover the working folder and command for each case
- [ ] The suspension record parser accepts a valid record and rejects malformed, future-version, relative-folder and control-containing records
- [ ] The Pi session check is a pure helper with tests, and recovery uses it
- [ ] The module imports no Herdr host module
