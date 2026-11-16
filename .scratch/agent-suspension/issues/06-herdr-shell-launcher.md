# 06: herdr-shell launcher

**What to build:** herdr-shell, a POSIX sh script of a few lines that becomes hc's configured `shell`, so that every new terminal starts through it. It reads its own terminal (from `HC_TERMINAL_ID`) with `hc get` as JSON.

- When the `herdr.suspended` label is present, it replaces itself with the stand-in installed next to it, with the arguments the stand-in expects (agent, address, name).
- When hc answered and the label is absent, it replaces itself with `$SHELL` and passes its own arguments on. When `$SHELL` is unset, it uses `/bin/sh`.
- When hc is unavailable or still starting (the error recorded for fact F4), it retries for up to about 2 s. Then it prints an error and waits for input. It never starts a shell unless hc answered without the label.

The label is the only record of suspension; there is no marker file. A normal terminal pays only about 15 ms.

**Blocked by:** 01 (fact F4)

**Status:** ready-for-agent

- [ ] sh tests with a fake hc on PATH: label present starts the stand-in with the expected arguments
- [ ] Label absent starts `$SHELL` with the launcher's arguments
- [ ] `$SHELL` unset falls back to `/bin/sh`
- [ ] An unavailable or starting core is retried, and a later answer is used
- [ ] When hc never answers, the launcher prints an error and waits, and never starts a shell
- [ ] The script uses only POSIX sh and tools present on a stock macOS and Linux system
