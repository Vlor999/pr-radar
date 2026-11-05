# Changelog

All notable changes to PR Radar are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Linux arm64 (AppImage, .deb, .rpm) and Windows arm64 (installer) builds, linked from the download page.
- Timeline view in the calendar, now its default: every PR of your followed repos (yours and your teammates') as a line over 7 to 30 days, with reviews, comments, Slack messages, merges and closes, plus search, filters and per-PR hiding.

## [0.15.0] - 2026-11-03

### Added

- Slack conversation picker in settings: counts, search and filters, with a bounded, scrollable list.
- Slack to GitHub contact list: status, search and filters, bounded and scrollable.
- DM contacts and Slack names are cached locally, so the lists open without waiting for Slack.

### Fixed

- The local Slack cache is bounded and drops data from a previously connected Slack workspace.
- Slack names read after the conversation list are kept.
- Hidden chip labels no longer stretch the settings page past the Slack list.

### Security

- The Slack cache is never sent to the browser in the local web version.

## [0.14.0] - 2026-11-02

### Added

- Slack DM recipients of my PR mentions are matched to GitHub users and proposed first in the add-reviewer popover.
- Suggested Slack DM recipients appear as ghost reviewers on the PR card; a click fills the reviewer.
- Requesting a review no longer waits for GitHub to answer.
- Slack to GitHub mapping table under Settings > Accounts > Slack (one Slack contact to several GitHub accounts), with one-click confirmation of name matches.
- GitHub user search across followed repos for the mapping table.
- 1:1 DMs keep their contact, names and avatar in the Slack conversation list.

### Fixed

- Slack links are resolved per PR Radar account, and matches that share a login stay apart.
- Repos that are not accessible no longer break the assignable users lookup.
- Slack avatars load (Content Security Policy).
- Keyboard navigation in the add-reviewer results; ghost reviewer row aligned with the others.

## [0.13.0] - 2026-11-02

### Added

- Refresh status dot next to the Refresh button (ok, partial, failed); the button stays still on automatic refreshes.
- macOS: ⌘Q and closing the window send the app to the background instead of quitting.

### Changed

- Automatic refreshes read only new or changed PRs (fingerprint probe), and the auto refresh interval is based on the real GraphQL cost of each refresh. Far less GitHub quota used.

### Fixed

- A batch is re-read in full after a failed mention search.
- The refresh status is set only on requested refreshes, and turns amber when only review searches fail.
- No replayed green dot on remount, no stale merged-PR error in the tooltip.

## [0.12.0] - 2026-11-01

### Added

- Local activity log (refreshes, GitHub and Slack errors, actions, MCP calls): buffered, redacted, with folder and retention settings and a viewer in a new Diagnostic settings category.
- Crash reporting: crash banner after an unexpected exit, redacted and anonymized report preview, prefilled GitHub issue.
- Send feedback row in settings (GitHub Discussions and prefilled issue forms).
- MCP server: `get_attention`, `get_checks` and `get_merged` tools, filters on `get_prs`, prompts (including fix-ci), harness logo in the call history, compact responses.
- Settings show each account's sign-in method and the GitHub Enterprise host as a badge.

### Changed

- Dashboard and thread styling: solid colour for ready to merge, counts as text, opaque branch rails, radii sized per element.

### Fixed

- No false crash report after a system shutdown or logout; forced exit 5 s after SIGTERM or SIGHUP.
- MCP: stricter validation of PR URLs, prompt arguments and `get_prs` limits; failed or inverted `get_merged` ranges are reported.

### Security

- The activity log masks tokens and secret parameters, refuses symlinked log files and writes atomically.

## [0.11.0] - 2026-10-31

### Added

- Settings split into five categories with a search bar (accent-insensitive, tolerant of typos and prefixes).
- MCP server and web version pages moved into settings categories.

### Fixed

- Search highlights are cleared and clipped to their card; the opened row gets focus without a ring.

## [0.10.0] - 2026-10-31

### Added

- MCP setup: pick your client from a list (Codex, Cursor, Gemini CLI, VS Code, Windsurf, Zed, Google Antigravity, Devin Desktop and others) and copy its install snippet.
- Buy me a coffee link in the About section.

## [0.9.0] - 2026-10-31

### Added

- PRs from other people where I am assigned, mentioned or involved on followed repos, with a reason badge, placed in the stack tree.
- CI view in the expanded PR card: workflows and jobs, open from the CI badge, re-run failed jobs.
- PR actions from the card: mark a draft ready for review, update a branch behind its base, resolve a review thread.
- Command palette on ⌘K / Ctrl+K and keyboard shortcuts shown as key caps.
- Do not disturb from the settings and the tray, with quiet hours.
- Launch PR Radar at login.
- MCP `get_prs` explains why another person's PR is listed.

### Changed

- Approval, changes requested and CI notifications only for my own PRs.
- Slack mentions are searched for my own PRs only.
- The CI view opens instantly from its last read and is cached for 10 minutes.

### Fixed

- A failed mentions search no longer fails the whole account.
- A stale CI response no longer overwrites a newer view.
- Each shortcut combo is shown on a single key cap.

### Security

- Only https job links are kept in the CI view.

## [0.8.0] - 2026-10-30

### Added

- Local web version: open PR Radar in a browser tab served on 127.0.0.1, from the header, with its own settings.
- Local MCP server (`get_prs`, `get_pr`) with a page in the app and a call history.

### Security

- Web version: revocable sessions, one-time link tickets and strict server limits.
- MCP: third-party text flagged as untrusted in the tool metadata.

## [0.7.1] - 2026-10-27

### Changed

- Comments are rendered as GitHub HTML (code, links, suggestions) instead of plain text.

### Security

- Comment HTML is sanitized: images removed, only https links kept.

## [0.7.0] - 2026-10-27

### Added

- Auto refresh frequency, based on each account's GitHub quota (default for new installs).

### Fixed

- Quota of signed-out accounts is ignored and forgotten; the auto interval is recomputed on sign-out.
- The focus refresh is skipped while a refresh runs.

## [0.6.3] - 2026-10-27

### Added

- Reply to the pull request conversation.

### Fixed

- Slack sign-in redirects through the download site page. Slack sign-in from versions before 0.6.3 no longer works.

## [0.6.2] - 2026-10-26

### Added

- General PR comments and review bodies in the discussion panel.

## [0.6.1] - 2026-10-25

### Added

- Third-party license notices, disclaimer and license links in the About section.

### Changed

- Faster dashboard: lazy-loaded settings, fewer re-renders, lighter repo listing.

## [0.6.0] - 2026-10-22

### Added

- To review tab with the PRs waiting for my review, and notifications for new review requests.
- Add reviewers to my PRs from the card.
- Native GitHub stacks: parent, stacked filter and stack position badge.
- Option to skip notifications for draft PRs.

### Changed

- Faster release builds of the app.

### Fixed

- A repo or account that comes back empty once keeps its PRs; empty search results are retried.
- Review requests are tracked per account.
- GitHub's message is shown when a review request is refused.

## [0.5.0] - 2026-10-22

### Added

- Reviewers with avatars and state badges in PR details.
- Author avatars in threads, with alternating comment backgrounds.
- Force a refresh of Slack mentions from the settings.

## [0.4.0] - 2026-10-21

### Added

- Slack mentions: connect Slack, choose the conversations to watch, and see the messages that link to each open PR next to its card.
- Multiple GitHub accounts, including GitHub Enterprise Server.
- Tray icon with the count of PRs needing action; the app keeps running in the tray when the window closes.
- Single instance: relaunching shows the existing window.
- English interface, with a language setting and a first-launch picker.
- Sliding indicator for tabs, calendar views and segmented settings.

### Changed

- Repos where I have an open PR are listed in the sidebar.
- Threads shown as speech bubbles with a continuous rail to stacked PRs.

### Fixed

- One failing account no longer hides the PRs of the others, and only the account with a rejected token is signed out.
- Quit on close and normal start when the tray is unavailable.

## [0.3.6] - 2026-10-20

### Added

- GitHub quota gauge in settings, and a notification when it runs low.

### Changed

- Each refresh uses less GitHub quota and bandwidth.

### Security

- Strict Content Security Policy; `gh` resolved by absolute path first.

## [0.3.5] - 2026-10-20

### Changed

- Redesigned download site, with the detected platform's download highlighted.

## [0.3.4] - 2026-10-20

### Changed

- macOS builds are signed with a Developer ID and notarized by Apple: no Gatekeeper workaround needed.

## [0.3.3] - 2026-10-20

### Added

- Hide a repo or a whole org from the repo panel, and restore it from the list of hidden items.
- Repo panel moves to a drawer on narrow windows.

### Changed

- Compact, wrapping filter chips; sort on its own line; reply shortcut inside the send button.

## [0.3.2] - 2026-10-20

### Added

- Uninstall PR Radar from the settings: lists what will be removed (app, keychain token, data folders), then cleans up after quitting.

## [0.3.1] - 2026-10-20

### Added

- Notification test button in settings, with the last notification sent and a shortcut to the system settings.

### Fixed

- macOS: ad hoc signed builds are no longer reported as damaged on Apple Silicon.

## [0.3.0] - 2026-10-20

### Added

- In-app updates: banner with progress, check at launch and every 6 hours.
- Preview image when the download site link is shared.

### Changed

- New logo.

## [0.2.0] - 2026-10-20

### Added

- Settings page (gear icon or ⌘,): theme, refresh frequency, refresh on focus, notification types, default sort, stale and merged periods, data reset, shortcuts, update check.
- One-step GitHub sign-in with the OAuth device flow, and automatic reuse of the `gh` CLI account.
- Hint on how to request access when an organization blocks third-party OAuth apps.

## [0.1.0] - 2026-10-20

### Added

- First release: desktop app for macOS, Windows and Linux with GitHub sign-in (device flow or personal token in the OS keychain), PR tree with stacks, discussions with reply, filters, merge calendar and system notifications.

[Unreleased]: https://github.com/Vlor999/pr-radar/compare/v0.15.0...HEAD
[0.15.0]: https://github.com/Vlor999/pr-radar/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/Vlor999/pr-radar/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/Vlor999/pr-radar/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/Vlor999/pr-radar/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/Vlor999/pr-radar/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/Vlor999/pr-radar/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/Vlor999/pr-radar/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Vlor999/pr-radar/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/Vlor999/pr-radar/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/Vlor999/pr-radar/compare/v0.6.3...v0.7.0
[0.6.3]: https://github.com/Vlor999/pr-radar/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/Vlor999/pr-radar/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/Vlor999/pr-radar/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/Vlor999/pr-radar/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Vlor999/pr-radar/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Vlor999/pr-radar/compare/v0.3.6...v0.4.0
[0.3.6]: https://github.com/Vlor999/pr-radar/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/Vlor999/pr-radar/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/Vlor999/pr-radar/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/Vlor999/pr-radar/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/Vlor999/pr-radar/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Vlor999/pr-radar/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Vlor999/pr-radar/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Vlor999/pr-radar/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Vlor999/pr-radar/releases/tag/v0.1.0
