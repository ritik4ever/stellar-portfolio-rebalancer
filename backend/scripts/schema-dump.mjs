#!/usr/bin/env node
/**
 * Dump current database schema for comparison
 * Used to verify migrations are reversible and idempotent
 */

import 'dotenv/config';
import { getPool, closePool, isDbConfigured } from '../src/db/client.js';

async function dumpSchema() {
  if (!isDbConfigured()) {
    console.error('❌ DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = getPool();

  try {
    const outputFile = process.argv[2] || '.schema-dump.sql';
    console.log(`📊 Dumping schema to ${outputFile}...`);

    // Get all tables (excluding internal tables)
    const tablesResult = await pool.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      AND tablename != 'schema_migrations'
      ORDER BY tablename
    `);

    const tables = tablesResult.rows.map((r) => r.tablename);
    console.log(`Found ${tables.length} tables to dump`);

    let schema = '-- Generated schema dump for migration testing\n';
    schema += `-- Generated at: ${new Date().toISOString()}\n\n`;

    // Get table definitions
    for (const table of tables) {
      const result = await pool.query(
        `SELECT pg_get_ddl('${table}'::regclass) as ddl`
      );
      if (result.rows[0]?.ddl) {
        schema += result.rows[0].ddl + ';\n\n';
      }
    }

    // Get indexes (excluding constraint indexes)
    const indexResult = await pool.query(`
      SELECT pg_get_indexdef(i.indexrelid)
      FROM pg_index i
      JOIN pg_class t ON i.indrelid = t.oid
      JOIN pg_class idx ON i.indexrelid = idx.oid
      WHERE t.relnamespace = 'public'::regnamespace
      AND NOT i.indisprimary
      AND NOT i.indisunique
      ORDER BY idx.relname
    `);

    if (indexResult.rows.length > 0) {
      schema += '-- Indexes\n';
      for (const row of indexResult.rows) {
        if (row.pg_get_indexdef) {
          schema += row.pg_get_indexdef + ';\n';
        }
      }
      schema += '\n';
    }

    // Write to file
    const fs = await import('fs').then((m) => m.default);
    fs.writeFileSync(outputFile, schema);
    console.log(`✅ Schema dumped to ${outputFile}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to dump schema:', error.message);
    process.exit(1);
  } finally {
    await closePool();
  }
}

dumpSchema();
