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

**Status:** ready-for-agent

- [ ] The script runs only against a disposable core and cleans it up on exit
- [ ] Both fake agents receive the sent message as their first prompt after waking
- [ ] Address, labels and parent are unchanged after suspension and wake
- [ ] No received text ran as a shell command
- [ ] A send during the switch is refused as unavailable
- [ ] The measured stand-in footprint is 10 MB or less
- [ ] The automatic test run does not pick up the script
