# Privacy

No backend, no telemetry, no analytics. The app only talks to:

- GitHub: the API with your token, avatars, and update checks on github.com (your IP address and the app version);
- your GitHub Enterprise server, only if you add one: its API with your token;
- Slack, only if you connect it: read-only search, tokens in the system keychain. Messages are read on your machine and sent nowhere else.

## Local web version

Off by default. Listens on 127.0.0.1 only, not reachable from other devices. The link opened by the app carries a single-use ticket valid 60 seconds, exchanged for an HttpOnly, SameSite=Strict session cookie set by the local app. Sessions live in memory and "Sign out browsers" closes them all. Host and Origin are checked and there is no CORS, so other websites cannot call it. GitHub and Slack requests go through the app, to the same allowed hosts.

## Local MCP server

Off by default. No network port. The agent starts `pr-radar --mcp` (a stdio shim), which talks to the running app through a Unix socket (mode `0600`, created only when you turn the server on). Read-only: no tool writes to GitHub or Slack, and replies are the state the app already holds, with no extra request.

## Local data

Settings, followed repos and "seen" marks stay in the app's local storage. The activity log (Settings › Diagnostics, on by default) is written on your machine only, without PR titles, comments, Slack messages or tokens. A crash report is never sent by the app: it opens a prefilled GitHub issue in your browser that you review and submit yourself.

## Website

The [website](https://vlor999.github.io/pr-radar/) is hosted by GitHub Pages (which logs IP addresses), fetches the latest release from api.github.com in your browser, sets no cookies and only keeps your language choice in `localStorage`.
