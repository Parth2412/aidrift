#!/usr/bin/env sh
set -eu

git config core.hooksPath .githooks
chmod +x .githooks/commit-msg

echo "Configured Git hooks for AIDRIFT."
