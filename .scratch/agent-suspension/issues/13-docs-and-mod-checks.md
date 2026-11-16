# 13: Docs and mod checks

**What to build:** Users know what suspension does, how to configure it, and its limits.

- A README section covers: the `tincho.suspend` settings and defaults, how to turn automatic suspension off, the unused agent rules, what wakes an agent, the sidebar display, the Suspend now and Never suspend items, Claude launch options in recovery, the installer behavior (Bun builds, the `shell` key, conflicts and `--force`), the outcome of fact F1, and the known limits from the spec.
- The CHANGELOG gets an entry for the feature.
- `herdr-app check` passes for each changed mod (tab-tree and tab-menu).

**Blocked by:** 03, 08, 09, 11, 12

**Status:** ready-for-agent

- [ ] The README section covers every item in the list above and uses the glossary's terms
- [ ] The known limits match the spec, adjusted for the recorded facts
- [ ] The CHANGELOG has an entry under Unreleased
- [ ] `herdr-app check` passes for tab-tree and tab-menu
