#!/bin/sh
# Run with: sh tests/install.test.sh. All installs use disposable fixtures.
set -eu

project=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/herdr-install-test.XXXXXX")
watch_pid=
cleanup() {
  if [ -n "$watch_pid" ]; then
    kill "$watch_pid" 2>/dev/null || :
    wait "$watch_pid" 2>/dev/null || :
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_file() { [ -f "$1" ] || fail "missing $1"; }
assert_absent() { [ ! -e "$1" ] || fail "unexpected $1"; }
assert_same() { cmp -s "$1" "$2" || fail "$1 differs from $2"; }
assert_log() { grep -F "$1" "$log" >/dev/null || fail "missing log: $1"; }
hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}
fixture() {
  case_dir="$scratch/$1"
  repo="$case_dir/repo with spaces"
  home="$case_dir/home"
  state="$case_dir/state"
  config=
  app_override=
  pi_override=
  run_path=$PATH
  app="$home/.config/herdr-app"
  pi="$home/.pi/agent"
  record="$state/herdr-tincho-config"
  log="$case_dir/output"
  mkdir -p "$repo/herdr/mods/example" "$repo/pi/extensions/herdr-recovery" "$home/.pi"
  cp "$project/install.sh" "$repo/install.sh"
  printf 'herdr-v1\n' > "$repo/herdr/mods/example/main.js"
  # Own fixture files: never depend on concurrently created extension code.
  printf 'pi-v1\n' > "$repo/pi/extensions/herdr-recovery/index.ts"
  printf 'export {};\n' > "$repo/pi/extensions/herdr-recovery/types.d.ts"
  printf 'pi spaced\n' > "$repo/pi/extensions/herdr-recovery/with spaces.ts"
  printf 'herdr shared\n' > "$repo/herdr/shared.txt"
  printf 'pi shared\n' > "$repo/pi/shared.txt"
  printf 'ignored.txt\n' > "$repo/.gitignore"
  git -C "$repo" init -q
  git -C "$repo" add .
  printf 'ignored\n' > "$repo/pi/ignored.txt"
  printf 'new\n' > "$repo/pi/extensions/herdr-recovery/new.ts"
}
run() {
  # Do not inherit any real install roots, git overrides, or shell startup files.
  env -i PATH="$run_path" HOME="$home" XDG_CONFIG_HOME="$config" \
    XDG_STATE_HOME="$state" HERDR_APP_HOME="$app_override" \
    PI_CODING_AGENT_DIR="$pi_override" sh "$repo/install.sh" "$@"
}

fixture no-pi
rmdir "$home/.pi"
run > "$log"
assert_file "$app/mods/example/main.js"
assert_log 'pi: skipped'
assert_absent "$home/.pi"
assert_absent "$record/installed-pi"
assert_absent "$record/installed-pi.files"
assert_absent "$record/installed-pi.next"
# Skipping must preserve a manifest from a previously removed Pi setup.
printf 'previous Pi state\n' > "$record/installed-pi"
cp "$record/installed-pi" "$case_dir/pi-record"
run --force > "$log"
assert_log 'pi: skipped'
assert_absent "$home/.pi"
assert_same "$case_dir/pi-record" "$record/installed-pi"
# An unrelated file named .pi is not an existing Pi directory.
printf 'not a directory\n' > "$home/.pi"
run > "$log"
assert_log 'pi: skipped'
[ -f "$home/.pi" ] || fail 'changed non-directory .pi'
assert_same "$case_dir/pi-record" "$record/installed-pi"
echo 'ok - absent Pi is skipped without creating directories or modifying Pi state'

fixture defaults
run --help > "$log"
assert_log 'PI_CODING_AGENT_DIR'
if grep -F 'set -eu' "$log" >/dev/null; then fail 'help includes shell code'; fi
assert_absent "$app"
assert_absent "$pi"
run > "$log"
assert_same "$repo/herdr/mods/example/main.js" "$app/mods/example/main.js"
assert_same "$repo/pi/extensions/herdr-recovery/index.ts" "$pi/extensions/herdr-recovery/index.ts"
assert_file "$pi/extensions/herdr-recovery/types.d.ts"
assert_file "$pi/extensions/herdr-recovery/with spaces.ts"
assert_file "$pi/extensions/herdr-recovery/new.ts"
assert_absent "$pi/ignored.txt"
assert_same "$repo/herdr/shared.txt" "$app/shared.txt"
assert_same "$repo/pi/shared.txt" "$pi/shared.txt"
cp "$record/installed" "$case_dir/herdr-record"
cp "$record/installed-pi" "$case_dir/pi-record"
run > "$log"
assert_log 'herdr: 0 installed, 0 skipped'
assert_log 'pi: 0 installed, 0 skipped'
assert_same "$case_dir/herdr-record" "$record/installed"
assert_same "$case_dir/pi-record" "$record/installed-pi"
echo 'ok - default roots, independent keys, untracked files, idempotence'

