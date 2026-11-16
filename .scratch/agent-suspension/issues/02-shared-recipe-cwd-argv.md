# 02: Shared recipe module returns a working folder and a command word list

**What to build:** A preparatory refactoring of the shared recipe module, so that recovery and the stand-in start agents the same way. Each recipe returns a working folder and a command word list (`cwd` and `argv`) instead of a shell line. The recipe input comes from the terminal's labels, so that a later label (such as Claude's launch options) needs no change in the callers. Recovery turns the result into exactly the same shell line that it types today, through the existing quoting. Recovery behaves exactly as before.

The module also gains:

- The `herdr.suspended` label name and a parser for its versioned record (version 1, agent `claude` or `pi`, root `shell` or `agent`, absolute `cwd`, `since` in milliseconds). Malformed, future-version and control-containing records are rejected.
- The check that a Pi session file still holds the recorded session (the header id matches), as a pure helper over the file's first line. Recovery uses it instead of its own copy, and the stand-in (ticket 05) uses it later.

The module keeps the existing label names and the Pi record parser. It must stay importable without the Herdr host, because the stand-in imports it at build time.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Each recipe returns a working folder and a command word list for every agent and session case (Claude: session id, tab name, picker; Pi: session file, session id only, picker, no record)
- [x] The existing resume and recovery-lifecycle tests pass unchanged: recovery types exactly the same lines as before
- [x] New tests cover the working folder and command for each case
- [x] The suspension record parser accepts a valid record and rejects malformed, future-version, relative-folder and control-containing records
- [x] The Pi session check is a pure helper with tests, and recovery uses it
- [x] The module imports no Herdr host module

## Comments

Done in fb637d2 and def21ab (review fixes).

- `recipes.js` exports `recipe(agent, labels, { tab, picker })` → `{ cwd, argv }` (null for an agent without a recipe). The input is the terminal's labels, so a new label (ticket 03's `herdr.claude-options`) changes only the module's `INPUTS` table. `cwd` is null when the start does not need a folder of its own (Claude, Pi with a session file). It is the recorded folder for Pi with only a session id and for Pi's picker.
- `recoveryLine(agent, labels, options)` builds recovery's shell line from the same start, through `shellQuote`: the recipe's own words are left bare and every recorded word is quoted, so the lines are exactly the same as before. `RECIPES` keeps its parsed-input, string-returning form (built from the same starts), because the unchanged tests and `main.js` (key check) use it. New callers should use `recipe()`.
- New: `SUSPENDED = "herdr.suspended"`, `suspension(raw)` (version 1, agent with a recipe, root `shell`/`agent`, absolute printable `cwd`, `since` a non-negative safe integer; returns only those fields), and `holdsPiSession(head, sessionId)`, which recovery now uses.
- Tests: new `tests/recipes.test.mjs`, including a test that the module imports nothing. `tests/resume.test.mjs` and `tests/recovery-lifecycle.test.mjs` are unchanged and pass. Full run: 154/154 node tests pass, and the installer tests pass.
- Note for ticket 05: the stand-in has two folders, `recipe().cwd` and the suspension record's `cwd`. It must decide which one wins when both are set (Pi with only a session id, or the picker). It must also run `holdsPiSession` itself and pass `picker`.
