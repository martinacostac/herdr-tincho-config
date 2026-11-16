#!/bin/sh
# By-hand integration check of agent suspension (GLOSSARY.md: Suspend, Wake,
# Stand-in). Not part of the automatic test run (that runs tests/*.test.*).
#
#   sh tests/suspend.integration.sh            (from a normal terminal)
#   HSI_KEEP=1 sh tests/suspend.integration.sh (keep the scratch folder)
#
# It never touches the real hc core or a real agent. It starts a disposable
# core (its own session, socket, state folder and core config, with a freshly
# built stand-in and herdr-shell as the core's `shell`), and two fake agents:
#   - "pi", started by `hc run` (root=agent), and
#   - "claude", typed into fish in a terminal that hc started with its shell
#     (root=shell).
# The policy runs inside the Herdr mod, so this script repeats its suspension
# steps with hc commands: re-check, keep, re-check status and turn, set the
# suspension record, signal the main program. Then it sends a message with
# plain `hc send` and checks that the message is the woken agent's first
# prompt, that the address, name, labels and parent did not change, that
# nothing ran in a shell, that a send during the switch was refused as
# unavailable, and that the stand-in's footprint is 10 MB or less. The fake
# agents are found only through the PATH that the core gives its shells, so a
# wake also checks that PATH. Everything is removed on exit.
#
# Needs bun (to build the stand-in), node, fish and hc. A core started inside
# an agent sandbox cannot start programs: run it from a normal terminal, or
# through a throwaway terminal (hc run --rm --no-notify -- sh <this file>).
set -eu

project=$(cd "$(dirname "$0")/.." && pwd)
for tool in hc node bun fish; do
  command -v "$tool" > /dev/null 2>&1 || { echo "suspend.integration: $tool is not on PATH" >&2; exit 1; }
done
HC=$(command -v hc)
NODE=$(command -v node)
FISH=$(command -v fish)

# A short, physical path: the core's socket lives under it (socket paths are
# limited to about 100 bytes), and hc reports physical folders (/private/tmp).
work=$(cd "$(mktemp -d /tmp/hsi.XXXXXX)" && pwd -P)

# From here on every hc command reaches the disposable core only: hc finds its
# core from HC_SESSION, HC_SOCKET and the XDG folders (plans/agent-suspension.md, F4).
unset HC_TERMINAL_SOCKET HC_TERMINAL_ID HC_SOCKET HC_SCOPE
export HC_SESSION="hsi$$"
export XDG_STATE_HOME="$work/state" XDG_CONFIG_HOME="$work/config" XDG_RUNTIME_DIR="$work/run"
export XDG_DATA_HOME="$work/data" XDG_CACHE_HOME="$work/cache"
mkdir -p "$XDG_STATE_HOME" "$XDG_CONFIG_HOME/herdr-core" "$XDG_RUNTIME_DIR" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
chmod 700 "$XDG_RUNTIME_DIR"

core_started=
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ -n "$core_started" ]; then
    for t in $(cat "$work/terminals" 2> /dev/null); do
      hc keep "$t" --off > /dev/null 2>&1 || :
      hc kill "$t" > /dev/null 2>&1 || :
    done
    sleep 0.5
    for t in $(cat "$work/terminals" 2> /dev/null); do hc rm "$t" > /dev/null 2>&1 || :; done
    hc server stop > /dev/null 2>&1 || :
  fi
  # Any process left with the scratch folder in its command line is ours.
  ps -axo pid=,command= 2> /dev/null | awk -v w="$work" 'index($0, w) { print $1 }' | while read -r pid; do
    kill -KILL "$pid" 2> /dev/null || :
  done
  if [ -n "${HSI_KEEP:-}" ]; then echo "kept $work"; else rm -rf "$work"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

failures=0
ok() { echo "ok   $*"; }
not_ok() { echo "FAIL $*"; failures=$((failures + 1)); }
die() { echo "FAIL $*" >&2; exit 1; }
check() { # check <description> <command...>: a check that does not stop the run
  description=$1; shift
  if "$@"; then ok "$description"; else not_ok "$description"; fi
}

