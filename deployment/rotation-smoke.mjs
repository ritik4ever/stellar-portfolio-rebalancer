#!/usr/bin/env node
/**
 * Secret rotation smoke check (SPR-2026-280).
 *
 * Verifies, without ever printing a secret value, that:
 *   - the active provider key and the previous key overlap briefly during rotation, and
 *   - the notification worker is not still holding stale (previous/unknown) credentials.
 *
 * Inputs (environment variables, values are never logged):
 *   ROTATION_ACTIVE_KEY       current provider key (required)
 *   ROTATION_PREVIOUS_KEY     previous provider key still accepted during overlap (optional)
 *   ROTATION_WORKER_KEY       key currently loaded by the notification worker (required)
 *   ROTATION_ACTIVE_VERSION   optional non-secret label, e.g. "v7"
 *
 * Output: one JSON line with short SHA-256 fingerprints only.
 * Exit codes: 0 ok, 1 stale worker credentials, 2 invalid input.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function fingerprint(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

export function evaluateRotation(env = process.env) {
  const active = env.ROTATION_ACTIVE_KEY?.trim();
  const previous = env.ROTATION_PREVIOUS_KEY?.trim() || null;
  const worker = env.ROTATION_WORKER_KEY?.trim();
  const missing = [];
  if (!active) missing.push('ROTATION_ACTIVE_KEY');
  if (!worker) missing.push('ROTATION_WORKER_KEY');
  if (missing.length) {
    return { exitCode: 2, report: { status: 'invalid', error: `missing ${missing.join(', ')}` } };
  }
  if (previous && previous === active) {
    return {
      exitCode: 2,
      report: { status: 'invalid', error: 'ROTATION_PREVIOUS_KEY equals ROTATION_ACTIVE_KEY; rotation did not occur' },
    };
  }

  const report = {
    activeVersion: env.ROTATION_ACTIVE_VERSION?.trim() || null,
    activeFingerprint: fingerprint(active),
    previousFingerprint: previous ? fingerprint(previous) : null,
    workerFingerprint: fingerprint(worker),
    overlap: Boolean(previous),
  };

  if (worker === active) return { exitCode: 0, report: { status: 'ok', ...report } };
  const reason = previous && worker === previous ? 'worker holds previous key' : 'worker holds unknown key';
  return {
    exitCode: 1,
    report: {
      status: 'stale-worker',
      reason,
      recommendedAction: 'restart-worker-with-current-secret',
      ...report,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode, report } = evaluateRotation();
  console.log(JSON.stringify(report));
  process.exitCode = exitCode;
}
