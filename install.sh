#!/bin/sh
# Installs this repo's Herdr and Pi config on this machine: every file under
# herdr/ goes to the same path under the Herdr app home
# ($HERDR_APP_HOME, else $XDG_CONFIG_HOME/herdr-app, else ~/.config/herdr-app).
# pi/ goes under $PI_CODING_AGENT_DIR, else ~/.pi/agent, only when ~/.pi is
# an existing directory or PI_CODING_AGENT_DIR is explicitly set to a nonempty path.
# Otherwise Pi is skipped; no Pi directory or manifest is created.
#
#   ./install.sh            install what changed
#   ./install.sh --watch    and again on every save (polls once a second)
#   ./install.sh --force    also overwrite files edited in place (keeps a .orig copy)
#
# It remembers what it installed (sha256 per file, in
# $XDG_STATE_HOME/herdr-tincho-config/installed, or installed-pi for Pi).
# A file someone changed on this machine since the last install is skipped instead of
# overwritten. Files removed from the repo are reported, never deleted.
set -eu

repo=$(cd "$(dirname "$0")" && pwd)
app="${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}"
pi="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
state="${XDG_STATE_HOME:-$HOME/.local/state}/herdr-tincho-config"

force=false
watch=false
for arg in "$@"; do
  case $arg in
    --force) force=true ;;
    --watch) watch=true ;;
    -h|--help) sed -n '2,/^set -eu/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if command -v sha256sum >/dev/null 2>&1; then
  sha() { sha256sum "$1" | cut -d' ' -f1; }
else
  sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
fi

# Files relative to the requested source tree: tracked and new ones, minus
# what .gitignore leaves out (the files Herdr writes into mod folders).
files() {
  if git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$repo" ls-files --cached --others --exclude-standard -- "$1/" | sed "s|^$1/||"
  elif [ -d "$repo/$1" ]; then
    if [ "$1" = herdr ]; then
      (cd "$repo/$1" && find . -type f ! -name .DS_Store ! -name jsconfig.json ! -name '*.d.ts' | sed 's|^\./||')
    else
      (cd "$repo/$1" && find . -type f ! -name .DS_Store | sed 's|^\./||')
    fi
  fi | sort -u
}

# What the last install wrote to `$1` (a path under the app home), if anything.
last() {
  [ -f "$manifest" ] || return 0
  awk -v p="$1" '{ h = $1; sub(/^[^ ]+ /, "") } $0 == p { print h }' "$manifest" | tail -n 1
}

# Written whole, then renamed into place: Herdr reads files the moment they
# change, and an in-place copy can be read half-written (it then keeps the old one).
put() {
  mkdir -p "$(dirname "$2")"
  cp "$1" "$2.install-tmp"
  mv -f "$2.install-tmp" "$2"
}

# A separate Pi manifest leaves all existing Herdr manifest keys unchanged,
# including keys that happen to match paths in the Pi source tree.
install_tree() (
  tree=$1 app=$2 manifest=$3
  src="$repo/$tree"
  mkdir -p "$state" "$app"
  next="$manifest.next"
  : > "$next"
  changed=0 skipped=0
  list="$manifest.files"
  files "$tree" > "$list"
  while IFS= read -r rel; do
    from="$src/$rel" to="$app/$rel"
    [ -f "$from" ] || continue
    want=$(sha "$from")
    have=""
    [ -f "$to" ] && have=$(sha "$to")
    was=$(last "$rel")
    if [ "$have" = "$want" ]; then
      :
    elif [ -z "$have" ] || [ "$have" = "$was" ]; then
      put "$from" "$to"; echo "installed  $rel"; changed=$((changed + 1))
    elif $force; then
      cp "$to" "$to.orig"
      put "$from" "$to"; echo "overwrote  $rel (previous copy: $rel.orig)"; changed=$((changed + 1))
    else
      echo "skipped    $rel: changed on this machine since the last install"
      echo "           compare: diff -u '$to' '$from'   (--force overwrites, keeping a .orig copy)"
      skipped=$((skipped + 1))
      [ -n "$was" ] && echo "$was $rel" >> "$next"
      continue
    fi
    echo "$want $rel" >> "$next"
  done < "$list"
  # Installed before, gone from the repo now: say so, leave it to the person.
  if [ -f "$manifest" ]; then
    # Kept in the record, so it's reported on every run until it's gone.
    sed 's/^[^ ]* //' "$manifest" | sort -u | while IFS= read -r rel; do
      awk -v p="$rel" '{ sub(/^[^ ]+ /, "") } $0 == p { f = 1 } END { exit !f }' "$next" && continue
      [ -f "$app/$rel" ] || continue
      echo "stale      $rel: no longer in the repo; remove $app/$rel by hand if unwanted"
      echo "$(last "$rel") $rel" >> "$next"
    done
  fi
  mv -f "$next" "$manifest"
  echo "$tree: $changed installed, $skipped skipped -> $app"
)

pi_enabled() {
  [ -n "${PI_CODING_AGENT_DIR:-}" ] || [ -d "$HOME/.pi" ]
}

install() {
  install_tree herdr "$app" "$state/installed"
  if pi_enabled; then
    install_tree pi "$pi" "$state/installed-pi"
  else
    echo 'pi: skipped (no existing ~/.pi directory; set PI_CODING_AGENT_DIR to opt in)'
  fi
}

# Hash paths and contents in enabled trees. Unlike an mtime comparison against
# the manifest, this detects repeated saves, same-size edits and renames.
stamp() {
  # Eligibility can change without a source edit. Do not hash the unused Pi tree.
  if pi_enabled; then echo 'pi-enabled'; else echo 'pi-disabled'; fi
  for tree in herdr pi; do
    if [ "$tree" = pi ] && ! pi_enabled; then continue; fi
    files "$tree" | while IFS= read -r rel; do
      [ -f "$repo/$tree/$rel" ] || continue
      printf '%s %s/%s\n' "$(sha "$repo/$tree/$rel")" "$tree" "$rel"
    done
  done
}

# Take the snapshot first so a save during installation triggers another pass.
if $watch; then seen=$(stamp); fi
install

if $watch; then
  while :; do
    sleep 1
    now=$(stamp)
    [ "$now" = "$seen" ] && continue
    seen=$now
    install
  done
fi
