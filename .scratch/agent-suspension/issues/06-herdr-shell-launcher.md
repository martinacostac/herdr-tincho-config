# 06: herdr-shell launcher

**What to build:** herdr-shell, a POSIX sh script of a few lines that becomes hc's configured `shell`, so that every new terminal starts through it. It reads its own terminal (from `HC_TERMINAL_ID`) with `hc get` as JSON.

- When the `herdr.suspended` label is present, it replaces itself with the stand-in installed next to it, with the arguments the stand-in expects (agent, address, name).
- When hc answered and the label is absent, it replaces itself with `$SHELL` and passes its own arguments on. When `$SHELL` is unset, it uses `/bin/sh`.
- When hc is unavailable or still starting (the error recorded for fact F4), it retries for up to about 2 s. Then it prints an error and waits for input. It never starts a shell unless hc answered without the label.

The label is the only record of suspension; there is no marker file. A normal terminal pays only about 15 ms.

**Blocked by:** 01 (fact F4)

**Status:** done

- [x] sh tests with a fake hc on PATH: label present starts the stand-in with the expected arguments
- [x] Label absent starts `$SHELL` with the launcher's arguments
- [x] `$SHELL` unset falls back to `/bin/sh`
- [x] An unavailable or starting core is retried, and a later answer is used
- [x] When hc never answers, the launcher prints an error and waits, and never starts a shell
- [x] The script uses only POSIX sh and tools present on a stock macOS and Linux system

## Comments

Done in 39be4c7 (launcher and tests) and d616236 (review fixes).

- `suspend/herdr-shell` (POSIX sh): `hc get "$HC_TERMINAL_ID" --json`. If the label `herdr.suspended` is present, it replaces itself with `herdr-standin <agent> <address> <name>`, found next to the launcher's own path. The agent comes from the label record, and the name is empty for an unnamed terminal. If hc answered without the label, it replaces itself with `${SHELL:-/bin/sh}` and passes its arguments on. Exit code 5 / kind `unavailable` is retried 10 times, 0.2 s apart. Any other failure prints an error and waits for Enter, then tries again. It never exits, because a normal exit would finish a kept terminal. Failures include: another hc error, an answer that cannot be read, a missing stand-in, an unset `HC_TERMINAL_ID`, and an unusable `$SHELL`. A normal terminal skips the awk parser, and its check takes about 10–20 ms.
- `tests/herdr-shell.test.sh`: a fake hc on PATH, a fake stand-in and a fake `$SHELL`, in disposable folders. It runs under macOS /bin/sh (bash 3.2) and dash. It also passed in Alpine (busybox sh and awk) and Debian (dash and mawk) containers.
- Note: bash running as sh (macOS /bin/sh) sets `SHELL` to the login shell itself when it is unset, so the `/bin/sh` fallback can only happen, and is only tested, under other shells. The test prints a skip line for bash.
- For tickets 10 and 11: configure `shell` with the absolute path of the installed `herdr-shell`. A symlink is not resolved, so the stand-in must sit next to the path that hc runs.
