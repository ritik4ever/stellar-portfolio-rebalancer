#!/usr/bin/env node
/**
 * Secret rotation smoke check (SPR-2026-280, SPR-2026-279).
 *
 * Verifies, without ever printing a secret value, that:
 *   - the active provider key and the previous key overlap briefly during rotation, and
 *   - the notification worker is not still holding stale (previous/unknown) credentials.
 *
 * Every run reports a small, stable outcome signal so operators and automation can
 * tell success, a transient delay, and blocked work apart without re-running the check:
 *   success         – the worker uses the active key; no owner action.
 *   transient_delay – the worker still holds the previous key while the overlap
 *                     window is open; wait for its credential refresh.
 *   blocked         – the worker holds an unknown key, or the previous key after the
 *                     overlap closed; restart/reload it. Invalid input is also blocked.
 *
 * Inputs (environment variables, values are never logged):
 *   ROTATION_ACTIVE_KEY       current provider key (required)
 *   ROTATION_PREVIOUS_KEY     previous provider key still accepted during overlap (optional)
 *   ROTATION_WORKER_KEY       key currently loaded by the notification worker (required)
 *   ROTATION_ACTIVE_VERSION   optional non-secret label, e.g. "v7"
 *   ROTATION_OVERLAP_OPEN     optional "true" (default) or "false"; set "false" once
 *                             the previous key is no longer accepted
 *
 * Output: one JSON line with short SHA-256 fingerprints only.
 * Exit codes: 0 ok, 1 stale worker credentials (transient delay or blocked), 2 invalid input.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const OUTCOMES = Object.freeze({
  SUCCESS: 'success',
  TRANSIENT_DELAY: 'transient_delay',
  BLOCKED: 'blocked',
});

export const OWNER_ACTIONS = Object.freeze({
  WAIT_FOR_WORKER_REFRESH: 'wait_for_worker_credential_refresh',
  RESTART_WORKER: 'restart_notification_worker',
  FIX_INPUTS: 'fix_rotation_inputs',
});

export function fingerprint(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

function invalidReport(error) {
  return {
    exitCode: 2,
    report: {
      status: 'invalid',
      outcome: OUTCOMES.BLOCKED,
      ownerAction: OWNER_ACTIONS.FIX_INPUTS,
      detail: error,
      error,
    },
  };
}

export function evaluateRotation(env = process.env) {
  const active = env.ROTATION_ACTIVE_KEY?.trim();
  const previous = env.ROTATION_PREVIOUS_KEY?.trim() || null;
  const worker = env.ROTATION_WORKER_KEY?.trim();
  const missing = [];
  if (!active) missing.push('ROTATION_ACTIVE_KEY');
  if (!worker) missing.push('ROTATION_WORKER_KEY');
  if (missing.length) {
    return invalidReport(`missing ${missing.join(', ')}`);
  }

  let overlapOpen = true;
  if (env.ROTATION_OVERLAP_OPEN !== undefined) {
    const rawOverlapFlag = env.ROTATION_OVERLAP_OPEN.trim().toLowerCase();
    if (rawOverlapFlag !== 'true' && rawOverlapFlag !== 'false') {
      return invalidReport('ROTATION_OVERLAP_OPEN must be "true" or "false"');
    }
    overlapOpen = rawOverlapFlag === 'true';
  }

  if (previous && previous === active) {
    return invalidReport(
      'ROTATION_PREVIOUS_KEY equals ROTATION_ACTIVE_KEY; rotation did not occur',
    );
  }

  const report = {
    activeVersion: env.ROTATION_ACTIVE_VERSION?.trim() || null,
    activeFingerprint: fingerprint(active),
    previousFingerprint: previous ? fingerprint(previous) : null,
    workerFingerprint: fingerprint(worker),
    overlap: Boolean(previous) && overlapOpen,
  };

  if (worker === active) {
    return {
      exitCode: 0,
      report: {
        status: 'ok',
        outcome: OUTCOMES.SUCCESS,
        ownerAction: null,
        detail: 'Notification worker is using the active provider key.',
        workerCredentialState: 'current',
        ...report,
      },
    };
  }

  if (previous && worker === previous && overlapOpen) {
    return {
      exitCode: 1,
      report: {
        status: 'stale-worker',
        reason: 'worker holds previous key',
        outcome: OUTCOMES.TRANSIENT_DELAY,
        ownerAction: OWNER_ACTIONS.WAIT_FOR_WORKER_REFRESH,
        recommendedAction: 'restart-worker-with-current-secret',
        detail:
          'Notification worker still holds the previous key while the rotation overlap window is open. ' +
          'Wait for the background credential refresh (about 4 minutes) or call ' +
          'POST /api/ops/credentials/refresh before the previous key is revoked.',
        workerCredentialState: 'previous',
        ...report,
      },
    };
  }

  if (previous && worker === previous) {
    return {
      exitCode: 1,
      report: {
        status: 'stale-worker',
        reason: 'worker holds previous key after overlap closed',
        outcome: OUTCOMES.BLOCKED,
        ownerAction: OWNER_ACTIONS.RESTART_WORKER,
        recommendedAction: 'restart-worker-with-current-secret',
        detail:
          'Notification worker still holds the previous key after the overlap window closed. ' +
          'Restart the notification worker so it reloads the active key, then re-run this check.',
        workerCredentialState: 'previous',
        ...report,
      },
    };
  }

  return {
    exitCode: 1,
    report: {
      status: 'stale-worker',
      reason: 'worker holds unknown key',
      outcome: OUTCOMES.BLOCKED,
      ownerAction: OWNER_ACTIONS.RESTART_WORKER,
      recommendedAction: 'restart-worker-with-current-secret',
      detail:
        'Notification worker holds a key that matches neither the active nor the previous version. ' +
        'Restart the notification worker so it reloads the active key, then re-run this check.',
      workerCredentialState: 'unknown',
      ...report,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode, report } = evaluateRotation();
  console.log(JSON.stringify(report));
  process.exitCode = exitCode;
}
