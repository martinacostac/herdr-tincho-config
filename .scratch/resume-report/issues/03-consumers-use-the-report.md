# 03: Recovery, suspension and the stand-in read only the report

Status: ready-for-agent
Type: task
Blocked by: 02

**What to build:**
- ↻ recovery types `resumeLine(reportOf(labels))`. Without a report, it uses the picker fallback (spec Q1).
- `RESUMABLE` in `suspend-policy.js` becomes one rule: `reportOf(labels)` is present (fast rule) and `proofHeld` (slow rule). The reasons stay "not-resumable" or the missing proof.
- In `standin.ts`, `sessionMissing` and its own `claudeTranscript` go. The wake execs `report.argv` in `report.cwd` after `proofHeld`, and the messages go in as they do today.
- The per-agent session code in `recipes.js` goes: the STARTS and INPUTS session parts, `piRecovery`, `holdsPiSession`, and the Claude allowlist (which moves in ticket 05). A picker-only table may stay for spec Q1.

**Done when:** the existing suspension, stand-in and recovery tests pass after being rewritten against reports, plus new tests: a report written by a plugin wakes with its exact argv, and a missing proof refuses with the reason. The stand-in is rebuilt.
