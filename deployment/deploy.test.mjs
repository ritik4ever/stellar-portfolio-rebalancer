import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

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
