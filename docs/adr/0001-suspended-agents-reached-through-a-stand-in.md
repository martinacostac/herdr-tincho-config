# Suspended agents are reached through a stand-in started by hc's `shell` setting

To free memory, a suspended agent's process ends, but its terminal stays live, so other agents can still `hc send` to its address. herdr-core has no hooks: `terminal.send` only pastes text and presses Enter, `events.subscribe` reports no input, and its config has no command keys. The only thing that sees a message is the program in the target terminal. So a suspended terminal runs a small **stand-in** (a Bun AOT binary, about 6.6 MB) that reads the pasted message, never runs it, and replaces itself with the agent's resume command, passing the message as the first prompt.

To get the stand-in in place without a moment where a shell could run a message, suspension kills the terminal's main program by signal on a kept terminal. hc then starts its configured `shell`, which we set to `herdr-shell`, a `/bin/sh` script. It reads the `herdr.suspended` label with `hc get` and starts the stand-in, or replaces itself with `$SHELL` when the label is absent. hc refuses sends with `unavailable` only while the terminal has no program; after that, a send arrives before the stand-in turns on raw mode, and the stand-in reads that input as one message. The label is the only record of suspension, with no marker file. That costs about 15 ms on every new terminal in exchange for a single source of truth.

## Considered options

- **A shell hook** (a fish Enter binding that recognizes `<hc from=…>`): rejected because it only works in one shell, and a missing binding executes the message as a command.
- **Ending the terminal**: rejected because the address disappears, `hc send` fails with `not_found`/`finished`, and nothing can catch that.
- **Freezing (`SIGSTOP`)**: rejected because it frees almost no memory, and a long paste blocks on the terminal's small input buffer.
- **Typing `exec herdr-standin` into the recovery shell**: rejected because it leaves a window of up to seconds in which a message runs as a shell command.
- **An upstream hc feature** (run a command on a send to a labeled terminal): cleaner, but outside our control. Worth requesting. If hc gains it, this ADR should be revisited.

## Consequences

- The installer manages the `shell` key in `~/.config/herdr-core/config.toml`, so every new terminal starts through `herdr-shell`.
- While the core is starting, `herdr-shell` retries `hc get` and never falls back to a plain shell unless hc answered without the label.
- Recovery must recognize stand-ins. A stand-in is the terminal's main program, so the old "back at the shell" check (`foreground.pid === pid`) passes for it.
