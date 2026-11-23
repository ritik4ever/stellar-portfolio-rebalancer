import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

function resolveBashBinary() {
  const candidates =
    process.platform === 'win32'
      ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe', 'bash']
      : ['bash'];
  for (const candidate of candidates) {
    const check = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (check.status === 0) {
      return candidate;
    }
  }
  return 'bash';
}

const BASH_BIN = resolveBashBinary();

function createLfScriptCopy(sourcePath, tempDir) {
  const raw = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
  const targetPath = path.join(tempDir, path.basename(sourcePath));
  writeFileSync(targetPath, raw, { encoding: 'utf8', mode: 0o755 });
  return targetPath;
}

function readComposeNormalized() {
  const composePath = path.join(process.cwd(), 'deployment', 'docker-compose.yml');
  return readFileSync(composePath, 'utf8').replace(/\r\n/g, '\n');
}

function sliceComposeService(compose, serviceName) {
  const marker = `\n  ${serviceName}:\n`;
  const start = compose.indexOf(marker);
  if (start === -1) return '';
  const rest = compose.slice(start + marker.length);
  const nextMatch = rest.match(/\n(?:  [a-z0-9_-]+:|\n?(?:volumes|networks):)\n/);
  const end = nextMatch ? start + marker.length + nextMatch.index : compose.length;
  return compose.slice(start, end);
}

function extractComposeDefaultEnv(serviceBlock) {
  const env = {};
  const lines = serviceBlock.split('\n');
  let inEnv = false;
  for (const line of lines) {
    if (/^\s{4}environment:\s*$/.test(line)) {
      inEnv = true;
      continue;
    }
    if (inEnv && /^\s{4}[a-z_]+:/.test(line)) {
      break;
    }
    if (!inEnv) continue;
    const match = line.match(/^\s{6}-\s+([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawVal] = match;
    const fallbackMatch = rawVal.match(/^\$\{[A-Z0-9_]+:-(.*)\}$/);
    env[key] = fallbackMatch ? fallbackMatch[1] : rawVal;
  }
  return env;
}

function runHealthCheck(mode) {
  const stateDir = mkdtempSync(path.join(tmpdir(), 'deploy-health-'));
  const sourceScriptPath = path.join(process.cwd(), 'deployment', 'deploy.sh');
  const scriptPath = createLfScriptCopy(sourceScriptPath, stateDir);

  const result = spawnSync(
    BASH_BIN,
    [
      '-c',
      [
        'DEPLOY_STATE_DIR="$(dirname "$1")/.state"',
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
      },
      encoding: 'utf8',
    }
  );

  rmSync(stateDir, { recursive: true, force: true });
  return result;
}

test('deployment script supports dry-run mode without running a real deploy', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'deploy-dryrun-'));
  try {
    const sourceScriptPath = path.join(process.cwd(), 'deployment', 'deploy.sh');
    const scriptPath = createLfScriptCopy(sourceScriptPath, tempDir);

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
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    ).toString();

    assert.match(output, /DRY-RUN|dry-run|Dry-Run/i);
    assert.doesNotMatch(output, /Deploying to production/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('backend Docker health distinguishes startup delay from blocked readiness', () => {
  const compose = readComposeNormalized();
  const backendService = sliceComposeService(compose, 'backend');
  assert.notEqual(backendService, '');

  assert.match(backendService, /healthcheck:\s*\n\s+test: \["CMD", "node", "-e", .*\/ready/);
  assert.match(backendService, /interval: 5s/);
  assert.match(backendService, /timeout: 3s/);
  assert.match(backendService, /retries: 6/);
  assert.match(backendService, /start_period: 30s/);
});

test('clean checkout: default and stateful Docker Compose services define health checks and unless-stopped restart policy', () => {
  const compose = readComposeNormalized();

  for (const serviceName of ['frontend', 'backend', 'reflector-mock', 'redis', 'postgres', 'umami-db']) {
    const block = sliceComposeService(compose, serviceName);
    assert.notEqual(block, '', `Expected service ${serviceName} in deployment/docker-compose.yml`);
    assert.match(block, /restart: unless-stopped/, `Expected ${serviceName} to set restart: unless-stopped`);
    assert.match(block, /healthcheck:\s*\n\s+test:/, `Expected ${serviceName} to define a container healthcheck`);
    assert.match(block, /interval:\s*\d+s/, `Expected ${serviceName} healthcheck interval`);
    assert.match(block, /timeout:\s*\d+s/, `Expected ${serviceName} healthcheck timeout`);
    assert.match(block, /retries:\s*\d+/, `Expected ${serviceName} healthcheck retries`);
    assert.match(block, /start_period:\s*\d+s/, `Expected ${serviceName} healthcheck start_period`);
  }
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

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
  });
}

test('isolated service startup: reflector-mock serves /health and /ready without other services running', async () => {
  const serverPath = path.join(process.cwd(), 'deployment', 'reflector-mock', 'server.js');

  const freePort = await new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });

  const mockProc = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(freePort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('reflector-mock startup timed out')), 5000);
      mockProc.stdout.on('data', (chunk) => {
        if (String(chunk).includes('Mock Reflector service listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      mockProc.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`reflector-mock exited early with code ${code}`));
      });
    });

    for (const endpoint of ['/health', '/ready']) {
      const response = await httpGetJson(`http://127.0.0.1:${freePort}${endpoint}`);
      assert.equal(response.status, 200);
      assert.equal(response.body.status, 'ok');
      assert.equal(response.body.service, 'mock-reflector');
    }
  } finally {
    mockProc.stdout?.destroy();
    mockProc.stderr?.destroy();
    if (mockProc.exitCode === null) {
      await new Promise((resolve) => {
        mockProc.once('close', resolve);
        mockProc.kill();
      });
    }
  }
});

