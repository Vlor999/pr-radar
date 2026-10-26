---
name: release
description: Publish a new PR Radar version (bump on dev, PR dev → main, follow the release workflow). Use when the user asks for a release, a tag, or "ship vX.Y.Z".
---

# Release PR Radar

Flow: everything goes through `dev`; merging the `dev → main` PR triggers `release.yml`, which publishes if the `package.json` version has no release yet (otherwise nothing).

1. Prerequisites: `dev` clean and up to date, no `release.yml` run in progress (`gh run list --workflow release.yml --limit 3`). One release at a time.
   The Slack app Redirect URLs (api.slack.com → OAuth & Permissions) must include `https://vlor999.github.io/pr-radar/oauth.html` (keep `prradar://oauth` for older versions).
2. Checks: `npm run typecheck && npm test && (cd src-tauri && cargo clippy -- -D warnings && cargo test)`.
3. Bump the same `X.Y.Z` version in:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml` (`[package] version`)
   then `npm install --package-lock-only` (and `cargo check` in `src-tauri` for `Cargo.lock`).
4. Commit `chore: release vX.Y.Z` on `dev`, with the Co-Authored-By trailer.
5. Confirm with the user before pushing (public action), then:
   ```sh
   git push origin dev
   gh pr create --base main --head dev --title "chore: release vX.Y.Z" --body "..."
   gh pr checks --watch && gh pr merge --merge   # merge commit, no squash (otherwise dev and main diverge)
   ```
   No manual tag: `tauri-action` creates the `vX.Y.Z` tag and the release.
6. Follow: `gh run watch $(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')`. All 4 builds (macOS arm64/x64, Windows, Linux) must be green.
7. Check the release: `gh release view vX.Y.Z` → assets present, `latest.json` holds the new version. The Slack return page answers 200: `curl -so /dev/null -w '%{http_code}' https://vlor999.github.io/pr-radar/oauth.html`.
8. If the Apple secrets exist (`gh secret list | grep APPLE`): check the notarization of the arm64 `.dmg` (see `docs/apple-notarization.md`, step 7).
