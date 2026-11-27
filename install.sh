#!/bin/bash
# Installs the task-progress progress bar for Claude Code.
# Run it with:  bash ~/Downloads/task-progress/install.sh
set -eu

here="$(cd "$(dirname "$0")" && pwd)"
dest="$HOME/.claude/mods/claude-progress-bar"

# Find Claude Code's `claude` command.
claude_bin="$(command -v claude 2>/dev/null || true)"
if [ -z "$claude_bin" ]; then
  for c in "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
    if [ -x "$c" ]; then claude_bin="$c"; break; fi
  done
fi
if [ -z "$claude_bin" ]; then
  found="$("${SHELL:-/bin/zsh}" -ilc 'command -v claude' 2>/dev/null | tail -n 1 || true)"
  if [ -n "$found" ] && [ -x "$found" ]; then claude_bin="$found"; fi
fi
if [ -z "$claude_bin" ]; then
  echo "Claude Code isn't installed on this computer yet (there is no 'claude' command)."
  echo "Install it from https://claude.com/claude-code, then run this again."
  exit 1
fi

# Keep a copy in a fixed place, so the download can be deleted afterwards.
if [ "$here" != "$dest" ]; then
  mkdir -p "$dest"
  cp -R "$here/." "$dest/"
fi

"$claude_bin" plugin install task-progress --marketplace "$dest" -y

echo
echo "Done. Start a new Claude Code session to see the progress bar."
echo "You can delete the task-progress download now."
