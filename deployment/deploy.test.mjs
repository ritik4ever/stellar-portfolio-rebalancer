import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  runDockerStartupSmokeCheck,
  simulateApiBeforeDatabaseSmokeCheck,
  simulateServiceStartupOrder,
  verifyComposeStartupContract,
} from './docker-startup-smoke.mjs';

function resolveBashExecutable() {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Git\\bin\\bash.exe',
          'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
          'bash',
        ]
      : ['bash'];

  for (const candidate of candidates) {
    if (candidate === 'bash' || existsSync(candidate)) {
      const check = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
      if (check.status === 0) {
        return candidate;
      }
    }
  }
  return 'bash';
}

const BASH_BIN = resolveBashExecutable();

function createLfScriptCopy(scriptPath, tempDir) {
  const raw = readFileSync(scriptPath, 'utf8').replace(/\r\n/g, '\n');
  const target = path.join(tempDir, path.basename(scriptPath));
  writeFileSync(target, raw, 'utf8');
  return target;
}

function runHealthCheck(mode) {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'deploy-health-'));
  const scriptPath = createLfScriptCopy(
    path.join(process.cwd(), 'deployment', 'deploy.sh'),
    stateDir,
  );
  const result = spawnSync(
    BASH_BIN,
    [
      '-c',
      [
        'DEPLOY_STATE_DIR="$TEST_STATE_DIR"',
        'source "$1"',
        'HEALTH_URL=http://localhost:3001/ready',
        'HEALTH_RETRIES=2',
        'HEALTH_INTERVAL=0',
        'CURL_CALLS=0',
        'curl() {',
        '  case "$CURL_MODE" in',
        '    success) return 0 ;;',
        '    delay) if [ "$CURL_CALLS" -eq 0 ]; then CURL_CALLS=1; return 22; fi; return 0 ;;',
        '    blocked) return 22 ;;',
        '  esac',
        '}',
        'sleep() { :; }',
        'health_check',
      ].join('\n'),
      'deploy-health-test',
      scriptPath,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CURL_MODE: mode,
        TEST_STATE_DIR: stateDir,
      },
      encoding: 'utf8',
    },
  );

  rmSync(stateDir, { recursive: true, force: true });
  return result;
}

test('deployment script supports dry-run mode without running a real deploy', () => {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'deploy-dry-run-'));
  const scriptPath = createLfScriptCopy(
    path.join(process.cwd(), 'deployment', 'deploy.sh'),
    stateDir,
  );

  try {
    const output = execFileSync(
      BASH_BIN,
      [
        scriptPath,
        '--dry-run',
        '--production',
        '--health-url',
        'http://127.0.0.1:1',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DEPLOY_HEALTH_URL: 'http://127.0.0.1:1',
          DEPLOY_STATE_DIR: stateDir,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).toString();

    assert.match(output, /DRY-RUN|dry-run|Dry-Run/i);
    assert.doesNotMatch(output, /Deploying to production/);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('backend Docker health distinguishes startup delay from blocked readiness', () => {
  const composePath = path.join(process.cwd(), 'deployment', 'docker-compose.yml');
  const compose = readFileSync(composePath, 'utf8').replace(/\r\n/g, '\n');
  const backendStart = compose.indexOf('\n  backend:\n');
  const backendEnd = compose.indexOf('\n  reflector-mock:\n', backendStart);
  assert.notEqual(backendStart, -1);
  assert.notEqual(backendEnd, -1);

  const backendService = compose.slice(backendStart, backendEnd);
  assert.match(backendService, /healthcheck:\s*\n\s+test: \["CMD", "node", "-e", .*\/ready/);
  assert.match(backendService, /interval: 5s/);
  assert.match(backendService, /timeout: 3s/);
  assert.match(backendService, /retries: 6/);
  assert.match(backendService, /start_period: 30s/);
});

test('deployment reports a successful API startup', () => {
  const result = runHealthCheck('success');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /STARTUP_OUTCOME=SUCCESS/);
  assert.doesNotMatch(result.stdout, /STARTUP_OUTCOME=TRANSIENT_DELAY/);
});

test('deployment reports transient readiness delay before success', () => {
  const result = runHealthCheck('delay');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /STARTUP_OUTCOME=TRANSIENT_DELAY/);
  assert.match(result.stdout, /STARTUP_OUTCOME=SUCCESS/);
});

test('deployment reports blocked readiness with an owner action', () => {
  const result = runHealthCheck('blocked');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /STARTUP_OUTCOME=TRANSIENT_DELAY/);
  assert.match(result.stdout, /STARTUP_OUTCOME=BLOCKED/);
  assert.match(result.stdout, /Owner action: inspect \/readiness and backend logs/);
});

// ── Repeatable Docker startup smoke verification (SPR-2026-270) ─────────────

