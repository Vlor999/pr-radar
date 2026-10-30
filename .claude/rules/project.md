---
description: "PR Radar project rules: branches, commits, PRs, validation, release, security."
---

# Project

## Branches

- `dev` = working branch (default). Small change: commit directly on `dev`. Otherwise branch `<type>/<slug>` from `origin/dev` → PR to `dev` (skill `worktree`).
- `main` only receives the `dev → main` PR, as a merge commit (no squash: `dev` and `main` would diverge). Enforced by the ruleset and the `source-branch` check.
- Merge to `main` = release when the `package.json` version is new (skill `release`). No manual tag.
- No force-push or deletion on `dev`/`main`. After a push, fix with a new commit, not `--amend`.

## Commits and PRs

- Conventional Commits (`feat`, `fix`, `perf`, `ci`, `chore`, `docs`, `refactor`, `test`), with the `Co-Authored-By` trailer.
- Atomic commits ordered by dependency: skill `logical-commit-sequencer`.
- PR body: `## Intent` / `## Choices and caveats`. No question in the body: an open decision is settled with the user before the PR is opened.
- Review: skill `mr-review`. Review fixes: new commits on the same branch, pushed to the same PR.
- Stacked PR (only when the user asks): branch from the parent feature branch, `gh pr create --base <parent branch>`. Retarget to `dev` (`gh pr edit --base dev`) once the parent is merged.

## Validation

- Green checks before any push (`CLAUDE.md` § Checks). Never `--no-verify`.
- Visible change: `npm run demo` (skill `demo`) and explicit user validation before merge. Commit, push and PR do not wait for it.
- Stay inside the requested scope: no refactor, no speculative feature. Simplicity first.

## Security

- Never print or commit the signing key (`~/.tauri/pr-radar.key`) or the user's GitHub token.
- `site/` and `src/demo/`: mock data only (`acme`, `globex`).
- GitHub workflows: actions pinned by SHA, minimal `permissions`, third-party-controlled values (`head_ref`, PR titles) passed through `env`, never interpolated in `run`.
