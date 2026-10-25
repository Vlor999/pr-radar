<p align="center"><img src="assets/logo/logo.svg" width="96" alt="PR Radar"></p>

<h1 align="center">PR Radar</h1>

<p align="center">Your open GitHub pull requests, as a tree: stacks, reviews, threads and merges, in a lightweight desktop app for macOS, Windows and Linux.</p>

<p align="center"><a href="https://vlor999.github.io/pr-radar/">Website</a> · <a href="https://github.com/Vlor999/pr-radar/releases/latest">Download</a> · <code>brew install --cask vlor999/tap/pr-radar</code></p>

## Features

- PR tree per repo, with "depends on / blocks" stacks
- Review, CI and conflict status
- Unresolved review threads shown with the code, reply in place
- Filters and search
- Ready-to-merge and stale PRs
- New since your last visit
- Merge calendar: month, week, day
- Repo picker per organization
- System notifications
- Light / dark / auto theme
- Keyboard shortcuts: `j` `k` `o` `e` `d`
- English and French UI

## Download

- Download page: https://vlor999.github.io/pr-radar/
- Releases: https://github.com/Vlor999/pr-radar/releases
- Homebrew: `brew install --cask vlor999/tap/pr-radar` (cask updated by the release CI, secret `HOMEBREW_TAP_TOKEN`)

## First launch

- macOS: the app is signed and notarized by Apple. Drag it to Applications, launch it, confirm "Open".
- Windows (SmartScreen): More info > Run anyway.

## GitHub sign-in

Two options:

1. **Sign in with GitHub** (device flow): no server, the token is stored in the system keychain.
2. **Personal access token**:
   - fine-grained: read access to Pull requests + Contents/Metadata, and write access to Pull requests to reply;
   - or classic with the `repo` scope.

Organization repos may require the organization to approve the OAuth app, or SSO authorization of the token.

## Privacy

No backend, no telemetry, no analytics. The app only talks to:

- GitHub: the API with your token, avatars, and update checks on github.com (your IP address and the app version);
- Slack, only if you connect it: read-only search, tokens in the system keychain. Messages are read on your machine and sent nowhere else.

Settings, followed repos and "seen" marks stay in the app's local storage. The [website](https://vlor999.github.io/pr-radar/) is hosted by GitHub Pages (which logs IP addresses), fetches the latest release from api.github.com in your browser, sets no cookies and only keeps your language choice in `localStorage`.

## How it compares

As of October 2026, based on each product's public features.

| | github.com/pulls | Gitify | PR Radar |
|---|---|---|---|
| Platforms | any browser | macOS, Windows, Linux | macOS, Windows, Linux |
| Stacked PRs as a tree, across repos | one PR at a time | no | yes |
| Reply to unresolved review threads from the list | by opening each PR | no | yes |
| Native notifications | web only | yes | yes |
| Merge calendar | no | no | yes |
| Issues, releases, discussions | yes | yes | PRs only |
| GitHub Enterprise | yes | yes | yes (personal access token) |

Where the alternatives win:

- **github.com/pulls**: nothing to install, full review UI, GitHub Enterprise.
- **Gitify**: your whole notification inbox (issues, releases, discussions) in the menu bar, GitHub Enterprise support.
- **PR Marmot**: a native desktop app, with signed builds for Apple silicon Macs (Linux and Intel Macs via a source build).

PR Radar is for following PR stacks across repos and answering review threads without opening the browser, on any desktop OS.

## Development

Prerequisites: Node 22+, Rust stable, [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev
npm test
```

Release: bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` on `dev`, then merge the `dev → main` PR. The release workflow creates the `vX.Y.Z` tag and the release (no manual tag).

### In-app updates

The app updates itself: it reads `latest.json` from the latest release, checks the signature against the public key in `src-tauri/tauri.conf.json`, installs, then restarts. CI signs each version with the private key stored in the repo secrets (`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Without this key, no update can ever be published for already-installed apps: keep a copy outside the repo.

### macOS signing

Without Apple secrets, macOS builds are ad-hoc signed (first launch: "Open Anyway" in Privacy & Security). With the `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` secrets (Developer ID Application certificate), the release signs and notarizes automatically: macOS then only shows "app downloaded from the internet".

## License

MIT, see [LICENSE](LICENSE). Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (`npm run notices` regenerates it). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

PR Radar is provided as is, without warranty (MIT license). Not affiliated with GitHub or Slack. GitHub, Slack, macOS, Windows and Linux are trademarks of their respective owners.
