# PR Radar

Tauri v2 desktop app + React 19 + Vite + Tailwind v4 + shadcn (preset `b7ClNF3YW`, base-ui, `cn` imported from `"cn"`). Strict TypeScript, prettier `semi: false`. No backend: direct calls to api.github.com through `@tauri-apps/plugin-http`.

## Checks

```sh
npm run typecheck
npm test
cd src-tauri && cargo clippy -- -D warnings && cargo test
npm run tauri build -- --bundles app   # local macOS build
```

## Rules

- Never print or commit `~/.tauri/pr-radar.key` or its password (CI secrets `TAURI_SIGNING_PRIVATE_KEY*`).
- `site/` (GitHub Pages landing): mock data only (`acme`), never real private repos.
- The OAuth client ID in `src/lib/auth.ts` is public, not a secret.
- Every feature: local browser demo (skill `demo`, `npm run demo` → localhost:1420, mocked data) and explicit user validation before commit/release. No release without validation.
- Branches: work on `dev` (or a branch → PR to `dev`). `main` only accepts PRs from `dev`; the merge triggers the release.
- Detailed rules: `.claude/rules/` (`project`, `typescript`, `test`, `subagents`).
- Skills: `worktree` (task → PR to `dev`), `mr-review` (PR review), `grill-me` (stress-test a plan).
- Release: skill `release` (`.claude/skills/release/SKILL.md`).
- Apple notarization: `docs/apple-notarization.md`.
