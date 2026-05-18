#!/bin/bash
# Validate that v2 .mcp.json does not point to v1 paths
set -e

CONFIG=".mcp.json"
if [ ! -f "$CONFIG" ]; then
  echo "ERROR: $CONFIG not found"
  exit 1
fi

# Check for old v1 paths
if grep -q '/Agent-Larked/' "$CONFIG" && ! grep -q '/Agent-Larked-v2/' "$CONFIG"; then
  echo "ERROR: $CONFIG points to v1 paths (/Agent-Larked/ instead of /Agent-Larked-v2/)"
  echo "Contents:"
  cat "$CONFIG"
  exit 1
fi

# Check for hardcoded AGENT_NAME
if grep -q '"AGENT_NAME"' "$CONFIG"; then
  echo "WARNING: $CONFIG has hardcoded AGENT_NAME — spawned agents will share identity"
  echo "Remove AGENT_NAME to let Runtime pass AGENT_TOKEN per-spawn"
fi

# Verify MCP entry point exists
MCP_PATH=$(node -e "const c=require('./$CONFIG'); console.log(c.mcpServers.flock.args[0])" 2>/dev/null || echo "")
if [ -n "$MCP_PATH" ] && [ ! -f "$MCP_PATH" ]; then
  echo "ERROR: MCP entry point not found: $MCP_PATH"
  echo "Run 'npm run build -w @flock/mcp' first"
  exit 1
fi

echo "OK: $CONFIG paths are valid"
