#!/bin/bash
# Validate .mcp.json configuration
set -e

CONFIG=".mcp.json"
if [ ! -f "$CONFIG" ]; then
  echo "INFO: $CONFIG not found — copy .mcp.json.example to .mcp.json"
  exit 0
fi

# Check for hardcoded absolute paths
if grep -qE '"/[a-zA-Z]' "$CONFIG"; then
  echo "WARNING: $CONFIG contains absolute paths — consider using relative paths"
  echo "Example: \"./packages/mcp/dist/index.js\" instead of \"/home/user/.../dist/index.js\""
fi

# Check for hardcoded AGENT_NAME
if grep -q '"AGENT_NAME"' "$CONFIG"; then
  echo "WARNING: $CONFIG has hardcoded AGENT_NAME — spawned agents will share identity"
  echo "Remove AGENT_NAME to let Runtime pass AGENT_TOKEN per-spawn"
fi

# Verify MCP entry point exists
MCP_PATH=$(node -e "const c=require('./$CONFIG'); console.log(c.mcpServers.flock.args[0])" 2>/dev/null || echo "")
if [ -n "$MCP_PATH" ]; then
  # Resolve relative path against project root
  RESOLVED="$MCP_PATH"
  if [[ "$MCP_PATH" != /* ]]; then
    RESOLVED="$(pwd)/$MCP_PATH"
  fi
  if [ ! -f "$RESOLVED" ]; then
    echo "ERROR: MCP entry point not found: $MCP_PATH"
    echo "Run 'npm run build -w @flock/mcp' first"
    exit 1
  fi
fi

echo "OK: $CONFIG configuration is valid"
