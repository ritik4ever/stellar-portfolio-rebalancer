/**
 * quarantine.ts
 *
 * Runtime helper for the flaky-test quarantine system.
 *
 * Usage inside a test file:
 *
 *   import { quarantineIf } from '../flaky/quarantine';
 *
 *   // Replace `it(` / `test(` with the wrapper:
 *   quarantineIf('my-test-slug', it)('does something timing-sensitive', async () => {
 *     // ...
 *   });
 *
 *   // Or use the convenience alias:
 *   import { qit, qtest } from '../flaky/quarantine';
 *   qit('my-test-slug', 'does something timing-sensitive', async () => { ... });
 *
 * When QUARANTINE_MODE=run (set in CI quarantine job) the wrapper does NOT skip
 * the test — this lets you run the quarantined suite in isolation to measure
 * whether a fix is ready.
 *
 * When a test's id is NOT in quarantine.json, the wrapper is a transparent
 * pass-through and the test runs normally.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { it, test, describe } from 'vitest';

// ---------------------------------------------------------------------------
// Load registry
// ---------------------------------------------------------------------------

interface QuarantineEntry {
  id: string;
  file: string;
  title: string;
  reason: string;
  issue: string;
  owner: string;
  quarantinedAt: string;
  reviewBy?: string;
}

interface QuarantineRegistry {
  quarantined: QuarantineEntry[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const registryPath = join(__dirname, 'quarantine.json');

let _registry: QuarantineRegistry | null = null;

function getRegistry(): QuarantineRegistry {
  if (!_registry) {
    try {
      _registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as QuarantineRegistry;
    } catch {
      console.warn('[quarantine] Could not read quarantine.json — treating all tests as active.');
      _registry = { quarantined: [] };
    }
  }
  return _registry;
}

function isQuarantined(id: string): QuarantineEntry | undefined {
  return getRegistry().quarantined.find((e) => e.id === id);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/**
 * QUARANTINE_MODE=skip  (default) — quarantined tests are skipped in CI.
 * QUARANTINE_MODE=run            — quarantined tests run (used in the nightly quarantine job).
 */
const mode = process.env.QUARANTINE_MODE ?? 'skip';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

type TestFn = typeof it;

/**
 * Wraps a vitest `it` / `test` function so that tests registered with a
 * quarantined `id` are skipped (or run, in quarantine-run mode).
 */
export function quarantineIf(id: string, testFn: TestFn): TestFn {
  const entry = isQuarantined(id);
  if (!entry) return testFn; // not quarantined — transparent pass-through

  if (mode === 'run') {
    // Run it but annotate with a console note so failures are visible.
    return ((title: string, fn: () => unknown, timeout?: number) => {
      console.info(
        `[quarantine:run] "${title}" (${id}) — issue: ${entry.issue} — owner: ${entry.owner}`
      );
      return testFn(title, fn, timeout);
    }) as TestFn;
  }

  // Default: skip and emit a note so maintainers see it in verbose output.
  return ((title: string, _fn: () => unknown, _timeout?: number) => {
    return testFn.skip(
      `[QUARANTINED] ${title} — reason: ${entry.reason} — issue: ${entry.issue}`,
      () => {}
    );
  }) as TestFn;
}

/**
 * Convenience: quarantineIf + it
 */
export function qit(
  id: string,
  title: string,
  fn: () => unknown,
  timeout?: number
): ReturnType<TestFn> {
  return quarantineIf(id, it)(title, fn as Parameters<TestFn>[1], timeout);
}

/**
 * Convenience: quarantineIf + test
 */
export function qtest(
  id: string,
  title: string,
  fn: () => unknown,
  timeout?: number
): ReturnType<TestFn> {
  return quarantineIf(id, test)(title, fn as Parameters<TestFn>[1], timeout);
}

export { it, test, describe };
export type { QuarantineEntry, QuarantineRegistry };
