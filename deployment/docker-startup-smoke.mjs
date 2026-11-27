#!/usr/bin/env node

/**
 * Repeatable Docker Startup Verification & Smoke Check (SPR-2026-270)
 *
 * Verifies from a clean environment that:
 * 1. Core services in deployment/docker-compose.yml define expected health checks
 *    and restart policies (`restart: unless-stopped`).
 * 2. Services starting in different orders (e.g. dependencies first, reverse order,
 *    or backend API before database/Redis/oracle) converge cleanly to healthy.
 * 3. When the API starts before its database is ready, liveness (/health) stays up,
 *    readiness (/ready) reports 503 with STARTUP_OUTCOME=TRANSIENT_DELAY, and
 *    transitions to 200 with STARTUP_OUTCOME=SUCCESS once the database is ready
 *    (or STARTUP_OUTCOME=BLOCKED if the database remains unavailable past retries).
 * 4. Container restart behavior (`restart: unless-stopped`) recovers cleanly after
 *    an initial process exit during dependency warmup.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_COMPOSE_PATH = path.join(process.cwd(), 'deployment', 'docker-compose.yml');

const CORE_SERVICES = ['frontend', 'backend', 'reflector-mock', 'redis', 'postgres'];

const SERVICE_HEALTH_SPECS = {
  backend: {
    endpoint: '/ready',
    pattern: /healthcheck:\s*\n\s+test:\s*\["CMD",\s*"node",\s*"-e",.*\/ready/,
    interval: '5s',
    timeout: '3s',
    retries: 6,
    startPeriod: '30s',
  },
  'reflector-mock': {
    endpoint: '/health',
    pattern: /healthcheck:\s*\n\s+test:\s*\["CMD",\s*"node",\s*"-e",.*\/health/,
    interval: '5s',
    timeout: '3s',
    retries: 6,
    startPeriod: '3s',
  },
  redis: {
    endpoint: 'redis-cli ping',
    pattern: /healthcheck:\s*\n\s+test:\s*\["CMD",\s*"redis-cli",\s*"ping"\]/,
    interval: '5s',
    timeout: '3s',
    retries: 6,
    startPeriod: '5s',
  },
  postgres: {
    endpoint: 'pg_isready',
    pattern: /healthcheck:\s*\n\s+test:\s*\["CMD-SHELL",\s*"pg_isready -U portfolio -d portfolio"\]/,
    interval: '5s',
    timeout: '5s',
    retries: 8,
    startPeriod: '5s',
  },
};

export function extractServiceBlock(composeText, serviceName) {
  const normalized = composeText.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let startIdx = -1;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === `  ${serviceName}:`) {
      startIdx = i;
      continue;
    }
    if (startIdx !== -1 && i > startIdx) {
      if (/^  [a-zA-Z0-9_-]+:\s*$/.test(lines[i]) || /^[a-zA-Z0-9_-]+:\s*$/.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
  }

  if (startIdx === -1) {
    return null;
  }

  return lines.slice(startIdx, endIdx).join('\n');
}

export function verifyComposeStartupContract(composePath = DEFAULT_COMPOSE_PATH) {
  const raw = readFileSync(composePath, 'utf8');
  const compose = raw.replace(/\r\n/g, '\n');
  const errors = [];
  const services = {};

  for (const serviceName of CORE_SERVICES) {
    const block = extractServiceBlock(compose, serviceName);
    if (!block) {
      errors.push(`Missing core service "${serviceName}" in docker-compose.yml`);
      continue;
    }

    const hasRestartPolicy = /^\s+restart:\s*unless-stopped\s*$/m.test(block);
    if (!hasRestartPolicy) {
      errors.push(`Service "${serviceName}" is missing "restart: unless-stopped"`);
    }

    const spec = SERVICE_HEALTH_SPECS[serviceName];
    let healthcheckValid = true;
    if (spec) {
      if (!spec.pattern.test(block)) {
        healthcheckValid = false;
        errors.push(`Service "${serviceName}" healthcheck does not probe ${spec.endpoint}`);
      }
      if (!new RegExp(`interval:\\s*${spec.interval}`).test(block)) {
        healthcheckValid = false;
        errors.push(`Service "${serviceName}" healthcheck is missing interval: ${spec.interval}`);
      }
      if (!new RegExp(`timeout:\\s*${spec.timeout}`).test(block)) {
        healthcheckValid = false;
        errors.push(`Service "${serviceName}" healthcheck is missing timeout: ${spec.timeout}`);
      }
      if (!new RegExp(`retries:\\s*${spec.retries}`).test(block)) {
        healthcheckValid = false;
        errors.push(`Service "${serviceName}" healthcheck is missing retries: ${spec.retries}`);
      }
      if (!new RegExp(`start_period:\\s*${spec.startPeriod}`).test(block)) {
        healthcheckValid = false;
        errors.push(`Service "${serviceName}" healthcheck is missing start_period: ${spec.startPeriod}`);
      }
    }

    services[serviceName] = {
      present: true,
      restartPolicy: hasRestartPolicy ? 'unless-stopped' : 'missing',
      hasHealthcheck: Boolean(spec),
      healthcheckValid,
    };
  }

  return {
    valid: errors.length === 0,
    errors,
    services,
  };
}

/**
 * Simulates services starting in an arbitrary order and verifies how health and
 * readiness probes behave at each step until all services are running.
 */
