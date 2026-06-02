import 'dotenv/config'
import { getPool, closePool, isDbConfigured } from '../src/db/client.js'
import { execSync } from 'node:child_process'
import { existsSync, unlinkSync } from 'node:fs'

async function resetStaging() {
    console.log('\x1b[36m%s\x1b[0m', '--- Staging Database Reset & Seed Workflow ---');
    
    const isProduction = process.env.NODE_ENV === 'production';
    const hasConfirm = process.env.STAGING_RESET_CONFIRM === 'true';

    if (isProduction && !hasConfirm) {
        console.error('\x1b[31m%s\x1b[0m', 'Error: STAGING_RESET_CONFIRM=true must be set to run this in production/staging.');
        console.error('This is a destructive operation. Aborting.');
        process.exit(1);
    }

    try {
        if (isDbConfigured()) {
            console.log('Detected Postgres configuration. Resetting via SQL...');
            const pool = getPool();
            
            // Re-creating the public schema is the fastest way to drop everything
            console.log('  Dropping schema public...');
            await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
            console.log('  Creating schema public...');
            await pool.query('CREATE SCHEMA public');
            console.log('  Granting privileges...');
            await pool.query('GRANT ALL ON SCHEMA public TO public');
            console.log('\x1b[32m%s\x1b[0m', '  Schema reset completed.');
        } else if (process.env.DB_PATH) {
            console.log(`Detected SQLite configuration at ${process.env.DB_PATH}. Deleting file...`);
            if (existsSync(process.env.DB_PATH)) {
                unlinkSync(process.env.DB_PATH);
                console.log('\x1b[32m%s\x1b[0m', '  Database file deleted.');
            } else {
                console.log('  Database file not found, skipping delete.');
            }
        } else {
            console.warn('Neither DATABASE_URL nor DB_PATH detected. Assuming SQLite default at ./data/portfolio.db');
            const defaultPath = './data/portfolio.db';
            if (existsSync(defaultPath)) {
                unlinkSync(defaultPath);
                console.log('\x1b[32m%s\x1b[0m', '  Default database file deleted.');
            }
        }

        console.log('\n\x1b[33m%s\x1b[0m', 'Step 1: Running migrations...');
        execSync('npm run db:migrate', { stdio: 'inherit' });

        console.log('\n\x1b[33m%s\x1b[0m', 'Step 2: Running E2E/Staging seeds...');
        execSync('npm run db:seed:e2e', { stdio: 'inherit' });

        console.log('\n\x1b[32m%s\x1b[0m', '--- Workflow Completed Successfully ---');
        console.log('Staging environment is now in a known-good state.');
    } catch (err) {
        console.error('\n\x1b[31m%s\x1b[0m', '!!! Workflow Failed !!!');
        console.error(err instanceof Error ? err.message : String(err));
        console.error('Environment might be in an inconsistent state.');
        process.exit(1);
    } finally {
        await closePool();
    }
}

resetStaging();
