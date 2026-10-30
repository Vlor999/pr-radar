---
description: "Protocol for implementation and review subagents on PR Radar: model, worktree, skills, output."
---

# Subagents

**One task = one subagent = one worktree = one PR to `dev`.**

## Launch

- **Model**: set on every launch (`model` of the Agent tool), based on the task.
  - Opus: implementation (code, tests, PR), design, security review, bug with an unknown cause.
  - Sonnet: bounded, mechanical task (docs, renaming, repetitive migration), `mr-review` reviewers.
  - Haiku: read-only search and exploration.
  - Fable: planning or extreme fixes. **Ask the user first.**
  When in doubt, the more capable one, except Fable.
- **Isolation**: worktree from `origin/dev` (skill `worktree`, folder `.claude/worktrees/<slug>`). Never two agents on the same files.
- **Context in the prompt**: the task (or the GitHub issue), the applicable rules (`CLAUDE.md`, `.claude/rules/`), the known input files. The agent must not guess anything.

## Skills to always give

- `logical-commit-sequencer`: atomic commits, ordered, before the push.
- `worktree` for an implementation, `mr-review` (read-only mode) for a review.

## Output requirements

1. Green checks before push (`CLAUDE.md` § Checks).
2. Checks green → the agent commits (`logical-commit-sequencer`), pushes (`git push -u origin <branch>`) and opens the PR at once, without waiting for the user. This is the expected end of every implementation task, not an extra step to confirm.
3. PR with `gh pr create --base dev` (or `--base <parent branch>` for a stacked PR the user asked for), format from `project.md`, no question in the body, never `--reviewer`.
4. Visible change: after the PR, the orchestrator runs `npm run demo` (skill `demo`) and gets the user's validation before merge.
5. Final report: PR URL, decisions taken, work left.

## After review

- A subagent does not launch agents: the orchestrator runs the review loop of `mr-review` (§ Orchestrated loop): one delegated read-only reviewer per PR.
- Review findings go back to the original agent (it has the context, `SendMessage`), which fixes them with new commits on the same branch, checks green, and pushes without waiting. Never `--amend`, never force-push.
- After merge: worktree removed.
- Parallel agents only on disjoint areas of the code.
