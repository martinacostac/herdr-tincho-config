# 05: A Claude Code plugin that writes the resume report

Status: ready-for-agent
Type: task
Blocked by: 01, 02

**What to build:**
- `claude/herdr-resume/`: a Claude Code plugin with `SessionStart` and `Stop` hooks (ticket 01, H4) that run `herdr-agent-report claude`.
- `suspend/report.ts`: the reporter, built with bun like the stand-in. It:
  - reads the hook's stdin,
  - stops unless `HC_TERMINAL_ID` is set and the session is interactive: the parent's argv has no `-p`/`--print` (H5),
  - finds the Claude process and its argv (H3),
  - applies the Claude allowlist (moved from `recipes.js` with its tests),
  - writes `claude <options> --resume <session_id>`, with cwd from stdin and proof = `transcript_path`,
  - writes an empty report while the transcript is missing (H4).
- It always exits 0, quickly (H7). A failed `hc label` never blocks Claude.

**Done when:** reporter tests cover each `source`, `-p` (no write), options kept and dropped, and a missing transcript. A manual run in an hc terminal shows the label change at once on `/clear`.
