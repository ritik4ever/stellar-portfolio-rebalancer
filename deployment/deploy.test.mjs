import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

function runHealthCheck(mode) {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'deploy-health-'));
  const scriptPath = path.join(process.cwd(), 'deployment', 'deploy.sh');
  const result = spawnSync(
    'bash',
    [
      '-c',
      [
        'source "$1"',
        'HEALTH_URL=http://localhost:3001/ready',
        'HEALTH_RETRIES=2',
        'HEALTH_INTERVAL=0',
        'DEPLOY_STATE_DIR="$TEST_STATE_DIR"',
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
    }
  );

  rmSync(stateDir, { recursive: true, force: true });
  return result;
}

test('deployment script supports dry-run mode without running a real deploy', () => {
  const scriptPath = path.join(process.cwd(), 'deployment', 'deploy.sh');

  const output = execFileSync(
    'bash',
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
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  ).toString();

  assert.match(output, /DRY-RUN|dry-run|Dry-Run/i);
  assert.doesNotMatch(output, /Deploying to production/);
});

test('backend Docker health distinguishes startup delay from blocked readiness', () => {
  const composePath = path.join(process.cwd(), 'deployment', 'docker-compose.yml');
  const compose = readFileSync(composePath, 'utf8');
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

// ── Secret rotation config validation ──────────────────────────────────────

/**
 * Runs validateRotationConfig() from startupConfig.ts by invoking Node directly
 * with the supplied environment overrides. Returns { exitCode, stdout, stderr }.
 */
function runRotationConfigValidation(envOverrides = {}) {
  const script = `
    import { validateStartupConfigOrThrow } from './backend/src/config/startupConfig.js';
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
