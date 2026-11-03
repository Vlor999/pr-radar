#!/usr/bin/env bash
# Print the body of the `## [<version>]` section of CHANGELOG.md (release notes).
# Usage: scripts/changelog-section.sh <version> [changelog file]
# Exits 1 when the section is missing or has no list entry.
set -euo pipefail

version=${1:?usage: changelog-section.sh <version> [file]}
file=${2:-CHANGELOG.md}

# from the version heading to the next `## [` heading or the link references (CRLF tolerated)
section=$(tr -d '\r' < "$file" | awk -v h="## [$version]" '
  found && (/^## \[/ || /^\[[^]]+\]: /) { exit }
  found { print }
  index($0, h) == 1 { found = 1 }
' | sed '/./,$!d')  # drop leading blank lines; $() drops trailing ones

# a section with headings only (e.g. an empty `### Added`) has no notes
if ! grep -qE '^[-*] ' <<<"$section"; then
  echo "$file has no notes for $version: add a '## [$version] - YYYY-MM-DD' section" >&2
  exit 1
fi
printf '%s\n' "$section"