test('SPR-2026-270: verifies health checks and restart behavior in docker-compose.yml from a clean environment', () => {
  const contract = verifyComposeStartupContract();

  assert.equal(contract.valid, true, `Unexpected compose errors: ${contract.errors.join('; ')}`);
  for (const service of ['frontend', 'backend', 'reflector-mock', 'redis', 'postgres']) {
    assert.equal(contract.services[service]?.present, true, `${service} should be present`);
    assert.equal(
      contract.services[service]?.restartPolicy,
      'unless-stopped',
      `${service} should configure restart: unless-stopped`,
    );
  }
  for (const service of ['backend', 'reflector-mock', 'redis', 'postgres']) {
    assert.equal(
      contract.services[service]?.healthcheckValid,
      true,
      `${service} healthcheck should be valid`,
    );
  }
});

test('SPR-2026-270: smoke check verifies services starting in different orders', () => {
  const dependenciesFirst = simulateServiceStartupOrder([
    'postgres',
    'redis',
    'reflector-mock',
    'backend',
    'frontend',
  ]);
  assert.equal(dependenciesFirst.converged, true);
  assert.equal(dependenciesFirst.sawTransientDelay, false);
  assert.equal(dependenciesFirst.outcome, 'STARTUP_OUTCOME=SUCCESS');

  const apiBeforeDbOrder = simulateServiceStartupOrder([
    'backend',
    'frontend',
    'reflector-mock',
    'redis',
    'postgres',
  ]);
  assert.equal(apiBeforeDbOrder.converged, true);
  assert.equal(apiBeforeDbOrder.sawTransientDelay, true);
  assert.equal(apiBeforeDbOrder.outcome, 'STARTUP_OUTCOME=SUCCESS');
  assert.equal(apiBeforeDbOrder.timeline[0].startedService, 'backend');
  assert.equal(apiBeforeDbOrder.timeline[0].livenessStatus, 200);
  assert.equal(apiBeforeDbOrder.timeline[0].readinessStatus, 503);
  assert.equal(apiBeforeDbOrder.timeline[0].dockerHealthState, 'starting');

  const finalStep = apiBeforeDbOrder.timeline[apiBeforeDbOrder.timeline.length - 1];
  assert.equal(finalStep.readinessStatus, 200);
  assert.equal(finalStep.dockerHealthState, 'healthy');
});

test('SPR-2026-270: smoke check verifies API starting before its database is ready and container restart recovery', () => {
  const delayedDb = simulateApiBeforeDatabaseSmokeCheck({
    dbReadyOnAttempt: 3,
    maxRetries: 6,
  });
  assert.equal(delayedDb.ok, true);
  assert.equal(delayedDb.transientDelay, true);
  assert.equal(delayedDb.outcome, 'STARTUP_OUTCOME=SUCCESS');
  assert.equal(delayedDb.attemptsUsed, 3);
  assert.equal(delayedDb.attempts[0].readinessHttp, 503);
  assert.equal(delayedDb.attempts[0].signal, 'STARTUP_OUTCOME=TRANSIENT_DELAY');
  assert.equal(delayedDb.attempts[2].readinessHttp, 200);
  assert.equal(delayedDb.attempts[2].signal, 'STARTUP_OUTCOME=SUCCESS');

  const restartedApi = simulateApiBeforeDatabaseSmokeCheck({
    dbReadyOnAttempt: 3,
    maxRetries: 6,
    simulateContainerRestartOnAttempt: 2,
  });
  assert.equal(restartedApi.ok, true);
  assert.equal(restartedApi.containerRestarts, 1);
  assert.equal(restartedApi.outcome, 'STARTUP_OUTCOME=SUCCESS');

  const blockedDb = simulateApiBeforeDatabaseSmokeCheck({
    dbReadyOnAttempt: 10,
    maxRetries: 6,
  });
  assert.equal(blockedDb.ok, false);
  assert.equal(blockedDb.outcome, 'STARTUP_OUTCOME=BLOCKED');
  assert.equal(blockedDb.ownerAction, 'inspect_readiness_database_and_backend_logs');
});

