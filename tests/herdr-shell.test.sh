#!/bin/sh
# Run with: sh tests/herdr-shell.test.sh. It runs suspend/herdr-shell with a
# fake hc on PATH, a fake stand-in next to it and a fake $SHELL, in disposable
# folders. It never talks to a real hc core.
set -eu

project=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/herdr-shell-test.XXXXXX")
bg_pid=
cleanup() {
  if [ -n "$bg_pid" ]; then
    kill "$bg_pid" 2>/dev/null || :
    wait "$bg_pid" 2>/dev/null || :
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

fail() {
  echo "FAIL [$interp] $case_name: $*" >&2
  for f in out ran hc.log; do
    [ -f "$case/$f" ] && { echo "--- $f" >&2; cat "$case/$f" >&2; }
  done
  exit 1
}
assert_ran() {
  # The expected lines of the program that the launcher replaced itself with.
  printf '%s\n' "$@" > "$case/expected"
  [ -f "$case/ran" ] || fail "nothing was started"
  cmp -s "$case/expected" "$case/ran" || fail "started: $(cat "$case/ran"), expected: $*"
}
assert_nothing_ran() { [ ! -e "$case/ran" ] || fail "started: $(cat "$case/ran")"; }
assert_out() { grep -F -- "$1" "$case/out" >/dev/null || fail "missing output: $1"; }
hc_calls() { if [ -f "$case/hc.log" ]; then wc -l < "$case/hc.log" | tr -d ' '; else echo 0; fi; }

# A JSON answer of hc get, shaped like hc 0.1.21 prints it: one line, sorted keys.
# $1 is the labels object, $2 the name value.
terminal_json() {
  printf '{"address":"t7","argv":["fish","-l"],"cols":80,"cwd":"/w","foreground":{"argv":["fish"],"cwd":"/w","name":"fish","pid":11},"keep":true,"labels":%s,"name":%s,"pid":11,"state":"live","status":null,"turn":3}\n' "$1" "$2"
}
suspended_label='"herdr.suspended":"{\"version\":1,\"agent\":\"pi\",\"root\":\"shell\",\"cwd\":\"/w\",\"since\":1794803331582}"'

# answer [n] rc: the fake hc's answer to call n (default: every call). The JSON
# text comes from stdin; it goes to stdout when rc is 0, to stderr otherwise.
answer() {
  if [ $# -eq 2 ]; then file="$case/answer.$1"; rc=$2; else file="$case/answer"; rc=$1; fi
  { echo "$rc"; cat; } > "$file"
}

case_name=
case=
new_case() {
  case_name=$1
  case="$scratch/$interp/$1"
  bin="$case/bin dir"
  mkdir -p "$bin" "$case/path"
  cp "$project/suspend/herdr-shell" "$bin/herdr-shell"
  cat > "$bin/herdr-standin" <<'EOF'
#!/bin/sh
printf '%s\n' standin "$@" > "$CASE/ran"
EOF
  cat > "$case/path/fake-shell" <<'EOF'
#!/bin/sh
printf '%s\n' shell "$@" > "$CASE/ran"
EOF
  cat > "$case/path/hc" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$CASE/hc.log"
n=$(wc -l < "$CASE/hc.log" | tr -d ' ')
file="$CASE/answer.$n"
[ -f "$file" ] || file="$CASE/answer"
rc=$(head -n 1 "$file")
if [ "$rc" -eq 0 ]; then tail -n +2 "$file"; else tail -n +2 "$file" >&2; fi
exit "$rc"
EOF
  chmod +x "$bin/herdr-standin" "$case/path/fake-shell" "$case/path/hc"
  launcher="$bin/herdr-shell"
  fake_shell="$case/path/fake-shell"
  # Only these variables reach the launcher; the real hc and core stay out of reach.
  base_path="PATH=$case/path:/usr/bin:/bin"
}

# launch [VAR=value...] -- [launcher arguments...]: run the launcher in the
# foreground with a clean environment, stdin closed.
launch() {
  # Replace the first -- with the interpreter and the launcher's path.
  seen=
  for word do
    shift
    if [ -z "$seen" ] && [ "$word" = -- ]; then
      seen=1
      set -- "$@" "$interp" "$launcher"
    else
      set -- "$@" "$word"
    fi
  done
  env -i "$base_path" "CASE=$case" "$@" < /dev/null > "$case/out" 2>&1 ||
    fail "the launcher exited with code $?"
}

# launch_waiting [VAR=value...] -- [arguments...]: like launch, but in the
# background, with stdin from a fifo that the test writes to on fd 4.
launch_waiting() {
  seen=
  for word do
    shift
    if [ -z "$seen" ] && [ "$word" = -- ]; then
      seen=1
      set -- "$@" "$interp" "$launcher"
    else
      set -- "$@" "$word"
    fi
  done
  mkfifo "$case/stdin"
  env -i "$base_path" "CASE=$case" "$@" < "$case/stdin" > "$case/out" 2>&1 &
  bg_pid=$!
  exec 4> "$case/stdin"
}
# Stops the background launcher; it must still be waiting.
stop_waiting() {
  kill -0 "$bg_pid" 2>/dev/null || fail 'the launcher exited instead of waiting'
  kill "$bg_pid"
  wait "$bg_pid" 2>/dev/null || :
  bg_pid=
  exec 4>&-
}
# Waits up to 5 s for the launcher to ask for Enter.
wait_prompt() {
  i=0
  while ! grep -F 'Press Enter to try again' "$case/out" >/dev/null && [ "$i" -lt 50 ]; do
    sleep 0.1
    i=$((i + 1))
  done
}
# Waits up to 3 s for the launcher to start a program.
wait_ran() {
  i=0
  while [ ! -e "$case/ran" ] && [ "$i" -lt 30 ]; do sleep 0.1; i=$((i + 1)); done
}

run_cases() {
  new_case label-absent-starts-shell
  terminal_json '{"herdr.last-agent":"pi"}' '"impl"' | answer 0
  launch HC_TERMINAL_ID=t7 "SHELL=$fake_shell" -- -l "two words"
  assert_ran shell -l "two words"
  [ "$(cat "$case/hc.log")" = "get t7 --json" ] || fail "hc called as: $(cat "$case/hc.log")"

  new_case label-present-starts-standin
  terminal_json "{\"herdr.last-agent\":\"pi\",$suspended_label}" '"impl"' | answer 0
  launch HC_TERMINAL_ID=t7 "SHELL=$fake_shell" -- -l
  assert_ran standin pi t7 impl

  new_case standin-gets-exact-name
  terminal_json "{\"name\":\"not this\",$suspended_label}" '" my \"agent\" \\ one "' | answer 0
  launch HC_TERMINAL_ID=t7 -- -l
  assert_ran standin pi t7 ' my "agent" \ one '

  new_case unnamed-terminal-standin-gets-empty-name
  terminal_json "{$suspended_label}" null | answer 0
  launch HC_TERMINAL_ID=t7 --
  assert_ran standin pi t7 ''

  new_case label-text-elsewhere-is-not-the-label
  # The label's text inside a string (another label's value, the program's
  # words) is escaped, so it must not count as the label.
  printf '%s\n' '{"address":"t7","argv":["pi","\"herdr.suspended\":\"x\""],"labels":{"note":"\"herdr.suspended\":\"{}\""},"name":"impl"}' | answer 0
  launch HC_TERMINAL_ID=t7 "SHELL=$fake_shell" --
  assert_ran shell

  # bash as sh (macOS /bin/sh) sets SHELL to the login shell itself when it is
  # unset, so the launcher can only see an unset SHELL under other shells.
  if env -i "$interp" -c '[ -z "${SHELL:-}" ]'; then
    new_case shell-unset-falls-back-to-bin-sh
    terminal_json '{}' '"impl"' | answer 0
    launch HC_TERMINAL_ID=t7 -- -c 'printf "%s\n" bin-sh "$0" "$@" > "$CASE/ran"' zero "a b"
    assert_ran bin-sh zero "a b"
  fi

  new_case unavailable-core-is-retried
  printf '%s\n' '{"error":{"kind":"unavailable","message":"the core restarted while this ran (an update?)"}}' | answer 1 5
  printf '%s\n' '{"error":{"kind":"unavailable","message":"the core restarted while this ran (an update?)"}}' | answer 2 5
  terminal_json "{$suspended_label}" '"impl"' | answer 0
  launch HC_TERMINAL_ID=t7 "SHELL=$fake_shell" --
  assert_ran standin pi t7 impl
  [ "$(hc_calls)" -eq 3 ] || fail "hc called $(hc_calls) times, expected 3"
  if grep -F unavailable "$case/out" >/dev/null; then fail 'a retried error was shown'; fi

  new_case core-never-answers-waits-without-shell
  printf '%s\n' '{"error":{"kind":"unavailable","message":"the core restarted while this ran"}}' | answer 5
  launch_waiting HC_TERMINAL_ID=t7 "SHELL=$fake_shell" --
  wait_prompt
  assert_out 'herdr-shell: hc get t7 failed (exit 5)'
  assert_out 'the core restarted while this ran'
  assert_out 'Press Enter to try again'
  assert_nothing_ran
  calls=$(hc_calls)
  [ "$calls" -gt 3 ] || fail "hc called $calls times, expected retries"
  sleep 0.5
  [ "$(hc_calls)" -eq "$calls" ] || fail 'hc was called again without input'
  # Enter tries again, and a later answer is used.
  terminal_json '{}' '"impl"' | answer 0
  echo >&4
  wait_ran
  assert_ran shell
  wait "$bg_pid" || fail 'the shell did not replace the launcher'
  bg_pid=
  exec 4>&-

  new_case other-error-is-not-retried
  printf '%s\n' '{"error":{"hint":"see `hc ls --all`","kind":"not_found","message":"no terminal \"t7\""}}' | answer 3
  launch_waiting HC_TERMINAL_ID=t7 "SHELL=$fake_shell" --
  wait_prompt
  assert_out 'herdr-shell: hc get t7 failed (exit 3)'
  assert_out 'no terminal'
  [ "$(hc_calls)" -eq 1 ] || fail "hc called $(hc_calls) times, expected 1"
  assert_nothing_ran
  stop_waiting

  new_case unreadable-answer-waits-without-shell
  printf 'warning: something\n' | answer 0
  launch_waiting HC_TERMINAL_ID=t7 "SHELL=$fake_shell" --
  wait_prompt
  assert_out 'gave an answer that cannot be read: warning: something'
  assert_nothing_ran
  stop_waiting

  new_case truncated-answer-with-label-waits-without-shell
  printf '%s\n' '{"address":"t7","labels":{"herdr.suspended":"{}"' | answer 0
  launch_waiting HC_TERMINAL_ID=t7 "SHELL=$fake_shell" --
  wait_prompt
  assert_out 'gave an answer that cannot be read'
  assert_nothing_ran
  stop_waiting

  new_case missing-standin-waits-without-shell
  terminal_json "{$suspended_label}" '"impl"' | answer 0
  rm "$bin/herdr-standin"
  launch_waiting HC_TERMINAL_ID=t7 "SHELL=$fake_shell" --
  wait_prompt
  assert_out "the stand-in $bin/herdr-standin is missing"
  assert_nothing_ran
  stop_waiting

  new_case no-terminal-id-waits-without-shell
  terminal_json '{}' '"impl"' | answer 0
  launch_waiting "SHELL=$fake_shell" --
  wait_prompt
  assert_out 'HC_TERMINAL_ID is not set'
  [ "$(hc_calls)" -eq 0 ] || fail 'hc was called without a terminal'
  assert_nothing_ran
  stop_waiting
}

interps=/bin/sh
command -v dash >/dev/null 2>&1 && interps="$interps $(command -v dash)"
for interp in $interps; do
  run_cases
done

# hc starts the configured shell by its path, through the #! line.
interp=direct
new_case executable-finds-standin-next-to-itself
terminal_json "{$suspended_label}" '"impl"' | answer 0
[ -x "$launcher" ] || fail 'the launcher is not executable'
env -i "$base_path" "CASE=$case" HC_TERMINAL_ID=t7 "$launcher" -l \
  < /dev/null > "$case/out" 2>&1
assert_ran standin pi t7 impl
echo "herdr-shell tests passed ($interps)"
