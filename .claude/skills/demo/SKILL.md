---
name: demo
description: Run a local PR Radar demo in the browser (localhost:1420) with GitHub and Tauri mocked, so the user can validate a feature. Use after each feature, or when the user asks for a demo, a preview, or "show me".
---

# Local demo (browser, mock data)

`npm run demo` = `vite --mode demo` on http://localhost:1420. In `demo` mode, `vite.config.ts` replaces:
- `@/lib/github` / `./github` → `src/demo/github.ts` (mock repos and PRs, orgs `acme`, `globex`, `me`);
- `@tauri-apps/api/{core,app}` and `@tauri-apps/plugin-*` → `src/demo/tauri.ts` (fake token, no updater, `invoke` logged to the console).

No gh login, no network call to GitHub.

## Steps

1. If the feature depends on missing data (new `Pr` field, new CI state, edge case), extend `src/demo/github.ts`. Mock data only.
2. If the feature calls a new function of `src/lib/github.ts` or a new `invoke` command, add it to the mock (same signature). Check: `npm run typecheck`.
3. Run in the background: `npm run demo` (strict port 1420, the same as `tauri dev`: stop `tauri dev` first; if the demo already runs, reuse it).
4. Open: `open http://localhost:1420`.
5. Give the user a short list of what to test (concrete steps, window sizes if responsive).
6. Wait for explicit validation before merge/release (rule in `CLAUDE.md`). The PR may already be open.

Browser state (followed repos, settings) lives in the `localhost:1420` localStorage, separate from the installed app. To start over: clear the site storage in the browser.
