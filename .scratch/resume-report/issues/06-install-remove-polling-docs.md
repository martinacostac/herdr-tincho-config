# 06: Install the Claude plugin, remove the polling, update the docs

Status: ready-for-agent
Type: task
Blocked by: 03, 04, 05

**What to build:**
- `install.sh` builds and installs `herdr-agent-report`, and installs the Claude plugin the way H6 found works without prompts. Both are covered in `tests/install.test.sh`.
- The Claude polling in `tab-tree` goes: `rememberSessions`, its 10 s timer, `claudeLaunch` and `rememberClaudeLaunch`.
- README: a "Resume report" section replaces the per-agent recovery and launch-option sections. GLOSSARY: add **Resume report**, and redefine **Resumable agent** as "has a resume report whose proof is on disk". CHANGELOG entry.
- `sh tests/suspend.integration.sh` passes with a real Pi and a real Claude.