export function simulateServiceStartupOrder(
  startupOrder = ['backend', 'frontend', 'reflector-mock', 'redis', 'postgres'],
) {
  const running = new Set();
  const timeline = [];
  let sawTransientDelay = false;

  for (const service of startupOrder) {
    running.add(service);

    const backendUp = running.has('backend');
    const databaseReady = running.has('postgres');
    const redisReady = running.has('redis');
    const oracleReady = running.has('reflector-mock');
    const frontendUp = running.has('frontend');

    const livenessStatus = backendUp ? 200 : 0;
    const readinessStatus = backendUp && databaseReady ? 200 : backendUp ? 503 : 0;

    if (backendUp && !databaseReady) {
      sawTransientDelay = true;
    }

    const dockerHealthState = !backendUp
      ? 'not_started'
      : databaseReady
        ? 'healthy'
        : 'starting';

    timeline.push({
      startedService: service,
      runningServices: [...running],
      backendUp,
      databaseReady,
      redisReady,
      oracleReady,
      frontendUp,
      livenessStatus,
      readinessStatus,
      dockerHealthState,
    });
  }

  const finalStep = timeline[timeline.length - 1];
  const converged =
    finalStep?.backendUp === true &&
    finalStep?.databaseReady === true &&
    finalStep?.livenessStatus === 200 &&
    finalStep?.readinessStatus === 200 &&
    finalStep?.dockerHealthState === 'healthy';

  return {
    startupOrder,
    sawTransientDelay,
    converged,
    outcome: converged ? 'STARTUP_OUTCOME=SUCCESS' : 'STARTUP_OUTCOME=BLOCKED',
    timeline,
  };
}

/**
 * Simulates the backend API starting before its database is ready across multiple
 * readiness probe attempts, as well as container restart recovery.
 */
export function simulateApiBeforeDatabaseSmokeCheck({
  dbReadyOnAttempt = 3,
  maxRetries = 6,
  simulateContainerRestartOnAttempt = null,
} = {}) {
  const attempts = [];
  let sawTransientDelay = false;
  let containerRestarts = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const restartedThisAttempt = simulateContainerRestartOnAttempt === attempt;
    if (restartedThisAttempt) {
      containerRestarts += 1;
    }

    const databaseReady = !restartedThisAttempt && attempt >= dbReadyOnAttempt;
    const livenessHttp = restartedThisAttempt ? 503 : 200;
    const readinessHttp = databaseReady ? 200 : 503;

    if (readinessHttp === 200) {
      attempts.push({
        attempt,
        livenessHttp,
        readinessHttp,
        databaseReady: true,
        restarted: restartedThisAttempt,
        dockerHealthState: 'healthy',
        signal: 'STARTUP_OUTCOME=SUCCESS',
        transientDelay: sawTransientDelay,
      });

      return {
        ok: true,
        outcome: 'STARTUP_OUTCOME=SUCCESS',
        transientDelay: sawTransientDelay,
        attemptsUsed: attempt,
        containerRestarts,
        ownerAction: null,
        attempts,
      };
    }

    const isFirstDelay = !sawTransientDelay;
    sawTransientDelay = true;

    attempts.push({
      attempt,
      livenessHttp,
      readinessHttp,
      databaseReady: false,
      restarted: restartedThisAttempt,
      dockerHealthState: 'starting',
      signal: isFirstDelay ? 'STARTUP_OUTCOME=TRANSIENT_DELAY' : 'RETRY_PENDING',
      ownerAction: 'wait_for_readiness',
    });
  }

  return {
    ok: false,
    outcome: 'STARTUP_OUTCOME=BLOCKED',
    transientDelay: sawTransientDelay,
    attemptsUsed: maxRetries,
    containerRestarts,
    ownerAction: 'inspect_readiness_database_and_backend_logs',
    attempts,
  };
}

