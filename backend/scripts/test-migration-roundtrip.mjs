#!/usr/bin/env node
/**
 * Test migration round-trip: apply -> rollback -> apply
 * Verifies that schema state is identical after round-trip
 * Detects broken migrations fast
 */

import 'dotenv/config';
import { spawn } from 'child_process';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';

const SCHEMA_DUMP_1 = '.schema-dump-1.sql';
const SCHEMA_DUMP_2 = '.schema-dump-2.sql';
const VERBOSE = process.argv.includes('--verbose');

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function logVerbose(message) {
  if (VERBOSE) {
    console.log(`  ${message}`);
  }
}

async function runCommand(command, args, description) {
  return new Promise((resolve, reject) => {
    log(`▶️  ${description}...`);
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      logVerbose(data.toString().trim());
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      logVerbose(data.toString().trim());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        log(`✅ ${description}`);
        resolve({ stdout, stderr });
      } else {
        log(`❌ ${description} failed with exit code ${code}`);
        if (stderr) {
          console.error('Error output:');
          console.error(stderr);
        }
        reject(new Error(`${description} failed`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function compareSchemas() {
  log('📊 Comparing schema dumps...');

  try {
    const schema1 = readFileSync(SCHEMA_DUMP_1, 'utf8');
    const schema2 = readFileSync(SCHEMA_DUMP_2, 'utf8');

    // Normalize schemas (remove timestamps and comments)
    const normalize = (s) => {
      return s
        .split('\n')
        .filter((line) => {
          // Skip comment lines with generated timestamp
          if (line.includes('Generated at:')) return false;
          return line.trim().length > 0;
        })
        .join('\n')
        .trim();
    };

    const normalized1 = normalize(schema1);
    const normalized2 = normalize(schema2);

    if (normalized1 === normalized2) {
      log('✅ Schemas are identical after round-trip');
      return true;
    }

    // Find differences
    log('❌ Schema mismatch detected!');
    console.log('\n=== SCHEMA DIFF ===\n');

    const lines1 = normalized1.split('\n');
    const lines2 = normalized2.split('\n');

    let differences = 0;
    const maxDiff = Math.max(lines1.length, lines2.length);

    for (let i = 0; i < maxDiff; i++) {
      if (lines1[i] !== lines2[i]) {
        differences++;
        console.log(`Line ${i + 1}:`);
        console.log(`  Before: ${lines1[i] || '(missing)'}`);
        console.log(`  After:  ${lines2[i] || '(missing)'}`);
        if (differences >= 10) {
          console.log(`\n... and ${maxDiff - differences} more differences`);
          break;
        }
      }
    }

    console.log(`\nTotal differences: ${differences}`);
    return false;
  } catch (error) {
    console.error('❌ Failed to compare schemas:', error.message);
    return false;
  }
}

function cleanup() {
  [SCHEMA_DUMP_1, SCHEMA_DUMP_2].forEach((file) => {
    if (existsSync(file)) {
      unlinkSync(file);
      logVerbose(`Cleaned up ${file}`);
    }
  });
}

async function runRoundtrip() {
  log('\n🚀 Starting migration round-trip test...\n');

  try {
    // Step 1: Apply all migrations
    await runCommand('npm', ['run', 'db:migrate'], 'Step 1/5: Apply all migrations');

    // Step 2: Dump schema after migrations applied
    await runCommand('node', ['./scripts/schema-dump.mjs', SCHEMA_DUMP_1],
      'Step 2/5: Dump schema (after apply)');

    // Step 3: Rollback all migrations
    const appliedResult = await runCommand('npm', ['run', 'db:migrate', '--', '--status'],
      'Step 3/5: Checking applied migrations before rollback');

    // Count migrations to rollback
    const appliedCount = (appliedResult.stdout.match(/version = \$/g) || []).length;
    if (appliedCount > 0) {
      await runCommand('npm', ['run', 'db:migrate', '--', '--rollback', '999'],
        `Step 3/5: Rollback ${appliedCount} migrations`);
    } else {
      log('Step 3/5: No migrations to rollback');
    }

    // Step 4: Apply all migrations again
    await runCommand('npm', ['run', 'db:migrate'], 'Step 4/5: Apply all migrations again');

    // Step 5: Dump schema after re-apply
    await runCommand('node', ['./scripts/schema-dump.mjs', SCHEMA_DUMP_2],
      'Step 5/5: Dump schema (after re-apply)');

    // Compare schemas
    console.log('\n');
    const schemasMatch = await compareSchemas();

    console.log('\n=== ROUND-TRIP TEST RESULT ===\n');
    if (schemasMatch) {
      log('✅ Round-trip migration test PASSED');
      console.log('   Schema is identical before and after rollback cycle');
      cleanup();
      process.exit(0);
    } else {
      log('❌ Round-trip migration test FAILED');
      console.log('   Schema differs after rollback/reapply cycle');
      console.log(`   Check ${SCHEMA_DUMP_1} and ${SCHEMA_DUMP_2} for comparison`);
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Round-trip test failed:', error.message);
    cleanup();
    process.exit(1);
  }
}

// Run the test
runRoundtrip().catch((error) => {
  console.error('Unexpected error:', error);
  cleanup();
  process.exit(1);
});