// ── Secret rotation & clean-environment startup config validation ──────────

/**
 * Runs validateStartupConfigOrThrow() from startupConfig.ts by invoking Node
 * directly with a lightweight in-memory module loader so tests work in a clean
 * checkout without requiring pre-built dist files or backend/node_modules.
 */
function runRotationConfigValidation(envOverrides = {}) {
  const loaderHookCode = `
    import { existsSync } from 'node:fs';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    import path from 'node:path';

    const LOGGER_STUB_URL = 'data:text/javascript,' + encodeURIComponent(
      'export const logger = { info(){}, warn(){}, error(){}, debug(){}, trace(){}, fatal(){} }; export const logAudit = () => {};'
    );

    export async function resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('/utils/logger.js') || specifier.endsWith('./secretRedactor.js')) {
        return { url: LOGGER_STUB_URL, shortCircuit: true };
      }
      if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
        const parentDir = path.dirname(fileURLToPath(context.parentURL));
        const jsCandidate = path.resolve(parentDir, specifier);
        if (!existsSync(jsCandidate)) {
          const tsCandidate = jsCandidate.replace(/\\.js$/, '.ts');
          if (existsSync(tsCandidate)) {
            return { url: pathToFileURL(tsCandidate).href, shortCircuit: true };
          }
        }
      }
      return nextResolve(specifier, context);
    }
  `;

  const startupConfigPath = existsSync(path.join(process.cwd(), 'backend', 'src', 'config', 'startupConfig.js'))
    ? './backend/src/config/startupConfig.js'
    : './backend/src/config/startupConfig.ts';

  const script = `
    import { register } from 'node:module';
    register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(loaderHookCode)}));
    const { validateStartupConfigOrThrow } = await import(${JSON.stringify(startupConfigPath)});
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

test('clean checkout: backend Docker Compose defaults pass startup config validation without undocumented local state', () => {
  const compose = readComposeNormalized();
  const backendService = sliceComposeService(compose, 'backend');
  const composeDefaults = extractComposeDefaultEnv(backendService);

  assert.equal(composeDefaults.PORT, '3001');
  assert.equal(composeDefaults.DEMO_MODE, 'true');
  assert.equal(composeDefaults.ALLOW_DEMO_BALANCE_FALLBACK, 'true');
  assert.equal(composeDefaults.ALLOW_FALLBACK_PRICES, 'true');
  assert.equal(composeDefaults.REFLECTOR_SERVICE_URL, 'http://reflector-mock:8080');

  const result = runRotationConfigValidation(composeDefaults);
  assert.equal(
    result.status ?? result.exitCode,
    0,
    `Expected clean-checkout compose defaults to pass startup validation.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
  assert.match(result.stdout, /VALIDATION_PASSED/);
});

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

