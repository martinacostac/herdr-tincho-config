#!/bin/sh
# Installs this repo's Herdr and Pi config on this machine: every file under
# herdr/ goes to the same path under the Herdr app home
# ($HERDR_APP_HOME, else $XDG_CONFIG_HOME/herdr-app, else ~/.config/herdr-app).
# pi/ goes under $PI_CODING_AGENT_DIR, else ~/.pi/agent, only when ~/.pi is
# an existing directory or PI_CODING_AGENT_DIR is explicitly set to a nonempty path.
# Otherwise Pi is skipped; no Pi directory or manifest is created.
# With Bun on PATH, it also builds the suspended agents' stand-in
# (suspend/build.sh) and installs it with its launcher, herdr-shell, into
# $XDG_DATA_HOME/herdr-tincho-config/bin (else ~/.local/share/...), which
# is not on PATH. Then it points herdr-core's `shell` setting at that
# herdr-shell, in $XDG_CONFIG_HOME/herdr-core/config.toml (else ~/.config/...), and
# changes no other key. A different `shell` value is reported and kept.
# Without Bun that part is skipped, and the `shell` key is left unchanged.
#
#   ./install.sh            install what changed
#   ./install.sh --watch    and again on every save (polls once a second)
#   ./install.sh --force    also overwrite files edited in place, and a different
#                           `shell` value (keeps a .orig copy)
#
# It remembers what it installed (sha256 per file, in
# $XDG_STATE_HOME/herdr-tincho-config/installed, or installed-pi for Pi).
# A file someone changed on this machine since the last install is skipped instead of
# overwritten. Files removed from the repo are reported, never deleted.
# The stand-in is recorded by the hash of its sources (installed-suspend), so
# it is rebuilt only when they change.
set -eu

repo=$(cd "$(dirname "$0")" && pwd)
app="${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}"
pi="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
state="${XDG_STATE_HOME:-$HOME/.local/state}/herdr-tincho-config"
bin="${XDG_DATA_HOME:-$HOME/.local/share}/herdr-tincho-config/bin"
core="${XDG_CONFIG_HOME:-$HOME/.config}/herdr-core/config.toml"

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

# sha <file>, or sha - for standard input.
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

# What the last install recorded for `$1` in $manifest (a path under the
# install root, or a stand-in file name), if anything.
last() {
  [ -f "$manifest" ] || return 0
  awk -v p="$1" '{ h = $1; sub(/^[^ ]+ /, "") } $0 == p { print h }' "$manifest" | tail -n 1
}

