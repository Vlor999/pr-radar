<p align="center"><img src="assets/logo/logo.svg" width="96" alt="PR Radar"></p>

<h1 align="center">PR Radar</h1>

<p align="center">Your open GitHub pull requests, as a tree: stacks, reviews, threads and merges, in a lightweight desktop app for macOS, Windows and Linux.</p>

<p align="center"><a href="https://vlor999.github.io/pr-radar/">Website</a> · <a href="https://github.com/Vlor999/pr-radar/releases/latest">Download</a> · <a href="https://buymeacoffee.com/Vlor999">Buy me a coffee</a> · <code>brew install --cask vlor999/tap/pr-radar</code></p>

## Why

PR Radar is for following PR stacks across repos and answering review threads without opening the browser, on any desktop OS, with a local browser tab and a read-only MCP server for your agents. Comparison with github.com/pulls, Gitify and PR Marmot: [docs/comparison.md](docs/comparison.md).

## Features

- PR tree per repo, with "depends on / blocks" stacks
- Review, CI and conflict status; CI jobs per workflow with re-run of failed jobs
- Unresolved review threads shown with the code, reply or resolve in place
- From the card: request reviewers, mark a draft ready, update a branch behind its base
- Other people's PRs where you are assigned, mentioned or involved
- Filters, search, ready-to-merge and stale PRs, new since your last visit
- Merge calendar: month, week, day
- Local web version ([docs/web.md](docs/web.md)) and read-only local MCP server for AI agents ([docs/mcp.md](docs/mcp.md)), both opt-in
- System notifications with Do not disturb and launch at login; runs in the menu bar or tray
- Quota-aware refresh, command palette `⌘K` / `Ctrl+K`, light / dark / auto theme, English and French UI

More: repo picker per organization, settings by category with a typo-tolerant search, automatic refreshes that reread only changed PRs (status dot next to Refresh), local activity log (redacted, with retention) and reviewed crash reports (Diagnostics settings), keyboard shortcuts `/` `j` `k` `o` `e` `d`, Quit from the tray menu (closing the window or ⌘Q on macOS keeps the app running).

## Download

- Download page: https://vlor999.github.io/pr-radar/
- Releases: https://github.com/Vlor999/pr-radar/releases
- Homebrew: `brew install --cask vlor999/tap/pr-radar`

## First launch

- macOS: the app is signed and notarized by Apple. Drag it to Applications, launch it, confirm "Open".
- Windows (SmartScreen): More info > Run anyway.

## GitHub sign-in

- **Sign in with GitHub** (device flow): no server, the token is stored in the system keychain.
- **Personal access token**: fine-grained (read Pull requests + Contents/Metadata; write Pull requests to reply, resolve threads and mark drafts ready; write Contents to update a PR branch; write Actions to re-run failed jobs) or classic with the `repo` scope (the `workflow` scope is only for editing workflow files). Also used for GitHub Enterprise.

Organization repos may require the organization to approve the OAuth app, or SSO authorization of the token.

## Privacy

No backend, no telemetry, no analytics. The app only talks to GitHub, to your GitHub Enterprise server if you add one, and to Slack if you connect it (read-only, tokens in the system keychain). Details: [docs/privacy.md](docs/privacy.md).

## Docs

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
