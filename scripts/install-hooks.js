#!/usr/bin/env node
/**
 * Installs git hooks for the project.
 * Runs automatically via npm's "prepare" lifecycle script.
 * Skipped in CI environments where hooks aren't needed.
 */
const fs = require('fs');
const path = require('path');

// Skip in CI
if (process.env.CI) {
  process.exit(0);
}

const gitDir = path.resolve(__dirname, '..', '.git');
const hooksDir = path.join(gitDir, 'hooks');

if (!fs.existsSync(hooksDir)) {
  console.log('No .git/hooks directory found, skipping hook installation');
  process.exit(0);
}

const prePushHook = `#!/bin/sh
# Verify package-lock.json is in sync with package.json before pushing.
# This prevents CI failures from out-of-sync lock files (a recurring issue
# caused by merge conflict resolution dropping dependencies).

echo "pre-push: verifying package-lock.json is in sync..."

# Quick check: does npm ci --dry-run succeed?
npm ci --dry-run --silent 2>/dev/null
if [ $? -ne 0 ]; then
  echo ""
  echo "ERROR: package-lock.json is out of sync with package.json!"
  echo ""
  echo "This will cause CI to fail. To fix:"
  echo "  npm install"
  echo "  git add package-lock.json"
  echo "  git commit -m 'fix: sync package-lock.json'"
  echo ""
  exit 1
fi

echo "pre-push: lock file OK"
`;

const hookPath = path.join(hooksDir, 'pre-push');
fs.writeFileSync(hookPath, prePushHook, { mode: 0o755 });
console.log('Installed pre-push hook (package-lock.json sync check)');
