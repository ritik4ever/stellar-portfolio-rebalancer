#!/usr/bin/env node
/**
 * Database backup script - supports both SQLite and PostgreSQL
 * Usage:
 *   npm run db:backup                      - Backup SQLite or PostgreSQL based on config
 *   npm run db:backup -- --path ./custom.db - Custom backup path for SQLite
 *   npm run db:backup -- --output ./dump.sql - Custom output for PostgreSQL
 */
import 'dotenv/config';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isDbConfigured, getPool, closePool } from '../src/db/client.js';
import { databaseService } from '../src/services/databaseService.js';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const result: { path?: string; output?: string } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--path' && i + 1 < args.length) {
      result.path = args[++i];
    } else if (args[i] === '--output' && i + 1 < args.length) {
      result.output = args[++i];
    }
  }

  return result;
}

async function backupPostgreSQL(outputPath?: string) {
  console.log('[Backup] Backing up PostgreSQL database...');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultBackupDir = join(process.cwd(), 'data', 'backups');
  mkdirSync(defaultBackupDir, { recursive: true });
  const defaultOutput = join(defaultBackupDir, `pg-backup-${timestamp}.sql`);
  const finalOutput = outputPath || defaultOutput;

  // Try to use pg_dump if available
  try {
    const pgDumpPath = process.env.PG_DUMP || 'pg_dump';
    
    let cmd: string;
    if (process.env.DATABASE_URL) {
      cmd = `${pgDumpPath} ${process.env.DATABASE_URL} > ${finalOutput}`;
    } else {
      const host = process.env.PGHOST || 'localhost';
      const port = process.env.PGPORT || '5432';
      const user = process.env.PGUSER;
      const database = process.env.PGDATABASE;
      const password = process.env.PGPASSWORD;
      
      if (!user || !database) {
        throw new Error('PGUSER and PGDATABASE must be set for PostgreSQL backup');
      }

      const env = { ...process.env };
      if (password) {
        env.PGPASSWORD = password;
      }

      cmd = `${pgDumpPath} -h ${host} -p ${port} -U ${user} -d ${database} > ${finalOutput}`;
    }

    execSync(cmd, { stdio: 'inherit' });
    console.log(`[Backup] PostgreSQL backup created successfully at ${finalOutput}`);
    return finalOutput;
  } catch (err) {
    console.error('[Backup] Failed to backup PostgreSQL using pg_dump:', err);
    
    // Fallback: use node-pg to get schema and data
    console.log('[Backup] Trying fallback method to extract data...');
    throw err;
  }
}

function backupSQLite(customPath?: string) {
  console.log('[Backup] Backing up SQLite database...');
  const backupPath = databaseService.backup(customPath);
  return backupPath;
}

async function main() {
  const args = parseArgs();
  
  try {
    if (isDbConfigured()) {
      await backupPostgreSQL(args.output);
    } else {
      backupSQLite(args.path);
    }
  } catch (err) {
    console.error('[Backup] Error:', err);
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