fixture overrides
rmdir "$home/.pi" # A nonempty explicit override opts in without a default Pi home.
config="$case_dir/xdg config"
app="$config/herdr-app"
pi_override="$case_dir/custom pi"
pi=$pi_override
run > "$log"
assert_file "$app/mods/example/main.js"
assert_file "$pi/extensions/herdr-recovery/index.ts"
assert_absent "$home/.config/herdr-app"
assert_absent "$home/.pi/agent"
app_override="$case_dir/custom herdr"
app=$app_override
run > "$log"
assert_file "$app/mods/example/main.js"
assert_log 'pi: 0 installed, 0 skipped'
echo 'ok - XDG, Herdr and Pi destination overrides'

fixture conflicts
run > "$log"
printf 'local herdr\n' > "$app/mods/example/main.js"
printf 'local pi\n' > "$pi/extensions/herdr-recovery/index.ts"
cp "$app/mods/example/main.js" "$case_dir/local-herdr"
cp "$pi/extensions/herdr-recovery/index.ts" "$case_dir/local-pi"
cp "$record/installed" "$case_dir/herdr-record"
cp "$record/installed-pi" "$case_dir/pi-record"
run > "$log"
assert_log 'herdr: 0 installed, 1 skipped'
assert_log 'pi: 0 installed, 1 skipped'
assert_same "$case_dir/local-herdr" "$app/mods/example/main.js"
assert_same "$case_dir/local-pi" "$pi/extensions/herdr-recovery/index.ts"
assert_same "$case_dir/herdr-record" "$record/installed"
assert_same "$case_dir/pi-record" "$record/installed-pi"
run --force > "$log"
assert_same "$case_dir/local-herdr" "$app/mods/example/main.js.orig"
assert_same "$case_dir/local-pi" "$pi/extensions/herdr-recovery/index.ts.orig"
assert_same "$repo/herdr/mods/example/main.js" "$app/mods/example/main.js"
assert_same "$repo/pi/extensions/herdr-recovery/index.ts" "$pi/extensions/herdr-recovery/index.ts"
echo 'ok - local conflicts and force backups in both roots'

fixture preexisting
mkdir -p "$app/mods/example" "$pi/extensions/herdr-recovery"
printf 'unmanaged herdr\n' > "$app/mods/example/main.js"
printf 'unmanaged pi\n' > "$pi/extensions/herdr-recovery/index.ts"
run > "$log"
assert_log 'herdr: 1 installed, 1 skipped'
assert_log 'pi: 4 installed, 1 skipped'
if grep 'mods/example/main.js' "$record/installed" >/dev/null; then fail 'claimed unmanaged Herdr file'; fi
if grep 'extensions/herdr-recovery/index.ts' "$record/installed-pi" >/dev/null; then fail 'claimed unmanaged Pi file'; fi
echo 'ok - unmanaged destination files are not claimed'

fixture stale
run > "$log"
rm "$repo/herdr/mods/example/main.js"
rm -rf "$repo/pi"
run > "$log"
assert_log 'stale      mods/example/main.js:'
assert_log 'stale      extensions/herdr-recovery/index.ts:'
assert_file "$app/mods/example/main.js"
assert_file "$pi/extensions/herdr-recovery/index.ts"
run > "$log"
assert_log 'stale      mods/example/main.js:'
assert_log 'stale      extensions/herdr-recovery/index.ts:'
rm "$app/mods/example/main.js" "$pi/extensions/herdr-recovery/index.ts"
run > "$log"
if grep 'mods/example/main.js' "$record/installed" >/dev/null; then fail 'retained removed stale Herdr file'; fi
if grep 'extensions/herdr-recovery/index.ts' "$record/installed-pi" >/dev/null; then fail 'retained removed stale Pi file'; fi
echo 'ok - stale files persist and are reported until manually removed'

fixture legacy
mkdir -p "$record" "$app/mods/example"
printf 'legacy installed content\n' > "$app/mods/example/main.js"
printf 'legacy stale\n' > "$app/old.txt"
printf '%s mods/example/main.js\n' "$(hash "$app/mods/example/main.js")" > "$record/installed"
printf '%s old.txt\n' "$(hash "$app/old.txt")" >> "$record/installed"
run > "$log"
assert_same "$repo/herdr/mods/example/main.js" "$app/mods/example/main.js"
assert_log 'stale      old.txt:'
grep -F "$(hash "$repo/herdr/mods/example/main.js") mods/example/main.js" "$record/installed" >/dev/null || fail 'legacy key changed'
assert_file "$pi/extensions/herdr-recovery/index.ts"
echo 'ok - old unprefixed Herdr manifests update without migration or conflicts'