# json <expression> [args...]: evaluates a JS expression of t (the JSON on
# stdin) and a (the args). Strings print bare, other values as JSON.
json() {
  "$NODE" -e '
    const t = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const [expression, ...a] = process.argv.slice(1);
    const v = new Function("t", "a", `return (${expression});`)(t, a);
    process.stdout.write(v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));
  ' "$@"
}
get() { hc get "$1" --json; }
field() { get "$1" | json "$2"; }
# The address, name, parent and labels: what other agents and mods depend on.
# skip: a label left out (the suspension record while suspended).
identity() {
  get "$1" | json '({ address: t.address, name: t.name, parent: t.parent,
    labels: Object.fromEntries(Object.entries(t.labels).filter(([k]) => k !== a[0]).sort()) })' "${2:-}"
}
# wait_until <seconds> <what> <shell code>: runs the code every 0.1 s until it succeeds.
wait_until() {
  limit=$(($1 * 10)); what=$2; code=$3; n=0
  until eval "$code"; do
    n=$((n + 1)); [ "$n" -lt "$limit" ] || die "timed out waiting for $what"
    sleep 0.1
  done
}
reports() { # reports <terminal> <app> <state>
  [ "$(field "$1" '`${t.status?.app}:${t.status?.state}`')" = "$2:$3" ]
}
footprint_kb() {
  if [ -r "/proc/$1/status" ]; then awk '/^VmRSS:/ { print $2; exit }' "/proc/$1/status"
  else footprint -f bytes --noCategories "$1" 2> /dev/null | awk '/phys_footprint:/ { print int($2 / 1024); exit }'
  fi
}

echo "scratch folder: $work (core session $HC_SESSION)"

# The stand-in and herdr-shell, installed side by side as install.sh does.
suspend_bin="$work/suspend"
mkdir -p "$suspend_bin"
sh "$project/suspend/build.sh" "$suspend_bin/herdr-standin" > "$work/build.log" 2>&1 || { cat "$work/build.log" >&2; die "stand-in build"; }
cp "$project/suspend/herdr-shell" "$suspend_bin/herdr-shell"
chmod +x "$suspend_bin/herdr-shell"
printf 'shell = ["%s"]\n' "$suspend_bin/herdr-shell" > "$XDG_CONFIG_HOME/herdr-core/config.toml"

# The fake agents. Each start records its program path, folder and words
# (NUL-separated) under runs/<address>/<n>, reports idle like a real agent
# (OSC 7501, plans/agent-suspension.md F5), and records every line it reads.
bin="$work/bin"
runs="$work/runs"
mkdir -p "$bin" "$runs"
cat > "$bin/pi" <<EOF
#!/bin/sh
dir="$runs/\${HC_TERMINAL_ID:-unknown}"
mkdir -p "\$dir"
n=1; while [ -e "\$dir/\$n" ]; do n=\$((n + 1)); done
run="\$dir/\$n"; mkdir "\$run"
printf '%s' "\$0" > "\$run/exe"
pwd -P > "\$run/cwd"
printf '%s\0' "\$@" > "\$run/argv"
: > "\$run/stdin"
printf '\033]7501;state=idle:app=%s\033\\\\' "\${0##*/}"
printf 'fake %s, start %s\n' "\${0##*/}" "\$n"
while IFS= read -r line; do printf '%s\n' "\$line" >> "\$run/stdin"; done
EOF
cp "$bin/pi" "$bin/claude"
chmod +x "$bin/pi" "$bin/claude"
ln -s "$HC" "$bin/hc"
# Only the fake agents, hc and the system folders: a real pi or claude cannot
# be found, by hc run, by the core's shells or by a wake.
export PATH="$bin:/usr/bin:/bin:/usr/sbin:/sbin"
export SHELL="$FISH"

core_started=1
hc server start > /dev/null || die "the disposable core did not start"
[ -S "$XDG_RUNTIME_DIR/herdr-core/$HC_SESSION.sock" ] || die "the disposable core has no socket under $XDG_RUNTIME_DIR"
ok "disposable core started ($(hc server status --json | json '`pid ${t.pid}, id ${t.core.id.slice(0, 8)}`'))"

# start <hc run words...>: starts a terminal and prints its address.
start() {
  address=$(hc run --bg "$@" | json 't.address')
  [ -n "$address" ] || die "hc run $*"
  echo "$address" >> "$work/terminals"
  echo "$address"
}

