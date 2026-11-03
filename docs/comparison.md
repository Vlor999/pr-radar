# How PR Radar compares

As of October 2026, based on each product's public features. "?" means not compared here.

| | github.com/pulls | Gitify | PR Marmot | PR Radar |
|---|---|---|---|---|
| Platforms | any browser | macOS, Windows, Linux | macOS (signed builds for Apple silicon Macs), Linux and Intel Macs via a source build | macOS, Windows, Linux |
| Native desktop app | no | yes | yes | yes |
| Stacked PRs as a tree, across repos | one PR at a time | no | ? | yes |
| Reply to unresolved review threads from the list | by opening each PR | no | ? | yes |
| Native notifications | web only | yes | ? | yes |
| Merge calendar | no | no | ? | yes |
| Issues, releases, discussions | yes | yes | ? | PRs only |
| Open in a browser tab | yes | no | ? | yes (local, served by the app) |
| MCP server for AI agents | separate [GitHub MCP server](https://github.com/github/github-mcp-server) | no | ? | yes (local, read-only; macOS, Linux) |
| GitHub Enterprise | yes | yes | ? | yes (personal access token) |

## Where the alternatives win

- **github.com/pulls**: nothing to install, full review UI.
- **Gitify**: your whole notification inbox (issues, releases, discussions) in the menu bar.
- **PR Marmot**: a native desktop app, with signed builds for Apple silicon Macs (Linux and Intel Macs via a source build).

GitHub Enterprise is supported by github.com/pulls, Gitify and PR Radar alike, so it does not separate them.

## Why PR Radar

PR Radar is for following PR stacks across repos and answering review threads without opening the browser, on any desktop OS, with a local browser tab and a read-only MCP server for your agents.
