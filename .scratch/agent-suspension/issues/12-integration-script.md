# 12: By-hand integration script

**What to build:** A script, run by hand only, that checks the full suspension flow end to end on a throwaway hc core, without touching live agents. The policy runs inside the Herdr mod and cannot run from a shell script, so the script reproduces the suspension steps directly with hc commands (re-check, keep, re-check status and turn, set the suspension record, signal the main program).

The script:

- Starts a disposable core with its own socket, state folder and core config, with the installed herdr-shell as its `shell`.
- Creates one fake agent started by `hc run` and one fake agent hosted by fish, each reporting its status and recording what it receives as its first prompt.
- Suspends each one and sends a message with plain `hc send`.
- Checks that the message arrives as the first prompt, that the address, labels and parent are unchanged, and that nothing ran in a shell.
- Checks that a send during the switch is refused as unavailable.
- Checks that the stand-in's footprint is 10 MB or less.

It is not part of the automatic test run.

**Blocked by:** 11 (installed stand-in, launcher and shell setting; transitively 01, 05, 06, 10)

**Status:** done

- [x] The script runs only against a disposable core and cleans it up on exit
- [x] Both fake agents receive the sent message as their first prompt after waking
- [x] Address, labels and parent are unchanged after suspension and wake
- [x] No received text ran as a shell command
- [x] A send during the switch is refused as unavailable
- [x] The measured stand-in footprint is 10 MB or less
- [x] The automatic test run does not pick up the script

## Comments

Done in ec550dd (script) and a2e658f (review fixes). File: `tests/suspend.integration.sh`. Run with `sh tests/suspend.integration.sh` from a normal terminal (`HSI_KEEP=1` keeps the scratch folder).

- Disposable core: `HC_SESSION=hsi<pid>`, with XDG folders and HOME under `/tmp/hsi.*`, and `HC_TERMINAL_SOCKET`, `HC_TERMINAL_ID`, `HC_SOCKET` and `HC_SCOPE` unset. The stand-in is built with `suspend/build.sh`, and `suspend/herdr-shell` is copied next to it and set as the core's `shell`. Cleanup stops a core only when the socket under the scratch folder answers with the core id recorded at start. Then it kills leftover programs that run from the scratch folder and removes the folder.
- Fake agents (`pi`, `claude`): each start records its program path, folder and argv, reports `idle` over OSC 7501, and records the lines it reads. PATH holds only the fake agents, `hc` and the system folders, so a wake checks the PATH that the core's shells receive (ticket 05's point).
- Cases: the Pi agent started by `hc run` (root=agent, `herdr.pi-recovery` with a real-looking session file), and the Claude agent typed into fish, where fish was started by herdr-shell in a terminal without the label (root=shell, `herdr.claude-session` and `herdr.claude-options`). Each case also has a child terminal.
- The script repeats the policy steps (re-check, keep, re-check status/turn/pids, label, SIGTERM), then sends a plain `hc send`. Result: 32 checks pass. A probe while hc shows no pid is refused (exit 5, `unavailable`). The stand-in is the main program, and its footprint was about 7.3 to 7.5 MB. The agent process ended. Address, name, labels, parent and child stay unchanged. Wake argv: `--session <file> --model fake-model -- <msg>` and `--model haiku --resume <id> -- <msg>`. The agent starts in the recorded folder, in place (same pid). The message is not retyped, and `; touch` and `$(touch)` in the message never ran.
- The policy's real process listing (`ps -axo pid=,ppid=,command=` and its parser in `suspend-policy.js`) was run once against real ps output (926 lines) with a node one-off. A helper-only tree is unused, a helper plus a background job gives `background`, no children is unused, a missing pid gives `processes-unknown`, and a real Pi agent's `npm exec shadcn@latest mcp` child counted as a helper.
- Not covered (the ticket did not ask for them): batching (story 24), `--if idle`/`hc wait`/`send --wait` (story 25, verified in F5), and hc notes waking a child (story 26).
- Inside an agent sandbox, the disposable core cannot spawn programs. The script then stops at the first `hc run` with `spawn_failed`, and cleans up.
