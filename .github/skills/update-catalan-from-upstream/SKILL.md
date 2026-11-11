---
name: update-catalan-from-upstream
description: 'Use when updating Catalan translations after bringing in changes from the original CleanYourTV repository: fetch upstream dev, safely integrate it, translate missing or changed i18n/ca.json strings, and validate.'
argument-hint: 'Optionally name a source branch or translation scope'
---

# Update Catalan from Upstream

Bring the fork's current work up to date with the original repository's `dev` branch, then translate newly introduced or changed user-facing strings into Catalan.

## Procedure

1. Read the repository's `AGENTS.md` and `i18n/README.md`. Follow their compatibility, privacy, and contribution rules.
2. Inspect `git status --short --branch`, `git branch -vv`, and `git remote -v`. Confirm that `upstream` points to the original project (`lasharor/cleanyourtv-WebOS`) and identify the current branch. Never assume `origin` is the original repository.
3. Protect local work. If the working tree has changes, do not stash, overwrite, reset, or integrate anything until the user chooses how to handle them. Do not switch branches or change branches with uncommitted changes.
4. Fetch the original branch with `git fetch upstream dev`. Review `git log --oneline HEAD..upstream/dev` and the changed paths before integrating.
5. Integrate `upstream/dev` into the current branch without discarding its commits. If the current branch is `dev`, fast-forward it only when that is possible and intended. On any other branch, merge `upstream/dev` into the current branch by default; do not rebase or rewrite published history. Do not resolve conflicts by guessing: show the affected files and ask for guidance.
6. Read `i18n/en.json` as the source of English strings and `i18n/ca.json` as the Catalan target. Use `node tools/i18n.js --missing ca` to find untranslated source strings; also inspect the upstream diff for changed English strings whose Catalan translation may now be stale. Do not translate strings that are not user-facing or invent missing source text.
7. Translate in natural Catalan, following the existing terminology and voice in `i18n/ca.json`. Preserve every source key exactly, JSON structure and plural forms, `%s`/`%d` placeholders, HTML tags, Markdown, newlines, punctuation-sensitive syntax, and template tokens such as `{{...}}`. Keep intentionally untranslated product names, identifiers, URLs, and technical literals consistent with nearby entries.
8. Edit only the translation entries needed for this update unless the user requests broader cleanup. Do not mechanically reorder the whole JSON file.
9. Validate with `node tools/i18n.js --missing ca`, then run `sh tools/check.sh`. Review `git diff --check` and `git diff -- i18n/ca.json`; confirm no upstream source changes were accidentally edited and no keys or placeholders were lost.
10. Report the upstream commit integrated, what translation work changed, validation results, unresolved strings or conflicts, and that no real-TV testing was performed unless it actually was.

## Stop and Ask

- The `upstream` remote is missing or points somewhere unexpected.
- Local modifications or branch history make the integration unsafe or ambiguous.
- A merge conflict needs a semantic decision.
- An English string is ambiguous, context-dependent, or requires a product terminology choice that cannot be inferred from existing Catalan translations.
