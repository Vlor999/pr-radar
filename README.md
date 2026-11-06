<p align="center"><img src="assets/logo/logo.svg" width="96" alt="PR Radar"></p>

<h1 align="center">PR Radar</h1>

<p align="center">Your open GitHub pull requests, as a tree: stacks, reviews, threads and merges, in a lightweight desktop app for macOS, Windows and Linux.</p>

<p align="center"><a href="https://vlor999.github.io/pr-radar/">Website</a> · <a href="https://github.com/Vlor999/pr-radar/releases/latest">Download</a> · <a href="https://buymeacoffee.com/Vlor999">Buy me a coffee</a> · <code>brew install --cask vlor999/tap/pr-radar</code></p>

## Why

Follow PR stacks across repos and answer review threads without opening the browser. How it compares with github.com/pulls, Gitify and PR Marmot: [docs/comparison.md](docs/comparison.md).

## Features

- PR tree per repo, with "depends on / blocks" stacks
- Review, CI and conflict status, with a re-run of failed CI jobs
- Unresolved review threads shown with the code: reply or resolve in place
- Request reviewers, mark a draft ready or update a branch from the card
- Other people's PRs where you are assigned, mentioned or involved
- Filters, search, ready-to-merge and stale PRs, new since your last visit
- Calendar: timeline of the PRs in your followed repos over 7 to 30 days, plus month, week and day views
- Optional Slack connection: messages that link to a PR show next to its card
- Quota-aware refreshes that reread only changed PRs
- Command palette `⌘K` / `Ctrl+K` and keyboard shortcuts
- Opt-in local web version ([docs/web.md](docs/web.md)) and read-only MCP server for AI agents ([docs/mcp.md](docs/mcp.md))
- Menu bar or tray app, with notifications, Do not disturb and launch at login
- Light, dark or auto theme; English and French UI

More in [docs/features.md](docs/features.md).

## Install

- Download from the [website](https://vlor999.github.io/pr-radar/) or the [releases](https://github.com/Vlor999/pr-radar/releases) (macOS, Windows and Linux, x64 and arm64), or `brew install --cask vlor999/tap/pr-radar`.
- macOS: signed and notarized by Apple. Drag PR Radar to Applications, open it and confirm "Open".
- Windows: if SmartScreen blocks the installer, click More info > Run anyway.

## GitHub sign-in

- Sign in with GitHub (device flow). There is no server; the token is stored in the system keychain.
- Or use a personal access token, also the way to add GitHub Enterprise. Fine-grained (read Pull requests + Contents/Metadata; write Pull requests to reply, resolve threads and mark drafts ready; write Contents to update a PR branch; write Actions to re-run failed jobs) or classic with the `repo` scope (enough to re-run jobs; the `workflow` scope is only for editing workflow files).

Organization repos may require the organization to approve the OAuth app, or SSO authorization of the token.

## Privacy

No backend, no telemetry, no analytics. The app only talks to GitHub, to your GitHub Enterprise server if you add one, and to Slack if you connect it (read-only, tokens in the system keychain). Details: [docs/privacy.md](docs/privacy.md).

## Docs

- [Features in detail](docs/features.md)
- [Local MCP server](docs/mcp.md)
- [Local web version](docs/web.md)
- [Privacy](docs/privacy.md)
- [Comparison with other tools](docs/comparison.md)
- [Development, releases, updates and signing](docs/development.md), [Apple notarization](docs/apple-notarization.md)
- [Changelog](CHANGELOG.md)

## Development

Prerequisites: Node 22+, Rust stable, [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev
npm test
```

More in [docs/development.md](docs/development.md).

## License

MIT, see [LICENSE](LICENSE). Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (`npm run notices` regenerates it). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

Credits: the app UI was polished with the [unslop](https://github.com/heydamir/unslop) skill by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0, vendored in [`.claude/skills/unslop/`](.claude/skills/unslop/).

PR Radar is provided as is, without warranty (MIT license). Not affiliated with GitHub or Slack. GitHub, Slack, macOS, Windows and Linux are trademarks of their respective owners.
