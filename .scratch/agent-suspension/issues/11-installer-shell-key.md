# 11: Installer points hc's shell at the launcher

**What to build:** The installer points herdr-core's `shell` setting at the installed herdr-shell, so that every new terminal starts through it, without taking over the user's core settings.

- It changes only the `shell` key of herdr-core's config file and keeps every other key.
- A missing config file is created with only that key.
- An identical existing value is left alone.
- A different existing value is reported as a conflict and kept. `--force` replaces it and keeps the original file as `.orig`, like the existing `--force` behavior.
- When Bun was missing and the stand-in was skipped, the `shell` key is left unchanged.

**Blocked by:** 10 (same installer and installer tests)

**Status:** done

- [x] Installer tests with disposable homes cover a missing config file
- [x] An existing config with other keys keeps them unchanged
- [x] An identical `shell` value causes no change
- [x] A conflicting value is reported and kept without `--force`
- [x] `--force` replaces the value and keeps a `.orig` copy of the original file
- [x] The skip path (no Bun) leaves the `shell` key unchanged
- [x] The existing installer tests still pass

## Comments

Done in da37612 (implementation) and e501a29 (review fixes).

- `install.sh`: `install_shell_key` runs at the end of `install_suspend`, so it is skipped without Bun or stand-in sources. It writes `shell = ["<absolute bin>/herdr-shell"]` to `$XDG_CONFIG_HOME/herdr-core/config.toml` (else `~/.config/...`). The hc binary reads `XDG_CONFIG_HOME` for its config, and ticket 01's disposable core used it. It changes only the top-level `shell` key, or adds the key after the last top-level key. An identical value (any spacing, a trailing comma, a literal string) is not written, so `--watch` does not rewrite it. A different value is reported and kept; `--force` replaces it and copies the file to `config.toml.orig`. A file with a multi-line string or a line it cannot read is reported and never edited, even with `--force`. It also leaves the key unchanged when `herdr-standin` is not installed (a first build failed). A linked config is written through the link.
- `tests/install.test.sh`: 7 new cases with disposable homes (missing file, other keys and the mode kept, identical value, conflict and `--force`, no Bun, `XDG_CONFIG_HOME`, unreadable files and quoted keys), plus a check that `--watch` does not rewrite the file (same inode).
- Not verified: busybox awk (only macOS awk was run).
