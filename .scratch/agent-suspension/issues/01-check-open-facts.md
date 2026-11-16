# 01: Check open facts F1–F5 on a disposable core

**What to build:** Answers to the five open facts in the spec, checked on a throwaway hc core with its own socket and state folder, so that no live agent, real session or the real core is touched. The answers go into the agent-suspension plan's "Open facts" section, with the evidence for each one, in the same style as the existing "Verified facts" table. When a result contradicts the spec, the result says so clearly and names the spec decision that must change, so that the parent can revise the design before building continues. This ticket changes no code.

The facts:

- **F1**: Do kept terminals keep their address and labels after `hc server stop` and the next core start?
- **F2**: What does Claude's foreground argv show (Pi hides its own)? Does resuming Claude with a session id, then `--`, then a message, submit that message interactively as the first prompt? Record the observed argv shapes, because the Claude launch options allow-list (ticket 03) is built from them.
- **F3**: When fish is the terminal's main program and receives `SIGTERM`, does hc treat that as a loss (the kept terminal starts its configured shell) or as a normal exit (the terminal finishes)? If it is a normal exit, confirm that `SIGKILL` gives a loss. Also check that the agent inside exits cleanly on SIGHUP with its session saved.
- **F4**: Which error kind and text does `hc get` return while the core is still starting, and when it is unavailable?
- **F5**: The exact OSC 7501 report syntax. Confirm `idle`, `working` and `blocked` reports from a probe program. Confirm that `hc send --if idle`, `hc wait` and `hc send --wait` treat a program that reports `idle` like an idle agent.

**Blocked by:** None (can start immediately)

Status: done

- [x] Each of F1–F5 has a recorded answer and the evidence (commands run and what they returned) in the plan
- [x] Every check ran against a disposable core; no live terminal or real session was touched
- [x] F2 records the Claude argv shapes seen and whether the first prompt after `--` is submitted
- [x] F3 records which signal gives a loss for a shell main program, and whether the hosted agent saved its session
- [x] F4 records the error kind and text to retry on
- [x] F5 records the report syntax for each state and how the three coordination commands treated the probe
- [x] Any contradiction with the spec is listed with the decision it affects

## Comments

The answers and the evidence are in the plan, in "Open facts: answers" (commit 3ebef3e). All checks ran on a disposable core (`HC_SESSION=f1`, XDG paths under `/tmp/hcf`). That includes F3 and F5. The real core only hosted throwaway `--rm` runner terminals, and its pid and uptime did not change.

- F1: kept terminals keep their address and labels through stop and start.
- F2: Claude's argv is fully visible, prompt included. `--resume <id> -- msg` submits the message, also when it starts with `-` or has several lines. The variadic `--add-dir` and the other variadic options swallow a trailing prompt (a note for ticket 03).
- F3: SIGTERM to fish is a loss. Claude and Pi exit cleanly with their sessions saved.
- F4: `hc get` waits for a starting core and starts a stopped one. Retry only on exit 5 / `unavailable`.
- F5: the syntax is `ESC]7501;state=…[:app=…][:kind=…][:msg=<b64>]ESC\`. An `idle` probe works with `send --if idle`, `wait` and `send --wait`.

No contradiction with the spec. Not verified: whether a first-run Claude dialog shown during a wake drops the first prompt.
