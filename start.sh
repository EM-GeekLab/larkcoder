#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

CONFIG_FILE="${CONFIG_PATH:-.larkcoder/config.yaml}"

# Check bun
if ! command -v bun &>/dev/null; then
  echo "Error: bun is not installed. See https://bun.sh" >&2
  exit 1
fi

# Check config
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Config file not found: $CONFIG_FILE"
  echo "Creating from template..."
  mkdir -p "$(dirname "$CONFIG_FILE")"
  cp config.example.yaml "$CONFIG_FILE"
  echo "Please edit $CONFIG_FILE and fill in your Lark app credentials, then re-run this script."
  exit 1
fi

# Install dependencies
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  bun install
fi

# Start
echo "Starting LarkCoder..."
exec bun run dev