parent=$(start --name hsi-parent --no-parent -- sleep 3600)

# The hc run agent: Pi with its recovery record and a real-looking session.
wd_run="$work/wd-run"
mkdir -p "$wd_run" "$work/sessions"
pi_session=019a8c3e-5b7d-7f21-9e44-2c1d0a6b8f13
pi_file="$work/sessions/2026-11-16T05-00-00-000Z_$pi_session.jsonl"
printf '{"type":"session","version":3,"id":"%s","timestamp":"2026-11-16T05:00:00.000Z","cwd":"%s"}\n' "$pi_session" "$wd_run" > "$pi_file"
printf '{"type":"message","id":"a1","parentId":null,"timestamp":"2026-11-16T05:00:01.000Z","message":{"role":"user","content":[{"type":"text","text":"Reply pong"}]}}\n' >> "$pi_file"
pi_recovery=$(printf '{"version":1,"sessionId":"%s","sessionFile":"%s","cwd":"%s","args":["--model","fake-model"]}' "$pi_session" "$pi_file" "$wd_run")
run_agent=$(start --name hsi-run --parent "$parent" --cwd "$wd_run" \
  --label herdr.last-agent=pi --label "herdr.pi-recovery=$pi_recovery" -- pi --model fake-model)
wait_until 10 "the hc run agent to report idle" 'reports "$run_agent" pi idle'

# The fish-hosted agent: Claude with its session and launch options, typed
# into the shell that hc started (herdr-shell, no label, so fish).
wd_fish="$work/wd-fish"
mkdir -p "$wd_fish"
claude_session=4f0c2a9e-7d1b-4c8e-a3f5-6b2e9d0c1a7f
fish_agent=$(start --name hsi-fish --parent "$parent" --cwd "$wd_fish" \
  --label herdr.last-agent=claude --label "herdr.claude-session=$claude_session" \
  --label 'herdr.claude-options={"version":1,"options":["--model","haiku"]}')
wait_until 10 "fish in the shell terminal" '[ "$(field "$fish_agent" "t.foreground?.name")" = fish ]'
check "herdr-shell started \$SHELL in a terminal without the label" [ "$(field "$fish_agent" 't.argv?.[0]')" = "$suspend_bin/herdr-shell" ]
# The full path, so even a fish that rebuilt its PATH cannot start a real claude.
hc send "$fish_agent" "$bin/claude --model haiku" > /dev/null || die "typing the fake claude into fish"
wait_until 15 "the fish-hosted agent to report idle" 'reports "$fish_agent" claude idle'

# suspend <terminal> <agent> <expected root>: the policy's steps, in order.
# Sets standin_pid.
suspend() {
  t=$1; agent=$2; expected_root=$3
  # 1. Read the terminal again: a live, idle, resumable agent.
  before=$(get "$t")
  [ "$(printf '%s' "$before" | json '`${t.state}:${t.status?.state}`')" = live:idle ] || die "$t is not a live idle agent"
  pid=$(printf '%s' "$before" | json 't.pid')
  agent_pid=$(printf '%s' "$before" | json 't.foreground?.pid')
  found_root=$(printf '%s' "$before" | json 't.pid === t.foreground?.pid ? "agent" : "shell"')
  check "$t: the main program is the $expected_root (root=$found_root)" [ "$found_root" = "$expected_root" ]
  # 2. Keep the terminal, so the signal leaves it live.
  hc keep "$t" > /dev/null || die "hc keep $t"
  # 3. Status and turn did not change.
  after=$(get "$t")
  same='`${t.status?.state}:${t.turn}:${t.pid}:${t.foreground?.pid}`'
  [ "$(printf '%s' "$before" | json "$same")" = "$(printf '%s' "$after" | json "$same")" ] || die "$t changed during the steps"
  # 4. The suspension record.
  record=$(printf '%s' "$before" | json 'JSON.stringify({ version: 1, agent: a[0], root: a[1], cwd: t.foreground.cwd, since: Date.now() })' "$agent" "$found_root")
  hc label "$t" "herdr.suspended=$record" > /dev/null || die "hc label $t"
  # 5. End the main program. hc starts herdr-shell, which starts the stand-in.
  kill -TERM "$pid"
  # While hc switches programs (no pid), a plain send is refused.
  wait_until 5 "hc to see $t's program end" '[ "$(field "$t" "t.pid ?? 0")" != "$pid" ]'
  probe_rc=0
  probe=$(hc send "$t" "switch probe; touch $work/ran-probe-$t" --json 2>&1) || probe_rc=$?
  check "$t: a send during the switch is refused as unavailable (exit $probe_rc)" \
    [ "$probe_rc" -eq 5 -a "$(printf '%s' "$probe" | json 't.error?.kind')" = unavailable ]
  wait_until 10 "$t's stand-in to report idle" 'reports "$t" herdr-standin idle'
  standin_pid=$(field "$t" 't.pid')
  # From ps: hc can show the program that herdr-shell replaced for a while.
  main=$(ps -o command= -p "$standin_pid" 2> /dev/null || :)
  check "$t: the stand-in is the main program ($main)" [ "$main" = "$suspend_bin/herdr-standin $agent $t $(field "$t" t.name)" ]
  check "$t: the agent process ended" sh -c "! kill -0 $agent_pid 2> /dev/null"
  kb=$(footprint_kb "$standin_pid")
  check "$t: the stand-in's footprint is 10 MB or less (${kb:-unknown} KB)" [ -n "$kb" -a "${kb:-0}" -le 10240 ]
}

