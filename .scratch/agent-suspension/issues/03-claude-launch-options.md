# 03: Claude launch options

**What to build:** Claude agents keep their launch options, so that recovery and waking start them with the same model, permissions and tools as before. An allow-list parser, modeled on Pi's launch options parser, reads Claude's foreground argv (in the shapes recorded for fact F2). It keeps only known reusable options, with canonical names. It drops prompts, credentials, system prompts and session selectors. An unknown option stops capture instead of guessing its arity, and `--` stops capture.

The tab-tree session poller writes the result to a new label `herdr.claude-options`, alongside `herdr.claude-session`. Its value is a versioned record, validated like Pi's record (version, printable strings). A malformed value is ignored, and the agent then starts without options. The Claude recipe in the shared recipe module adds the options, so that both recovery and the stand-in use them without changes of their own.

Documentation is done in ticket 13.

**Blocked by:** 01 (fact F2), 02 (shared recipe module)

**Status:** done

- [x] The parser keeps only allow-listed options with canonical names, using the argv shapes recorded for F2
- [x] Tests show that prompts, credentials, system prompts and session selectors are dropped
- [x] Tests show that capture stops at an unknown option and at `--`, and that control characters are rejected
- [x] The session poller writes `herdr.claude-options` together with the session label, only for the Claude process that it read
- [x] A malformed or future-version options value is ignored, and the recipe then has no options
- [x] The Claude recipe includes the options for recovery, and the typed recovery line for a Claude agent without options is unchanged
- [x] The existing resume, recovery-lifecycle and claude-polling tests still pass

## Comments

Done in 867167e (implementation) and de4a24e (review fixes).

- `recipes.js`: `CLAUDE_OPTIONS` (`herdr.claude-options`), `claudeOptions(words, cwd)` (allow-list parser modeled on Pi's `args.js`), `claudeOptionsLabel` (writes `{"version":1,"options":[…]}`, or null for no options), and `claudeOptionsRecord` (reads it back; only a record the parser itself would write is accepted). The Claude recipe puts the options before `--resume`, so a resumed Claude shows them again where the poller reads them. Without options the typed line is unchanged (`claude --resume 'id'`).
- Lists (`--add-dir`, `--allowed-tools`, `--disallowed-tools`, `--tools`) are kept only when an option or `--` follows them. A list at the end is dropped, because Claude takes a trailing prompt into it. `--mcp-config`, `--file` and `--betas` are dropped with their values. Options with an optional value stop capture. Relative folders are resolved against `foreground.cwd`. A kept option that needs a dropped one goes too (`--strict-mcp-config` with `--mcp-config`, `--agent` with `--agents`, `--bare` with `--settings`).
- The poller (`claudeLaunch`, `rememberClaudeLaunch`) writes the options in the same `hc label` call as the session, from the argv of the process whose session file it read. No options means the label is removed.
- Known limit: a bare word in the middle of a list (`--add-dir /x "text" --model m`) is kept as a folder, as Claude itself reads it.
- Tests: `tests/claude-options.test.mjs` (new), plus `recipes`, `resume` and `claude-polling` tests. The full `node --test tests/*.test.mjs` suite passes (205), and so does `sh tests/install.test.sh`.