test('SPR-2026-270: repeatable Docker startup smoke check succeeds across runs and via deploy.sh --startup-smoke', () => {
  const run1 = runDockerStartupSmokeCheck();
  const run2 = runDockerStartupSmokeCheck();

  assert.equal(run1.repeatable, true);
  assert.equal(run1.ok, true);
  assert.equal(run2.repeatable, true);
  assert.equal(run2.ok, true);

  const scriptPath = path.join(process.cwd(), 'deployment', 'deploy.sh');
  const cliResult = spawnSync(BASH_BIN, [scriptPath, '--startup-smoke'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.match(cliResult.stdout, /STARTUP_SMOKE=PASS/);
});

// ── Secret rotation config validation ──────────────────────────────────────

/**
 * Runs validateRotationConfig() from startupConfig.ts by invoking Node directly
 * with the supplied environment overrides. Returns { exitCode, stdout, stderr }.
 */
function runRotationConfigValidation(envOverrides = {}) {
  const script = `
    import { registerHooks } from 'node:module';
    registerHooks({
      resolve(specifier, context, nextResolve) {
        try {
          return nextResolve(specifier, context);
        } catch (err) {
          if (specifier.endsWith('/utils/logger.js')) {
            return {
              url: 'data:text/javascript,const noop = () => {}; export const logger = { info: noop, warn: noop, error: noop, debug: noop };',
              shortCircuit: true,
            };
          }
          if (specifier.endsWith('.js')) {
            return nextResolve(specifier.slice(0, -3) + '.ts', context);
          }
          throw err;
        }
      },
    });
    const { validateStartupConfigOrThrow } = await import('./backend/src/config/startupConfig.js');
    try {
      validateStartupConfigOrThrow(${JSON.stringify(envOverrides)});
      console.log('VALIDATION_PASSED');
    } catch (err) {
      console.error('VALIDATION_FAILED:' + err.message);
      process.exitCode = 1;
    }
  `;
  return spawnSync(process.execPath, ['--input-type=module'], {
    input: script,
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

/** Minimal valid env used as the base for rotation tests. */
const VALID_BASE_ENV = {
  NODE_ENV: 'test',
  PORT: '3001',
  STELLAR_NETWORK: 'testnet',
  STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  CONTRACT_ADDRESS: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
  STELLAR_REBALANCE_SECRET: 'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  JWT_SECRET: 'a'.repeat(32),
};

test('rotation config: USE_AWS_SECRETS_MANAGER=true with no ARN set stops startup', () => {
  const result = runRotationConfigValidation({
    ...VALID_BASE_ENV,
    USE_AWS_SECRETS_MANAGER: 'true',
    // intentionally omit DB_SECRET_ARN and REDIS_SECRET_ARN
  });

  assert.equal(result.status ?? result.exitCode, 1,
    `Expected exit 1 but got ${result.status ?? result.exitCode}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(
    result.stderr,
    /USE_AWS_SECRETS_MANAGER is true but neither DB_SECRET_ARN nor REDIS_SECRET_ARN/,
    'Expected a clear error about missing ARNs',
  );
});

test('rotation config: USE_AWS_SECRETS_MANAGER=true with a valid DB_SECRET_ARN passes', () => {
  const result = runRotationConfigValidation({
    ...VALID_BASE_ENV,
    USE_AWS_SECRETS_MANAGER: 'true',
    DB_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:stellar-db-secret',
  });

  assert.equal(result.status ?? result.exitCode, 0,
    `Expected exit 0 but got ${result.status ?? result.exitCode}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /VALIDATION_PASSED/);
});

test('rotation config: USE_AWS_SECRETS_MANAGER=true with a valid REDIS_SECRET_ARN passes', () => {
  const result = runRotationConfigValidation({
    ...VALID_BASE_ENV,
    USE_AWS_SECRETS_MANAGER: 'true',
    REDIS_SECRET_ARN: 'arn:aws:secretsmanager:eu-west-1:123456789012:secret:stellar-redis-auth',
  });

  assert.equal(result.status ?? result.exitCode, 0,
    `Expected exit 0 but got ${result.status ?? result.exitCode}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /VALIDATION_PASSED/);
});

test('rotation config: malformed DB_SECRET_ARN stops startup even without USE_AWS_SECRETS_MANAGER', () => {
  const result = runRotationConfigValidation({
    ...VALID_BASE_ENV,
    DB_SECRET_ARN: 'not-a-valid-arn',
  });

  assert.equal(result.status ?? result.exitCode, 1,
    `Expected exit 1 but got ${result.status ?? result.exitCode}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(
    result.stderr,
    /DB_SECRET_ARN.*is not a valid AWS Secrets Manager ARN/,
    'Expected a clear error about invalid ARN format',
  );
});

test('rotation config: malformed REDIS_SECRET_ARN stops startup', () => {
  const result = runRotationConfigValidation({
    ...VALID_BASE_ENV,
    USE_AWS_SECRETS_MANAGER: 'true',
    DB_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:valid',
    REDIS_SECRET_ARN: 'arn:wrong-service:us-east-1:123456789012:secret:redis',
  });

  assert.equal(result.status ?? result.exitCode, 1,
    `Expected exit 1 but got ${result.status ?? result.exitCode}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(
    result.stderr,
    /REDIS_SECRET_ARN.*is not a valid AWS Secrets Manager ARN/,
  );
});

test('rotation config: both ARNs valid with USE_AWS_SECRETS_MANAGER=true passes', () => {
  const result = runRotationConfigValidation({
    ...VALID_BASE_ENV,
    USE_AWS_SECRETS_MANAGER: 'true',
    DB_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:stellar-portfolio-db',
    REDIS_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:stellar-portfolio-redis',
  });

  assert.equal(result.status ?? result.exitCode, 0,
    `Expected exit 0 but got ${result.status ?? result.exitCode}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /VALIDATION_PASSED/);
});
