#!/bin/bash
# Reset staging environment
# Usage: ./scripts/reset-staging.sh [data_path]

DATA_PATH="${1:-./data}"

if [ -d "$DATA_PATH" ]; then
  rm -rf "$DATA_PATH"/*
  echo "✅ Staging data reset"
else
  echo "No data directory found at $DATA_PATH"
fi