// ── Secret rotation smoke check (SPR-2026-280) ───────────────────────────────

function runRotationSmoke(env) {
  return spawnSync(process.execPath, [path.join(process.cwd(), 'deployment', 'rotation-smoke.mjs')], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
}

test('rotation smoke: worker on new key during overlap passes and leaks no key values', () => {
  const result = runRotationSmoke({
    ROTATION_ACTIVE_KEY: 'new-secret-key-AAAA',
    ROTATION_PREVIOUS_KEY: 'old-secret-key-BBBB',
    ROTATION_WORKER_KEY: 'new-secret-key-AAAA',
    ROTATION_ACTIVE_VERSION: 'v2',
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'ok');
  assert.equal(report.overlap, true);
  assert.equal(report.activeVersion, 'v2');
  assert.equal(report.activeFingerprint, report.workerFingerprint);
  assert.notEqual(report.activeFingerprint, report.previousFingerprint);
  assert.doesNotMatch(result.stdout + result.stderr, /secret-key/);
});

test('rotation smoke: worker retaining the previous key fails as stale', () => {
  const result = runRotationSmoke({
    ROTATION_ACTIVE_KEY: 'new-secret-key-AAAA',
    ROTATION_PREVIOUS_KEY: 'old-secret-key-BBBB',
    ROTATION_WORKER_KEY: 'old-secret-key-BBBB',
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'stale-worker');
  assert.equal(report.reason, 'worker holds previous key');
  assert.equal(report.recommendedAction, 'restart-worker-with-current-secret');
  assert.doesNotMatch(result.stdout + result.stderr, /secret-key/);
});

test('rotation smoke: unknown worker key fails and no overlap is reported after cutover', () => {
  const result = runRotationSmoke({
    ROTATION_ACTIVE_KEY: 'new-secret-key-AAAA',
    ROTATION_WORKER_KEY: 'mystery-key-CCCC',
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.reason, 'worker holds unknown key');
  assert.equal(report.recommendedAction, 'restart-worker-with-current-secret');
  assert.equal(report.overlap, false);
  assert.doesNotMatch(result.stdout + result.stderr, /mystery-key/);
});

test('rotation smoke: clean environment with no inputs is rejected without crashing', () => {
  const result = runRotationSmoke({});
  assert.equal(result.status, 2);
  assert.match(result.stdout, /ROTATION_ACTIVE_KEY/);
});

test('rotation smoke: identical active and previous keys are rejected', () => {
  const result = runRotationSmoke({
    ROTATION_ACTIVE_KEY: 'same-key-DDDD',
    ROTATION_PREVIOUS_KEY: 'same-key-DDDD',
    ROTATION_WORKER_KEY: 'same-key-DDDD',
  });
  assert.equal(result.status, 2);
  assert.doesNotMatch(result.stdout + result.stderr, /same-key/);
});

// ── Terraform clean-environment rollout validation (SPR-2026-271) ──────────

test('clean checkout: terraform root module defines rollout outcomes, state consistency, and rollback outputs (SPR-2026-271)', () => {
  const rootDir = process.cwd();
  const tfRolloutResult = readFileSync(path.join(rootDir, 'terraform', 'rollout_result.tf'), 'utf8');
  const tfOutputs = readFileSync(path.join(rootDir, 'terraform', 'outputs.tf'), 'utf8');
  const tfVariables = readFileSync(path.join(rootDir, 'terraform', 'variables.tf'), 'utf8');
  const tfVersions = readFileSync(path.join(rootDir, 'terraform', 'versions.tf'), 'utf8');

  // Verify versions and required version >= 1.5.0
  assert.match(tfVersions, /required_version\s*=\s*">= 1\.5\.0"/);

  // Verify variable declaration with validation
  assert.match(tfVariables, /variable\s+"rollout_outcome_signal"/);
  assert.match(tfVariables, /contains\(\["success",\s*"transient_delay",\s*"blocked"\],\s*var\.rollout_outcome_signal\)/);
  assert.match(tfVariables, /variable\s+"rollout_affected_service"/);
  assert.match(tfVariables, /variable\s+"rollout_owner_action"/);

  // Verify structured rollout_result local and output
  assert.match(tfRolloutResult, /status\s*=\s*var\.rollout_outcome_signal/);
  assert.match(tfRolloutResult, /is_partial\s*=\s*var\.rollout_outcome_signal != "success"/);
  assert.match(tfRolloutResult, /is_blocking\s*=\s*var\.rollout_outcome_signal == "blocked"/);
  assert.match(tfRolloutResult, /output\s+"rollout_result"/);

  // Verify flattened rollback and outcome outputs
  assert.match(tfOutputs, /output\s+"rollout_outcome"/);
  assert.match(tfOutputs, /output\s+"rollout_affected_service"/);
  assert.match(tfOutputs, /output\s+"rollout_owner_action"/);
});

test('clean checkout: terraform root module includes native test suite for rollout outcomes (SPR-2026-271)', () => {
  const rootDir = process.cwd();
  const tftestPath = path.join(rootDir, 'terraform', 'tests', 'rollout_result.tftest.hcl');
  assert.ok(existsSync(tftestPath), 'terraform/tests/rollout_result.tftest.hcl must exist');

  const testContent = readFileSync(tftestPath, 'utf8');
  assert.match(testContent, /mock_provider\s+"aws"/);
  assert.match(testContent, /run\s+"success_signal_produces_clean_rollout_result"/);
  assert.match(testContent, /run\s+"transient_delay_defaults_to_retry_apply"/);
  assert.match(testContent, /run\s+"blocked_signal_defaults_to_resolve_blocker"/);
  assert.match(testContent, /run\s+"clean_environment_plan_has_deterministic_defaults"/);
  assert.match(testContent, /run\s+"invalid_signal_value_is_rejected_by_validation"/);
});

test('clean checkout: terraform rollout documentation details clean plan reproduction, state consistency, and rollback steps without undocumented local state (SPR-2026-271)', () => {
  const rootDir = process.cwd();
  const tfReadme = readFileSync(path.join(rootDir, 'terraform', 'README.md'), 'utf8');
  const depTfReadme = readFileSync(path.join(rootDir, 'deployment', 'terraform', 'README.md'), 'utf8');
  const opsDoc = readFileSync(path.join(rootDir, 'docs', 'OPERATIONS.md'), 'utf8');

  // Verify SPR-2026-271 references
  assert.match(tfReadme, /SPR-2026-271/);
  assert.match(depTfReadme, /SPR-2026-271/);
  assert.match(opsDoc, /SPR-2026-271/);

  // Verify clean checkout, plan with no infrastructure changes, and rollback documentation
  for (const doc of [tfReadme, depTfReadme, opsDoc]) {
    assert.match(doc, /clean checkout|clean environment/i);
    assert.match(doc, /plan -detailed-exitcode|plan -refresh-only/);
    assert.match(doc, /undocumented local state/);
    assert.match(doc, /rollback/i);
  }
});

