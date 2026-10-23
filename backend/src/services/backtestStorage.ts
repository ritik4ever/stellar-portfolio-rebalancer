import { randomUUID } from 'node:crypto'
import { isDbConfigured } from '../db/client.js'
import * as backtestDb from '../db/backtestDb.js'
import { databaseService } from './databaseService.js'
import { logger } from '../utils/logger.js'
import type { BacktestRecord } from './backtest.js'

const MAX_MEMORY_RECORDS = 500

export class BacktestStorage {
    private memoryRecords = new Map<string, BacktestRecord>()
    private activeLocks = new Map<string, { token: string; acquiredAt: number }>()
    private static instance: BacktestStorage | null = null

    public static getInstance(): BacktestStorage {
        if (!BacktestStorage.instance) {
            BacktestStorage.instance = new BacktestStorage()
        }
        return BacktestStorage.instance
    }

    private setMemoryRecord(id: string, record: BacktestRecord): void {
        if (this.memoryRecords.size >= MAX_MEMORY_RECORDS && !this.memoryRecords.has(id)) {
            const oldestKey = this.memoryRecords.keys().next().value
            if (oldestKey !== undefined) {
                this.memoryRecords.delete(oldestKey)
            }
        }
        this.memoryRecords.set(id, record)
    }

    async acquireLock(portfolioId: string): Promise<boolean> {
        if (this.activeLocks.has(portfolioId)) {
            return false
        }
        this.activeLocks.set(portfolioId, {
            token: randomUUID(),
            acquiredAt: Date.now(),
        })
        return true
    }

    async releaseLock(portfolioId: string): Promise<void> {
        this.activeLocks.delete(portfolioId)
    }

    isLocked(portfolioId: string): boolean {
        return this.activeLocks.has(portfolioId)
    }

    async saveRecord(record: BacktestRecord): Promise<void> {
        this.setMemoryRecord(record.id, { ...record })

        if (isDbConfigured()) {
            try {
                await backtestDb.dbInsertBacktestRecord(record)
            } catch (err) {
                logger.error('[BACKTEST-STORAGE] Failed to insert record in PostgreSQL', { id: record.id, err })
            }
        } else {
            try {
                databaseService.insertBacktestRecord(record)
            } catch (err) {
                logger.error('[BACKTEST-STORAGE] Failed to insert record in SQLite', { id: record.id, err })
            }
        }
    }

    async updateRecord(id: string, updates: Partial<BacktestRecord>): Promise<void> {
        const existing = this.memoryRecords.get(id)
        if (existing) {
            Object.assign(existing, updates)
            existing.updatedAt = updates.updatedAt ?? new Date().toISOString()
        }

        if (isDbConfigured()) {
            try {
                await backtestDb.dbUpdateBacktestRecord(id, updates)
            } catch (err) {
                logger.error('[BACKTEST-STORAGE] Failed to update record in PostgreSQL', { id, err })
            }
        } else {
            try {
                databaseService.updateBacktestRecord(id, updates)
            } catch (err) {
                logger.error('[BACKTEST-STORAGE] Failed to update record in SQLite', { id, err })
            }
        }
    }

    async getRecord(id: string): Promise<BacktestRecord | null> {
        if (isDbConfigured()) {
            try {
                const dbRec = await backtestDb.dbGetBacktestRecord(id)
                if (dbRec) {
                    this.setMemoryRecord(id, dbRec)
                    return dbRec
                }
            } catch (err) {
                logger.error('[BACKTEST-STORAGE] Failed to get record from PostgreSQL', { id, err })
            }
        } else {
            try {
                const sqliteRec = databaseService.getBacktestRecord(id)
                if (sqliteRec) {
                    this.setMemoryRecord(id, sqliteRec)
                    return sqliteRec
                }
            } catch (err) {
                logger.error('[BACKTEST-STORAGE] Failed to get record from SQLite', { id, err })
            }
        }

        const memRec = this.memoryRecords.get(id)
        return memRec ? { ...memRec } : null
    }

    async listRecords(options?: {
        portfolioId?: string
        status?: string
        limit?: number
        offset?: number
    }): Promise<BacktestRecord[]> {
        if (isDbConfigured()) {
            try {
                return await backtestDb.dbListBacktestRecords(options)
            } catch (err) {
                logger.error('[BACKTEST-STORAGE] Failed to list records from PostgreSQL', { err })
            }
        } else {
            try {
                return databaseService.listBacktestRecords(options)
            } catch (err) {
                logger.error('[BACKTEST-STORAGE] Failed to list records from SQLite', { err })
            }
        }

        let records = Array.from(this.memoryRecords.values())
        if (options?.portfolioId) {
            records = records.filter((r) => r.portfolioId === options.portfolioId)
        }
        if (options?.status) {
            records = records.filter((r) => r.status === options.status)
        }
        records.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        const offset = options?.offset ?? 0
        const limit = options?.limit ?? 50
        return records.slice(offset, offset + limit)
    }

    clearMemory(): void {
        this.memoryRecords.clear()
        this.activeLocks.clear()
    }
}

export const backtestStorage = BacktestStorage.getInstance()