# Written whole, then renamed into place: Herdr reads files the moment they
# change, and an in-place copy can be read half-written (it then keeps the old one).
# An optional third argument is the mode to give the file before the rename.
put() {
  mkdir -p "$(dirname "$2")"
  cp "$1" "$2.install-tmp"
  [ -z "${3:-}" ] || chmod "$3" "$2.install-tmp"
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

# Everything Bun bundles into the stand-in, relative to the repo: its sources
# under suspend/ (not tests), the build script, and the files under herdr/
# that they import (the shared recipe module, which imports nothing itself).
standin_sources() {
  ts=$(files suspend | grep '\.ts$' | grep -v '\.test\.ts$' | grep -v '\.d\.ts$' | sed 's|^|suspend/|') || :
  [ -z "$ts" ] || printf '%s\n' "$ts"
  echo suspend/build.sh
  [ -z "$ts" ] || printf '%s\n' "$ts" | while IFS= read -r rel; do
    [ ! -f "$repo/$rel" ] || sed -n "s|.*[\"']\.\./\(herdr/[^\"']*\)[\"'].*|\1|p" "$repo/$rel"
  done
}

# One hash over the stand-in's source paths and contents. The stand-in is
# recorded by it, not by the hash of the binary: builds are not always
# reproducible, and hashing a binary of 50 MB or more on every pass is slow.
# Bun's version is not part of it: a Bun that gains the ahead-of-time compile
# is used at the next source change (or delete the binary to rebuild now).
standin_hash() {
  standin_sources | sort -u | while IFS= read -r rel; do
    [ -f "$repo/$rel" ] || continue
    printf '%s %s\n' "$(sha "$repo/$rel")" "$rel"
  done | sha -
}

has_bun() { command -v bun >/dev/null 2>&1; }
has_suspend_sources() { [ -f "$repo/suspend/main.ts" ] && [ -f "$repo/suspend/herdr-shell" ]; }

# The stand-in and herdr-shell, side by side in $bin (herdr-shell starts the
# herdr-standin next to itself). Both are program files, not settings, so a
# new version replaces them even when edited on this machine (no .orig). A failed build keeps the installed stand-in
# and its record, so the next pass tries again; the rest of the install goes on.
install_suspend() (
  manifest="$state/installed-suspend"
  if ! has_bun; then echo 'suspend: skipped (no bun)'; return 0; fi
  if ! has_suspend_sources; then echo 'suspend: skipped (no stand-in sources)'; return 0; fi
  mkdir -p "$state" "$bin"
  next="$manifest.next" build_log="$state/suspend-build.log"
  : > "$next"
  changed=0
  want=$(standin_hash)
  if [ -x "$bin/herdr-standin" ] && [ "$(last herdr-standin)" = "$want" ]; then
    echo "$want herdr-standin" >> "$next"
  elif (cd "$bin" && sh "$repo/suspend/build.sh" "$bin/herdr-standin.install-tmp") > "$build_log" 2>&1 &&
    [ -f "$bin/herdr-standin.install-tmp" ]; then
    chmod 755 "$bin/herdr-standin.install-tmp"
    mv -f "$bin/herdr-standin.install-tmp" "$bin/herdr-standin"
    echo "built      herdr-standin ($(head -n 1 "$build_log"))"
    echo "$want herdr-standin" >> "$next"
    changed=$((changed + 1))
  else
    rm -f "$bin/herdr-standin.install-tmp"
    {
      echo 'suspend: building herdr-standin failed; the installed copy, if any, is kept. Output:'
      sed 's/^/  /' "$build_log"
    } >&2
    was=$(last herdr-standin)
    [ -z "$was" ] || echo "$was herdr-standin" >> "$next"
  fi
  want=$(sha "$repo/suspend/herdr-shell")
  if [ ! -x "$bin/herdr-shell" ] || [ "$(last herdr-shell)" != "$want" ]; then
    put "$repo/suspend/herdr-shell" "$bin/herdr-shell" 755
    echo 'installed  herdr-shell'
    changed=$((changed + 1))
  fi
  echo "$want herdr-shell" >> "$next"
  if cmp -s "$next" "$manifest"; then rm -f "$next"; else mv -f "$next" "$manifest"; fi
  echo "suspend: $changed installed -> $bin"
  # Here, not in install(): without Bun the step above returns early, and
  # the shell setting is then left unchanged.
  install_shell_key
)

# An awk program that reads herdr-core's config (TOML). It finds the
# top-level `shell` key (above the first table header), also when its list
# spans lines.
# - mode=check prints one word: "same" when the value is a list that holds
#   only ENVIRON["path"] (ENVIRON["esc"] is that path escaped for a "..."
#   string), "absent", "unreadable", or "other" followed by the key's lines.
#   "unreadable" means a multi-line string, unbalanced brackets, or a
#   top-level line that is not a key, a table header or a comment: such a
#   file is not edited.
# - mode=write prints the file with ENVIRON["line"] in place of the key, or
#   else after the last top-level key (above the comments and blank lines
#   over the first table header). It prints every other line as it is.
toml_shell='
# s without spaces and without a comment outside strings. Adds the brackets
# that s opens or closes to depth.
function strip(s,   out, i, c, q) {
  out = ""; q = ""
  for (i = 1; i <= length(s); i++) {
    c = substr(s, i, 1)
    if (q != "") {
      out = out c
      if (q == "\"" && c == "\\") { i++; out = out substr(s, i, 1) }
      else if (c == q) q = ""
      continue
    }
    if (c == "#") break
    if (c == " " || c == "\t" || c == "\r") continue
    if (c == "\"" || c == "\047") q = c
    if (c == "[") depth++
    if (c == "]") depth--
    out = out c
  }
  return out
}
{ line[NR] = $0 }
/"""|\047\047\047/ { unreadable = 1 }
table { next }
depth > 0 {
  value_part = strip($0)
  if (in_shell) { value = value value_part; if (depth <= 0) { in_shell = 0; end = NR } }
  if (depth < 0) unreadable = 1
  next
}
/^[ \t]*\[/ { table = NR; next }
{
  # A bare, quoted or dotted key and its "=".
  if (!match($0, /^[ \t]*([A-Za-z0-9_-]+|"([^"\\]|\\.)*"|\047[^\047]*\047)([ \t]*\.[ \t]*([A-Za-z0-9_-]+|"([^"\\]|\\.)*"|\047[^\047]*\047))*[ \t]*=/)) {
    if (strip($0) != "") unreadable = 1
    next
  }
  value_part = strip(substr($0, RLENGTH + 1))
  if (depth < 0) unreadable = 1
  if (!first && $0 ~ /^[ \t]*(shell|"shell"|\047shell\047)[ \t]*=/) {
    first = end = NR; value = value_part; if (depth > 0) in_shell = 1
  }
}
END {
  path = ENVIRON["path"]; esc = ENVIRON["esc"]
  if (mode == "check") {
    if (unreadable || depth != 0) { print "unreadable"; exit }
    if (!first) { print "absent"; exit }
    if (value == "[\"" esc "\"]" || value == "[\"" esc "\",]" ||
        (index(path, "\047") == 0 && (value == "[\047" path "\047]" || value == "[\047" path "\047,]"))) {
      print "same"; exit
    }
    print "other"
    for (i = first; i <= end; i++) print line[i]
    exit
  }
  at = NR + 1
  if (first) at = first
  else if (table) {
    at = table
    while (at > 1 && line[at - 1] ~ /^[ \t\r]*(#.*)?$/) at--
  }
  for (i = 1; i <= NR + 1; i++) {
    if (i == at) print ENVIRON["line"]
    if (first && i >= first && i <= end) continue
    if (i <= NR) print line[i]
  }
}'

# Points herdr-core's `shell` setting at the installed herdr-shell, by its
# absolute path (hc runs the path as written). Only that key changes. A
# missing file is created with only that key, and an identical value is left
# alone (nothing is written, so --watch does not rewrite it on every pass). A
# different value is reported and kept; --force replaces it and keeps a copy
# of the file as config.toml.orig. A file it cannot read is never edited.
install_shell_key() {
  if [ ! -x "$bin/herdr-shell" ] || [ ! -x "$bin/herdr-standin" ]; then
    echo "suspend: shell setting unchanged (herdr-standin is not installed)"
    return 0
  fi
  path=$(cd "$bin" && pwd)/herdr-shell
  # TOML strings cannot hold control characters as they are.
  if [ "$(printf '%s' "$path" | LC_ALL=C tr -d '[:cntrl:]')" != "$path" ]; then
    echo "suspend: shell setting unchanged (control characters in $path)"
    return 0
  fi
  esc=$(printf '%s\n' "$path" | sed 's/[\\"]/\\&/g')
  line="shell = [\"$esc\"]"
  check=missing
  [ ! -f "$core" ] || check=$(path=$path esc=$esc awk -v mode=check "$toml_shell" "$core")
  result=$(printf '%s\n' "$check" | head -n 1)
  case $result in
    same) return 0 ;;
    unreadable)
      echo "skipped    shell in $core: it has a multi-line string or a line this installer cannot read"
      echo "           set it by hand: $line"
      return 0 ;;
    other)
      if ! $force; then
        echo "skipped    shell in $core: herdr-shell needs $line, the file has:"
        printf '%s\n' "$check" | sed '1d; s/^/             /'
        echo '           (--force replaces it, keeping a .orig copy)'
        return 0
      fi
      cp "$core" "$core.orig" ;;
  esac
  mkdir -p "$(dirname "$core")"
  tmp="$core.install-tmp"
  if [ -f "$core" ]; then
    # cp first, so the new file keeps the old one's mode.
    cp "$core" "$tmp"
    path=$path line=$line awk -v mode=write "$toml_shell" "$core" > "$tmp"
  else
    printf '%s\n' "$line" > "$tmp"
  fi
  # A linked config (from a dotfiles repo) is written through the link, so
  # the link stays. That write is not a rename, so hc could read it half
  # written for a moment; keeping the link is worth that.
  if [ -L "$core" ]; then cat "$tmp" > "$core"; rm -f "$tmp"; else mv -f "$tmp" "$core"; fi
  case $result in
    other) echo "overwrote  shell in $core (previous copy: $core.orig)" ;;
    *) echo "set        $line in $core" ;;
  esac
}

install() {
  install_tree herdr "$app" "$state/installed"
  if pi_enabled; then
    install_tree pi "$pi" "$state/installed-pi"
  else
    echo 'pi: skipped (no existing ~/.pi directory; set PI_CODING_AGENT_DIR to opt in)'
  fi
  install_suspend
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
  # The stand-in's sources, never its binary or its manifest, so a build does
  # not trigger another pass. Without Bun they are not hashed; Bun showing up
  # later triggers a pass.
  if has_bun && has_suspend_sources; then
    echo "suspend $(standin_hash)"
    echo "herdr-shell $(sha "$repo/suspend/herdr-shell")"
  else
    echo 'suspend-skipped'
  fi
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
