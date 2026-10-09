#!/usr/bin/env bash
# Store the OpenAI API key for the AI assistant in the live site's site_config.json.
#
#   ./ops/set-openai-key.sh /path/to/file-containing-the-key
#
# The key is read from the file, never from the command line or the chat, and it
# is never printed. site_config.json is not in git and is read by
# di.ai.config.get_settings() when DI AI Settings.api_key is blank.
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

KEY_FILE="${1:-}"
if [[ -z "$KEY_FILE" || ! -f "$KEY_FILE" ]]; then
  echo "Usage: $0 <file containing only the OpenAI API key>" >&2
  exit 1
fi
KEY="$(tr -d '[:space:]' < "$KEY_FILE")"
if [[ ! "$KEY" =~ ^sk- ]]; then
  echo "The file does not look like it holds an OpenAI key (expected it to start with sk-)." >&2
  exit 1
fi

# Pass the key on stdin so it never appears in a process list on either machine.
printf '%s' "$KEY" | ssh_run "sudo -u frappe bash -lc 'cd $BENCH && key=\$(cat) && bench --site $SITE set-config openai_api_key \"\$key\" >/dev/null && echo set'"
echo "openai_api_key stored for $SITE. Wait about a minute (site config is cached per worker), then enable the assistant on DI AI Settings and press Test connection."
