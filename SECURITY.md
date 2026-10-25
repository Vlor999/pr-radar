# Security policy

## Supported versions

Only the latest release gets security fixes. The app updates itself, so staying current is enough.

## Reporting a vulnerability

Please do not open a public issue. Report it privately on GitHub: [Security > Report a vulnerability](https://github.com/Vlor999/pr-radar/security/advisories/new).

Include the version, your OS, and the steps to reproduce. You should get a first answer within about 7 days. PR Radar is maintained by one person in their free time, so this is a target, not a guarantee.

Especially relevant: anything that could leak the GitHub or Slack tokens stored in the system keychain, the `prradar://` deep link, and the update signature check.
