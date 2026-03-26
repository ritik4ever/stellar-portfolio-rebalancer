import 'dotenv/config'
import { getPool, closePool } from './client.js'

async function seedE2E() {
    console.log('Seeding E2E Database...');
    const pool = getPool()

    try {
        // Clear existing data (cascade will clear allocations and history)
        await pool.query('DELETE FROM portfolios');
        await pool.query('DELETE FROM users');

        // Create the E2E Mock User (with our mock public key string)
        const mockAddress = 'GA2C5RFPE6GCKIG3EQRUUYYTQ27WXYVHTP73HZY4MDF4M7Q2W4M2OWH7';
        
        await pool.query(
            'INSERT INTO users (address, created_at, updated_at) VALUES ($1, NOW(), NOW())',
            [mockAddress]
        );

        // We won't seed a portfolio yet, so the "create" test has a clean slate.
        // The portfolio list endpoint might be empty initially. Be sure your tests expect this or 
        // rely on "demo mode" fallback if the app does that when empty. 
        // 
        // If we needed to seed a portfolio requiring rebalance, we could add one here.
        // For issue #54 core flows, we will allow Playwright to create it fresh.

        console.log('E2E Database Seeded Successfully!');
    } catch (err) {
        console.error('Failed to seed E2E data:', err);
        process.exit(1);
    } finally {
        await closePool();
    }
}

seedE2E();
