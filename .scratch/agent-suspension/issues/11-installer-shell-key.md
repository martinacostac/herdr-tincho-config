# 11: Installer points hc's shell at the launcher

**What to build:** The installer points herdr-core's `shell` setting at the installed herdr-shell, so that every new terminal starts through it, without taking over the user's core settings.

- It changes only the `shell` key of herdr-core's config file and keeps every other key.
- A missing config file is created with only that key.
- An identical existing value is left alone.
- A different existing value is reported as a conflict and kept. `--force` replaces it and keeps the original file as `.orig`, like the existing `--force` behavior.
- When Bun was missing and the stand-in was skipped, the `shell` key is left unchanged.

**Blocked by:** 10 (same installer and installer tests)

**Status:** ready-for-agent

- [ ] Installer tests with disposable homes cover a missing config file
- [ ] An existing config with other keys keeps them unchanged
- [ ] An identical `shell` value causes no change
- [ ] A conflicting value is reported and kept without `--force`
- [ ] `--force` replaces the value and keeps a `.orig` copy of the original file
- [ ] The skip path (no Bun) leaves the `shell` key unchanged
- [ ] The existing installer tests still pass