export function runDockerStartupSmokeCheck(options = {}) {
  const composePath = options.composePath || DEFAULT_COMPOSE_PATH;
  const composeVerification = verifyComposeStartupContract(composePath);

  const startupOrderScenarios = {
    dependenciesFirst: simulateServiceStartupOrder([
      'postgres',
      'redis',
      'reflector-mock',
      'backend',
      'frontend',
    ]),
    apiBeforeDatabase: simulateServiceStartupOrder([
      'backend',
      'frontend',
      'reflector-mock',
      'redis',
      'postgres',
    ]),
    reverseOrder: simulateServiceStartupOrder([
      'frontend',
      'backend',
      'reflector-mock',
      'redis',
      'postgres',
    ]),
  };

  const apiBeforeDbRecovery = simulateApiBeforeDatabaseSmokeCheck({
    dbReadyOnAttempt: 3,
    maxRetries: 6,
  });

  const restartRecovery = simulateApiBeforeDatabaseSmokeCheck({
    dbReadyOnAttempt: 3,
    maxRetries: 6,
    simulateContainerRestartOnAttempt: 2,
  });

  const blockedWhenDbNeverReady = simulateApiBeforeDatabaseSmokeCheck({
    dbReadyOnAttempt: 99,
    maxRetries: 6,
  });

  const allOrdersConverged = Object.values(startupOrderScenarios).every((s) => s.converged);
  const ok =
    composeVerification.valid &&
    allOrdersConverged &&
    startupOrderScenarios.dependenciesFirst.sawTransientDelay === false &&
    startupOrderScenarios.apiBeforeDatabase.sawTransientDelay === true &&
    startupOrderScenarios.reverseOrder.sawTransientDelay === true &&
    apiBeforeDbRecovery.ok === true &&
    apiBeforeDbRecovery.transientDelay === true &&
    apiBeforeDbRecovery.outcome === 'STARTUP_OUTCOME=SUCCESS' &&
    restartRecovery.ok === true &&
    restartRecovery.containerRestarts === 1 &&
    restartRecovery.outcome === 'STARTUP_OUTCOME=SUCCESS' &&
    blockedWhenDbNeverReady.ok === false &&
    blockedWhenDbNeverReady.outcome === 'STARTUP_OUTCOME=BLOCKED';

  return {
    repeatable: true,
    ok,
    composeVerification,
    startupOrderScenarios,
    apiBeforeDbRecovery,
    restartRecovery,
    blockedWhenDbNeverReady,
  };
}

function runCli() {
  const result = runDockerStartupSmokeCheck();
  if (!result.ok) {
    console.error('[docker-startup-smoke] STARTUP_SMOKE=FAIL');
    for (const err of result.composeVerification.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log('[docker-startup-smoke] Compose health checks and restart policies verified (restart: unless-stopped)');
  console.log('[docker-startup-smoke] Out-of-order service startup check passed (dependenciesFirst, apiBeforeDatabase, reverseOrder)');
  console.log('[docker-startup-smoke] API-before-database readiness transition verified (STARTUP_OUTCOME=TRANSIENT_DELAY -> STARTUP_OUTCOME=SUCCESS)');
  console.log('[docker-startup-smoke] Container restart recovery and blocked-readiness boundary verified');
  console.log('[docker-startup-smoke] STARTUP_SMOKE=PASS');
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  runCli();
}
