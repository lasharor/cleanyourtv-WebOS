#!/bin/sh
# The daily release, run on the dev branch by .github/workflows/release.yml (or by hand: sh tools/release.sh, CYTV_DRY=1 only tells
# what it would do). When the files that go into the package changed since the last release:
#   - the service version (VERSION in helper/helper.js) goes up one patch, unless it was raised by hand on dev since then;
#   - the launcher version (app/version.json, app/src/js/core.js) the same, when app/ changed;
#   - that is committed to dev, main is moved to dev, and the release notes are the commit subjects since the last release.
# Changes outside the package (documentation, tools, tests) only move main, so the documentation site follows.
# The workflow builds and publishes the release; this script writes what it needs to $GITHUB_OUTPUT (or prints it):
#   tag=v<service version> (empty: nothing to release)   docs=1 when main gets documentation changes
# and the release notes to $NOTES.
set -e
cd "$(dirname "$0")/.."
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
DRY="${CYTV_DRY:-}"
NOTES="${RUNNER_TEMP:-/tmp}/release-notes.md"
PKG="app manager notify picker helper i18n scripts voice third-party ipk themes assets compat.json config.example.json uninstall.sh THIRD-PARTY.md LICENSE"
say() { echo "[release] $*" >&2; }

# RELEASE-HOLD in the repository root: nothing is released, and main stays where it is, for as long as the file is on dev (its
# first line says why). Dev builds are not affected. Delete the file to release again. Unlike the RELEASE_HOLD variable of the
# workflow, it also stops a run started by hand.
if [ -f RELEASE-HOLD ]; then
  say "RELEASE-HOLD is present, no release: $(head -1 RELEASE-HOLD)"
  echo "tag=" >> "$OUT"
  echo "docs=0" >> "$OUT"
  exit 0
fi

last=$(git tag -l 'v*' --sort=-v:refname | head -1)
[ -n "$last" ] || { say "no earlier release tag (v*) found"; exit 1; }
git merge-base --is-ancestor "$last" HEAD || { say "$last is not on this branch"; exit 1; }
say "last release: $last ($(git log -1 --format=%cs "$last"))"

docs=0
git diff --quiet "$last" HEAD -- docs zensical.toml || docs=1
# shellcheck disable=SC2086
if git diff --quiet "$last" HEAD -- $PKG; then
  say "the package did not change since $last: no release"
  echo "tag=" >> "$OUT"
  echo "docs=$docs" >> "$OUT"
  [ -n "$DRY" ] || git push -q origin HEAD:refs/heads/main
  exit 0
fi

ver() { sed -n "s/^const VERSION = '\(.*\)';/\1/p"; }
fever() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))'; }
patch() { echo "$1" | awk -F. '{ printf "%d.%d.%d\n", $1, $2, $3 + 1 }'; }
svc=$(ver < helper/helper.js)
svc_last=$(git show "$last:helper/helper.js" | ver)
fe=$(fever < app/version.json)
fe_last=$(git show "$last:app/version.json" | fever)

if [ "$svc" = "$svc_last" ]; then svc_new=$(patch "$svc"); else svc_new=$svc; say "service version raised by hand: $svc"; fi
fe_new=$fe
if ! git diff --quiet "$last" HEAD -- app; then
  if [ "$fe" = "$fe_last" ]; then fe_new=$(patch "$fe"); else say "launcher version raised by hand: $fe"; fi
fi
git rev-parse -q --verify "refs/tags/v$svc_new" >/dev/null && { say "v$svc_new exists already"; exit 1; }
say "release v$svc_new: service $svc -> $svc_new, launcher $fe -> $fe_new"

{
  echo "Service $svc_new, launcher $fe_new."
  echo
  # shellcheck disable=SC2086
  git log --no-merges --invert-grep --grep='^Release [0-9]' --format='- %s' "$last..HEAD" -- $PKG
} > "$NOTES"
# RELEASE-NOTES.md in the repository root is the release notes, written by hand as the changes came in (sections, credits, pictures from
# docs/screenshots): it takes the place of the commit subjects, and goes with this release (removed in the release commit below)
if [ -f RELEASE-NOTES.md ]; then
  { echo "Service $svc_new, launcher $fe_new."; echo; cat RELEASE-NOTES.md; } > "$NOTES"
  say "the release notes are RELEASE-NOTES.md"
fi

if [ -n "$DRY" ]; then
  cat "$NOTES" >&2
  echo "tag=v$svc_new" >> "$OUT"
  echo "docs=$docs" >> "$OUT"
  exit 0
fi

[ "$svc_new" = "$svc" ] || sed -i.bak "s/^const VERSION = '$svc';/const VERSION = '$svc_new';/" helper/helper.js
if [ "$fe_new" != "$fe" ]; then
  sed -i.bak "s/\"version\":\"$fe\"/\"version\":\"$fe_new\"/" app/version.json
  sed -i.bak "s/VERSION = '$fe';/VERSION = '$fe_new';/" app/src/js/core.js
  node tools/build-pages.js >&2
fi
rm -f helper/helper.js.bak app/version.json.bak app/src/js/core.js.bak
[ "$(ver < helper/helper.js)" = "$svc_new" ] && [ "$(fever < app/version.json)" = "$fe_new" ] || { say "the version change did not apply"; exit 1; }
git add helper/helper.js app/version.json app/src/js/core.js app/index.html
git rm -q --ignore-unmatch RELEASE-NOTES.md
git diff --cached --quiet || git commit -q -m "Release $svc_new (launcher $fe_new)"   # nothing to commit when both were raised by hand
git push -q origin HEAD:refs/heads/dev   # refs/heads: the dev pre-release has a tag of the same name
git push -q origin HEAD:refs/heads/main
echo "tag=v$svc_new" >> "$OUT"
echo "docs=$docs" >> "$OUT"
