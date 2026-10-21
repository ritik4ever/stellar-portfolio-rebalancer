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
