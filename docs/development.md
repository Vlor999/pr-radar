# Development

Prerequisites: Node 22+, Rust stable, [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev
npm test
```

## Release

Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` on `dev`, then merge the `dev → main` PR. The release workflow creates the `vX.Y.Z` tag and the release (no manual tag). Homebrew cask `vlor999/tap/pr-radar` is updated by the release CI (secret `HOMEBREW_TAP_TOKEN`).

## In-app updates

The app updates itself: it reads `latest.json` from the latest release, checks the signature against the public key in `src-tauri/tauri.conf.json`, installs, then restarts. CI signs each version with the private key stored in the repo secrets (`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Without this key, no update can ever be published for already-installed apps: keep a copy outside the repo.

## macOS signing

Without Apple secrets, macOS builds are ad-hoc signed (first launch: "Open Anyway" in Privacy & Security). With the `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` secrets (Developer ID Application certificate), the release signs and notarizes automatically: macOS then only shows "app downloaded from the internet". See [apple-notarization.md](apple-notarization.md).
