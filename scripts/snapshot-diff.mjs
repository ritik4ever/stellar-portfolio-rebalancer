#!/usr/bin/env node
/**
 * snapshot-diff.mjs
 *
 * Compare Soroban contract test snapshots before and after an upgrade.
 * Usage:
 *   node scripts/snapshot-diff.mjs <before> <after> [--json]
 *
 * <before> and <after> can each be a snapshot file (.json) or a directory
 * of snapshot files. When directories are given, files are matched by name.
 *
 * Exit codes:
 *   0 – no differences found
 *   1 – differences found (or error)
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, basename, extname } from "path";

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const paths = args.filter((a) => !a.startsWith("--"));

if (paths.length !== 2) {
  console.error("Usage: node scripts/snapshot-diff.mjs <before> <after> [--json]");
  process.exit(1);
}

const [beforePath, afterPath] = paths.map((p) => resolve(p));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function loadSnapshot(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (e) {
    console.error(`Failed to parse ${filePath}: ${e.message}`);
    process.exit(1);
  }
}

function snapshotFiles(dir) {
  return readdirSync(dir)
    .filter((f) => extname(f) === ".json")
    .sort();
}

/**
 * Deep-diff two JSON values. Returns an array of change descriptors:
 *   { path, before, after }
 */
function diff(before, after, path = "") {
  const changes = [];

  if (typeof before !== typeof after) {
    changes.push({ path: path || "(root)", before, after });
    return changes;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const len = Math.max(before.length, after.length);
    for (let i = 0; i < len; i++) {
      changes.push(...diff(before[i], after[i], `${path}[${i}]`));
    }
    return changes;
  }

  if (before !== null && after !== null && typeof before === "object" && !Array.isArray(before)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      changes.push(...diff(before[key], after[key], path ? `${path}.${key}` : key));
    }
    return changes;
  }

  if (before !== after) {
    changes.push({ path: path || "(root)", before, after });
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Build file pairs to compare
// ---------------------------------------------------------------------------

let pairs = []; // [{ name, beforeFile, afterFile }]

if (isDir(beforePath) && isDir(afterPath)) {
  const beforeFiles = new Set(snapshotFiles(beforePath));
  const afterFiles = new Set(snapshotFiles(afterPath));
  const allFiles = new Set([...beforeFiles, ...afterFiles]);

  for (const file of allFiles) {
    pairs.push({
      name: file,
      beforeFile: beforeFiles.has(file) ? resolve(beforePath, file) : null,
      afterFile: afterFiles.has(file) ? resolve(afterPath, file) : null,
    });
  }
} else if (!isDir(beforePath) && !isDir(afterPath)) {
  pairs.push({
    name: basename(beforePath),
    beforeFile: beforePath,
    afterFile: afterPath,
  });
} else {
  console.error("Both arguments must be the same type (both files or both directories).");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Run diffs
// ---------------------------------------------------------------------------

const results = [];

for (const { name, beforeFile, afterFile } of pairs) {
  if (!beforeFile) {
    results.push({ name, status: "added", changes: [] });
    continue;
  }
  if (!afterFile) {
    results.push({ name, status: "removed", changes: [] });
    continue;
  }

  const before = loadSnapshot(beforeFile);
  const after = loadSnapshot(afterFile);
  const changes = diff(before, after);
  results.push({ name, status: changes.length === 0 ? "unchanged" : "changed", changes });
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (jsonOutput) {
  console.log(JSON.stringify(results, null, 2));
} else {
  let hasDiff = false;

  for (const { name, status, changes } of results) {
    if (status === "unchanged") continue;
    hasDiff = true;

    if (status === "added") {
      console.log(`\n+ ADDED   ${name}`);
      continue;
    }
    if (status === "removed") {
      console.log(`\n- REMOVED ${name}`);
      continue;
    }

    console.log(`\n~ CHANGED ${name}  (${changes.length} difference${changes.length !== 1 ? "s" : ""})`);
    for (const { path, before, after } of changes) {
      console.log(`  path : ${path}`);
      console.log(`  before: ${JSON.stringify(before)}`);
      console.log(`  after : ${JSON.stringify(after)}`);
    }
  }

  if (!hasDiff) {
    console.log("No differences found.");
  }
}

const hasDiff = results.some((r) => r.status !== "unchanged");
process.exit(hasDiff ? 1 : 0);