# wake <terminal> <agent> <message>: a plain send, then waits for the agent's second start.
wake() {
  t=$1; agent=$2
  hc send "$t" "$3" > /dev/null || die "hc send $t"
  wait_until 15 "$t's agent to start again" '[ -e "$runs/$t/2/argv" ]'
  wait_until 10 "$t's woken agent to report idle" 'reports "$t" "$agent" idle'
}

# words <file> <expected words...>: the NUL-separated words of a start.
words() {
  file=$1; shift
  printf '%s\0' "$@" > "$file.expected"
  cmp -s "$file" "$file.expected"
}
show_words() { tr '\0' ' ' < "$1"; }

for case in "$run_agent pi agent" "$fish_agent claude shell"; do
  set -- $case
  t=$1; agent=$2; root=$3
  echo "--- $t: $agent, root=$root"
  identity_before=$(identity "$t")
  recorded_cwd=$(field "$t" 't.foreground.cwd')
  suspend "$t" "$agent" "$root"
  check "$t: address, name, labels and parent unchanged while suspended" [ "$(identity "$t" herdr.suspended)" = "$identity_before" ]

  message="first prompt for $agent; touch $work/ran-$t \$(touch $work/ran-sub-$t)"
  wake "$t" "$agent" "$message"
  run="$runs/$t/2"
  if [ "$agent" = pi ]; then
    check "$t: woken with its session, options and the message as first prompt ($(show_words "$run/argv"))" \
      words "$run/argv" --session "$pi_file" --model fake-model -- "$message"
  else
    check "$t: woken with its options, session and the message as first prompt ($(show_words "$run/argv"))" \
      words "$run/argv" --model haiku --resume "$claude_session" -- "$message"
  fi
  check "$t: the wake found the fake $agent through the core's PATH ($(cat "$run/exe"))" [ "$(cat "$run/exe")" = "$bin/$agent" ]
  check "$t: the woken agent runs in the recorded folder" [ "$(cat "$run/cwd")" = "$recorded_cwd" ]
  check "$t: woken in place (same main program pid as the stand-in)" [ "$(field "$t" 't.pid')" = "$standin_pid" ]
  check "$t: address, name, labels and parent unchanged after the wake" [ "$(identity "$t")" = "$identity_before" ]
  check "$t: the message was not typed into the woken agent again" [ ! -s "$run/stdin" ]
  check "$t: one start before the suspension and one wake" [ ! -e "$runs/$t/3" ]
  check "$t: no received text ran as a shell command" \
    sh -c "! ls '$work'/ran-* > /dev/null 2>&1"
done

echo "---"
if [ "$failures" -eq 0 ]; then echo "all checks passed"; else echo "$failures check(s) failed"; exit 1; fi
