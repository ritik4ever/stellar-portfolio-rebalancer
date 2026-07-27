#!/usr/bin/env node
/**
 * Database restore script - supports both SQLite and PostgreSQL
 * Usage:
 *   npm run db:restore ./path/to/backup.db  - Restore SQLite backup
 *   npm run db:restore ./path/to/dump.sql    - Restore PostgreSQL backup
 */
import 'dotenv/config';
import { existsSync } from 'fs';
import { isDbConfigured, getPool, closePool } from '../src/db/client.js';
import { databaseService } from '../src/services/databaseService.js';
import { execSync } from 'child_process';

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Error: Please provide a backup file path');
    process.exit(1);
  }
  return { backupPath: args[0] };
}

async function restorePostgreSQL(backupPath: string) {
  console.log('[Restore] Restoring PostgreSQL database from', backupPath);
  
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  // Try to use psql if available
  try {
    const psqlPath = process.env.PSQL || 'psql';
    
    let cmd: string;
    if (process.env.DATABASE_URL) {
      cmd = `${psqlPath} ${process.env.DATABASE_URL} < ${backupPath}`;
    } else {
      const host = process.env.PGHOST || 'localhost';
      const port = process.env.PGPORT || '5432';
      const user = process.env.PGUSER;
      const database = process.env.PGDATABASE;
      const password = process.env.PGPASSWORD;
      
      if (!user || !database) {
        throw new Error('PGUSER and PGDATABASE must be set for PostgreSQL restore');
      }

      const env = { ...process.env };
      if (password) {
        env.PGPASSWORD = password;
      }

      cmd = `${psqlPath} -h ${host} -p ${port} -U ${user} -d ${database} < ${backupPath}`;
    }

    execSync(cmd, { stdio: 'inherit' });
    console.log('[Restore] PostgreSQL database restored successfully');
  } catch (err) {
    console.error('[Restore] Failed to restore PostgreSQL using psql:', err);
    throw err;
  }
}

function restoreSQLite(backupPath: string) {
  console.log('[Restore] Restoring SQLite database from', backupPath);
  databaseService.restore(backupPath);
  console.log('[Restore] SQLite database restored successfully');
}

async function main() {
  const { backupPath } = parseArgs();
  
  try {
    if (!existsSync(backupPath)) {
      console.error(`Error: Backup file not found: ${backupPath}`);
      process.exit(1);
    }

    if (isDbConfigured()) {
      await restorePostgreSQL(backupPath);
    } else {
      restoreSQLite(backupPath);
    }
  } catch (err) {
    console.error('[Restore] Error:', err);
    process.exit(1);
  } finally {
    try {
      await closePool();
    } catch {
      // Ignore
    }
  }
}

main();
