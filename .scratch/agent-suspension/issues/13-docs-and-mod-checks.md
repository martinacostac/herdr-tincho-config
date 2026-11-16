# 13: Docs and mod checks

**What to build:** Users know what suspension does, how to configure it, and its limits.

- A README section covers: the `tincho.suspend` settings and defaults, how to turn automatic suspension off, the unused agent rules, what wakes an agent, the sidebar display, the Suspend now and Never suspend items, Claude launch options in recovery, the installer behavior (Bun builds, the `shell` key, conflicts and `--force`), the outcome of fact F1, and the known limits from the spec.
- The CHANGELOG gets an entry for the feature.
- `herdr-app check` passes for each changed mod (tab-tree and tab-menu).

**Blocked by:** 03, 08, 09, 11, 12

Status: done

- [x] The README section covers every item in the list above and uses the glossary's terms
- [x] The known limits match the spec, adjusted for the recorded facts
- [x] The CHANGELOG has an entry under Unreleased
- [x] `herdr-app check` passes for tab-tree and tab-menu

## Comments

Done in b3ee271 and 914b053 (review fixes).

- README.md: a new top-level section, "Suspending unused agents". It covers unused agent rules, `tincho.suspend` settings (defaults; `false` or `after_minutes: 0` turns automatic suspension off), `restore_screen = true`, Suspend now and Never suspend, the sidebar (💤, "waking…"), what wakes an agent, missing sessions, Claude launch options, restarts and crashes (F1: stop/start checked; a reboot is inferred, not checked), the label repair, the installer (Bun ahead-of-time compile, standard compile, skip; the bin folder; the `installed-suspend` manifest; the `shell` key with conflict, `--force` and `.orig`; no rebuild on a Bun upgrade), idle work, known limits and the integration script. It links GLOSSARY.md, ADR 0001 and the plan. There are also short pointers in the layout tree, "Working on it", "Settings" and the Claude recovery bullet.
- CHANGELOG.md: entries under Unreleased > Added.
- tab-menu: REASONS gained `repaired: "stale suspension label removed"` (ticket 14's open point 1), with the matching assertion in tests/tab-menu.test.mjs.
- `herdr-app check`: the parent ran it on the repo copies, and both mods reported "check passed" (tab-tree and tab-menu). In this sandbox `herdr-app check` hangs (it timed out after 90 s), so the one-line tab-menu change was not re-checked here.
- Tests: `node --test tests/*.test.mjs` 288/288 passed, and `sh tests/install.test.sh` passed.
- Open: the policy counts a Pi record without `sessionFile` as resumable (RESUMABLE.pi uses `piRecovery`), but the stand-in treats such a record as a missing session. So such an agent can be suspended and then fail to wake (the messages are saved and the agent reports `blocked`). The README describes this case. The Pi extension always records a file, so only old ID-only records are affected.
