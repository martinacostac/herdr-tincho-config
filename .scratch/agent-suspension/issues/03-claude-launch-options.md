# 03: Claude launch options

**What to build:** Claude agents keep their launch options, so that recovery and waking start them with the same model, permissions and tools as before. An allow-list parser, modeled on Pi's launch options parser, reads Claude's foreground argv (in the shapes recorded for fact F2). It keeps only known reusable options, with canonical names. It drops prompts, credentials, system prompts and session selectors. An unknown option stops capture instead of guessing its arity, and `--` stops capture.

The tab-tree session poller writes the result to a new label `herdr.claude-options`, alongside `herdr.claude-session`. Its value is a versioned record, validated like Pi's record (version, printable strings). A malformed value is ignored, and the agent then starts without options. The Claude recipe in the shared recipe module adds the options, so that both recovery and the stand-in use them without changes of their own.

Documentation is done in ticket 13.

**Blocked by:** 01 (fact F2), 02 (shared recipe module)

**Status:** ready-for-agent

- [ ] The parser keeps only allow-listed options with canonical names, using the argv shapes recorded for F2
- [ ] Tests show that prompts, credentials, system prompts and session selectors are dropped
- [ ] Tests show that capture stops at an unknown option and at `--`, and that control characters are rejected
- [ ] The session poller writes `herdr.claude-options` together with the session label, only for the Claude process that it read
- [ ] A malformed or future-version options value is ignored, and the recipe then has no options
- [ ] The Claude recipe includes the options for recovery, and the typed recovery line for a Claude agent without options is unchanged
- [ ] The existing resume, recovery-lifecycle and claude-polling tests still pass
