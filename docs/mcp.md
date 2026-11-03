# Local MCP server

Off by default. Runs only while the app runs. macOS and Linux. Read-only.

## Setup

Click the plug icon next to the gear and turn the server on. The Setup section picks your client (Claude Code, Claude Desktop, Antigravity, Codex, Cursor, Devin Desktop, Gemini CLI, VS Code, Windsurf, Zed or any other) and gives the ready-to-paste command or config, with the real path of the app and where to paste it.

Examples (macOS, the path depends on your install):

Claude Code, once:

```sh
claude mcp add --scope user pr-radar -- '/Applications/PR Radar.app/Contents/MacOS/pr-radar' --mcp
```

Claude Desktop: add this to `claude_desktop_config.json` (Settings › Developer › Edit Config), then restart Claude Desktop:

```json
{ "mcpServers": { "pr-radar": { "command": "/Applications/PR Radar.app/Contents/MacOS/pr-radar", "args": ["--mcp"] } } }
```

Other clients: copy the command or config shown in the app's Setup section. Any other MCP client: declare `<path to pr-radar> --mcp` as a stdio command.

## Tools

All tools are read-only.

| Tool | Parameters | Returns |
|---|---|---|
| `get_prs` | optional `repo`, `scope`, `needs_action`, `limit` | Open PRs with CI, decision, conflicts, reviewers, size, unresolved threads, stack, Slack mentions. Yours plus other people's PRs where you are assigned, mentioned or involved (with an `involved` field), and the "To review" tab. |
| `get_pr` | `url` | Unresolved review threads and conversation of one PR of the tree. |
| `get_attention` | optional `repo` | Short list of what needs an action from you, one item per PR with its reasons and age. Review requests and CI failures first, then oldest. |
| `get_checks` | `url` | CI jobs of one PR with state, workflow, duration and link of failing jobs. Served only from the CI view already opened in the app: otherwise it answers `notLoaded` and points to `gh pr checks`. |
| `get_merged` | optional `from`, `to` (`YYYY-MM-DD`, UTC), `repo` | Your PRs merged in the loaded window (setting "Recently merged"), with `leadTime` from creation to merge as `45m` / `5h` / `3d` and `stats` (count, median, p90). |

## Prompts

Shown as commands by MCP clients (Claude Code: `/mcp__pr-radar__<name>`). They tell the agent which tools to call.

| Prompt | Parameters | What it does |
|---|---|---|
| `triage` | none | Prioritized action list from `get_attention`, then `get_pr` on the top items (at most 5). |
| `review-queue` | none | PRs waiting for your review (`get_prs` with scope `reviews`), oldest first, with a one-line suggestion each. |
| `fix-ci` | `url` | Finds the failing checks with `get_checks`, else `gh`, and fixes them in the local checkout. |
| `answer-threads` | `url` | A reply or code change per unresolved thread, nothing posted without your confirmation. |
| `standup` | optional `repo` | Short update from your open PRs. |

## Call log

The last 50 calls are listed in the app, without the content of the replies.

Security model: see [privacy.md](privacy.md#local-mcp-server).