fixture archive
rm -rf "$repo/.git" "$repo/pi/ignored.txt"
printf 'generated\n' > "$repo/herdr/mods/example/gpui-kit.d.ts"
printf '{}\n' > "$repo/herdr/mods/example/jsconfig.json"
run > "$log"
assert_absent "$app/mods/example/gpui-kit.d.ts"
assert_absent "$app/mods/example/jsconfig.json"
assert_file "$pi/extensions/herdr-recovery/types.d.ts"
rm -rf "$repo/pi"
run > "$log"
assert_log 'stale      extensions/herdr-recovery/index.ts:'
echo 'ok - non-git checkout, existing Herdr exclusions, missing Pi source'

fixture atomic
mkdir -p "$case_dir/bin"
real_cp=$(command -v cp)
# Reject all content copies except staging writes. mv must publish them.
printf '#!/bin/sh\ncase "$2" in *.install-tmp) ;; *) exit 91 ;; esac\nexec "%s" "$@"\n' "$real_cp" > "$case_dir/bin/cp"
chmod +x "$case_dir/bin/cp"
run_path="$case_dir/bin:$PATH"
run > "$log"
printf 'herdr-v2\n' > "$repo/herdr/mods/example/main.js"
printf 'pi-v2\n' > "$repo/pi/extensions/herdr-recovery/index.ts"
run > "$log"
assert_same "$repo/herdr/mods/example/main.js" "$app/mods/example/main.js"
assert_same "$repo/pi/extensions/herdr-recovery/index.ts" "$pi/extensions/herdr-recovery/index.ts"
[ -z "$(find "$app" "$pi" -name '*.install-tmp' -print)" ] || fail 'staging files remain'
echo 'ok - first installs and managed updates use staging writes'

wait_same() {
  attempts=0
  until cmp -s "$1" "$2"; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 100 ] || fail "watch did not update $2"
    kill -0 "$watch_pid" 2>/dev/null || fail 'watch exited'
    sleep 0.1
  done
}
wait_log() {
  attempts=0
  until grep -F "$1" "$log" >/dev/null; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 100 ] || fail "watch did not report $1"
    kill -0 "$watch_pid" 2>/dev/null || fail 'watch exited'
    sleep 0.1
  done
}
fixture watch
# exec avoids leaving the watched installer behind when the test kills its pid.
(exec env -i PATH="$PATH" HOME="$home" XDG_STATE_HOME="$state" \
  sh "$repo/install.sh" --watch > "$log" 2>&1) &
watch_pid=$!
wait_log 'pi: 5 installed, 0 skipped'
printf 'herdr-v2\n' > "$repo/herdr/mods/example/main.js"
printf 'pi-v2\n' > "$repo/pi/extensions/herdr-recovery/index.ts"
wait_same "$repo/herdr/mods/example/main.js" "$app/mods/example/main.js"
wait_same "$repo/pi/extensions/herdr-recovery/index.ts" "$pi/extensions/herdr-recovery/index.ts"
printf 'herdr-v3\n' > "$repo/herdr/mods/example/main.js"
printf 'pi-v3\n' > "$repo/pi/extensions/herdr-recovery/index.ts"
wait_same "$repo/herdr/mods/example/main.js" "$app/mods/example/main.js"
wait_same "$repo/pi/extensions/herdr-recovery/index.ts" "$pi/extensions/herdr-recovery/index.ts"
mv "$repo/herdr/shared.txt" "$repo/herdr/renamed.txt"
mv "$repo/pi/shared.txt" "$repo/pi/renamed.txt"
wait_same "$repo/herdr/renamed.txt" "$app/renamed.txt"
wait_same "$repo/pi/renamed.txt" "$pi/renamed.txt"
wait_log 'stale      shared.txt:'
assert_file "$app/shared.txt"
assert_file "$pi/shared.txt"
kill "$watch_pid"
wait "$watch_pid" 2>/dev/null || :
watch_pid=
echo 'ok - watch handles repeated same-size edits and renames in both trees'

fixture watch-conditional
rmdir "$home/.pi"
(exec env -i PATH="$PATH" HOME="$home" XDG_STATE_HOME="$state" \
  sh "$repo/install.sh" --watch > "$log" 2>&1) &
watch_pid=$!
wait_log 'pi: skipped'
assert_absent "$home/.pi"
assert_absent "$record/installed-pi"
mkdir "$home/.pi"
# Existing --watch notices setup eligibility without requiring a source edit.
wait_log 'pi: 5 installed, 0 skipped'
wait_same "$repo/pi/extensions/herdr-recovery/index.ts" "$pi/extensions/herdr-recovery/index.ts"
cp "$record/installed-pi" "$case_dir/pi-record"
mv "$home/.pi" "$home/saved-pi"
# A Herdr edit gives us a deterministic completed pass after Pi is removed.
printf 'herdr-v2\n' > "$repo/herdr/mods/example/main.js"
wait_same "$repo/herdr/mods/example/main.js" "$app/mods/example/main.js"
assert_absent "$home/.pi"
assert_same "$case_dir/pi-record" "$record/installed-pi"
kill "$watch_pid"
wait "$watch_pid" 2>/dev/null || :
watch_pid=
echo 'ok - watch activates existing Pi and never recreates a removed Pi home'
echo 'All installer tests passed.'
