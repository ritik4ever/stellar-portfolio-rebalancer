import 'dotenv/config'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { getPool, closePool, isDbConfigured } from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function run() {
    if (!isDbConfigured()) {
        console.error('DATABASE_URL is not set. Set it to run migrations.')
        process.exit(1)
    }
    try {
        const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
        await getPool().query(schema)
        console.log('Migrations completed successfully.')
    } catch (err) {
        console.error('Migration failed:', err)
        process.exit(1)
    } finally {
        await closePool()
    }
}

run()
