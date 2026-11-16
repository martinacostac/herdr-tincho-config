# 10: Installer builds and installs the stand-in and launcher

**What to build:** The installer builds the stand-in with Bun and installs it, with herdr-shell, into a bin folder under the project's XDG data folder, which is not on PATH.

- It uses Bun's small ahead-of-time compile (trimmed locales, no function source) when available.
- Otherwise it falls back to Bun's standard compile with minify.
- Without Bun it prints `suspend: skipped (no bun)`, and the rest of the install still succeeds.
- The built binaries are recorded in the install manifest by the hash of their sources (the stand-in sources and the shared recipe module), not by the hash of the output. A rebuild happens only when the sources change, so a second run with no changes rebuilds nothing and leaves the manifest unchanged.

Managing hc's `shell` key is ticket 11.

**Blocked by:** 05 (stand-in), 06 (herdr-shell launcher)

Status: done

- [x] Installer tests with fake bun commands on PATH cover the ahead-of-time path, the standard-compile fallback and the skip path
- [x] The stand-in and launcher land in the XDG data bin folder, executable, and nothing is added to PATH
- [x] Manifest entries are keyed by source hash
- [x] An unchanged second run does not rebuild and leaves the manifest unchanged; a source change triggers a rebuild
- [x] All installs in tests use disposable homes, and the existing installer tests still pass

## Comments

Done in ba2a2fe. `install.sh` runs `suspend/build.sh` (the one source of truth for the ahead-of-time compile and the standard-compile fallback, which now prints which compile it used). It builds into `${XDG_DATA_HOME:-~/.local/share}/herdr-tincho-config/bin/herdr-standin` and copies `herdr-shell` next to it, both mode 755, with staged writes. Without Bun it prints `suspend: skipped (no bun)`.

- **Manifest:** a separate file, `$XDG_STATE_HOME/herdr-tincho-config/installed-suspend`, following the `installed-pi` precedent. `herdr-standin` is recorded by one hash over the paths and contents of `suspend/*.ts` (not tests), `suspend/build.sh` and the `herdr/` files those sources import (today `recipes.js`). `herdr-shell` is recorded by its own hash.
- **Rebuilds:** a rebuild happens only on a source change or a missing binary. An unchanged run leaves the manifest byte-identical.
- **Failed builds:** a failed build keeps the old binary and its record, is reported on stderr, and is retried on the next run.
- **`--watch`:** it hashes the stand-in sources only while Bun is present, and it never hashes the binary or the manifest, so it does not rebuild in a loop.

Known limits:

- Upgrading Bun to a version that has the ahead-of-time compile does not trigger a rebuild until a source changes.
- `herdr-shell` and `herdr-standin` are program files, so a new version replaces them even when they were edited on this machine.
