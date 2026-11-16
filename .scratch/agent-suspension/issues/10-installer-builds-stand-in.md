# 10: Installer builds and installs the stand-in and launcher

**What to build:** The installer builds the stand-in with Bun and installs it, with herdr-shell, into a bin folder under the project's XDG data folder, which is not on PATH.

- It uses Bun's small ahead-of-time compile (trimmed locales, no function source) when available.
- Otherwise it falls back to Bun's standard compile with minify.
- Without Bun it prints `suspend: skipped (no bun)`, and the rest of the install still succeeds.
- The built binaries are recorded in the install manifest by the hash of their sources (the stand-in sources and the shared recipe module), not by the hash of the output. A rebuild happens only when the sources change, so a second run with no changes rebuilds nothing and leaves the manifest unchanged.

Managing hc's `shell` key is ticket 11.

**Blocked by:** 05 (stand-in), 06 (herdr-shell launcher)

**Status:** ready-for-agent

- [ ] Installer tests with fake bun commands on PATH cover the ahead-of-time path, the standard-compile fallback and the skip path
- [ ] The stand-in and launcher land in the XDG data bin folder, executable, and nothing is added to PATH
- [ ] Manifest entries are keyed by source hash
- [ ] An unchanged second run does not rebuild and leaves the manifest unchanged; a source change triggers a rebuild
- [ ] All installs in tests use disposable homes, and the existing installer tests still pass
