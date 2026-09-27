import { describe, it, expect } from 'vitest'
import {
    parseAnalyticsCompactionConfig,
    getAnalyticsCompactionConfig,
    DEFAULT_ANALYTICS_COMPACTION_CUTOFF_DAYS,
    DEFAULT_ANALYTICS_COMPACTION_RECENT_DAYS,
    MIN_ANALYTICS_COMPACTION_CUTOFF_DAYS,
    MAX_ANALYTICS_COMPACTION_CUTOFF_DAYS,
    MIN_ANALYTICS_COMPACTION_RECENT_DAYS,
    MAX_ANALYTICS_COMPACTION_RECENT_DAYS,
} from '../config/analyticsCompactionConfig.js'

describe('Analytics Compaction Config', () => {
    describe('parseAnalyticsCompactionConfig', () => {
        it('should return default values when env is empty', () => {
            const { config, errors } = parseAnalyticsCompactionConfig({})
            expect(errors).toHaveLength(0)
            expect(config.cutoffDays).toBe(DEFAULT_ANALYTICS_COMPACTION_CUTOFF_DAYS) // 90
            expect(config.recentDays).toBe(DEFAULT_ANALYTICS_COMPACTION_RECENT_DAYS) // 7
        })

        it('should parse valid custom ANALYTICS_COMPACTION_CUTOFF_DAYS and ANALYTICS_COMPACTION_RECENT_DAYS', () => {
            const { config, errors } = parseAnalyticsCompactionConfig({
                ANALYTICS_COMPACTION_CUTOFF_DAYS: '180',
                ANALYTICS_COMPACTION_RECENT_DAYS: '14',
            })
            expect(errors).toHaveLength(0)
            expect(config.cutoffDays).toBe(180)
            expect(config.recentDays).toBe(14)
        })

        it('should support legacy/alternative environment variable aliases', () => {
            const { config: config1, errors: errors1 } = parseAnalyticsCompactionConfig({
                ANALYTICS_RETENTION_DAYS: '60',
                ANALYTICS_RAW_RETENTION_DAYS: '3',
            })
            expect(errors1).toHaveLength(0)
            expect(config1.cutoffDays).toBe(60)
            expect(config1.recentDays).toBe(3)

            const { config: config2, errors: errors2 } = parseAnalyticsCompactionConfig({
                ANALYTICS_SNAPSHOT_RETENTION_DAYS: '120',
                ANALYTICS_SNAPSHOT_RAW_DAYS: '10',
            })
            expect(errors2).toHaveLength(0)
            expect(config2.cutoffDays).toBe(120)
            expect(config2.recentDays).toBe(10)
        })

        it('should reject non-integer values and fall back to defaults', () => {
            const { config, errors } = parseAnalyticsCompactionConfig({
                ANALYTICS_COMPACTION_CUTOFF_DAYS: 'not-a-number',
                ANALYTICS_COMPACTION_RECENT_DAYS: 'abc',
            })
            expect(errors.length).toBeGreaterThan(0)
            expect(config.cutoffDays).toBe(DEFAULT_ANALYTICS_COMPACTION_CUTOFF_DAYS)
            expect(config.recentDays).toBe(DEFAULT_ANALYTICS_COMPACTION_RECENT_DAYS)
        })

        it('should reject fractional numbers (e.g. 1.9, 30.5) and fall back to defaults', () => {
            const { config, errors } = parseAnalyticsCompactionConfig({
                ANALYTICS_COMPACTION_CUTOFF_DAYS: '30.5',
                ANALYTICS_COMPACTION_RECENT_DAYS: '1.9',
            })
            expect(errors.length).toBe(2)
            expect(errors[0]).toContain("ANALYTICS_COMPACTION_CUTOFF_DAYS '30.5' is invalid")
            expect(errors[1]).toContain("ANALYTICS_COMPACTION_RECENT_DAYS '1.9' is invalid")
            expect(config.cutoffDays).toBe(DEFAULT_ANALYTICS_COMPACTION_CUTOFF_DAYS)
            expect(config.recentDays).toBe(DEFAULT_ANALYTICS_COMPACTION_RECENT_DAYS)
        })

        it('should reject numbers with text suffix (e.g. 90days, 7days) and fall back to defaults', () => {
            const { config, errors } = parseAnalyticsCompactionConfig({
                ANALYTICS_COMPACTION_CUTOFF_DAYS: '90days',
                ANALYTICS_COMPACTION_RECENT_DAYS: '7days',
            })
            expect(errors.length).toBe(2)
            expect(errors[0]).toContain("ANALYTICS_COMPACTION_CUTOFF_DAYS '90days' is invalid")
            expect(errors[1]).toContain("ANALYTICS_COMPACTION_RECENT_DAYS '7days' is invalid")
            expect(config.cutoffDays).toBe(DEFAULT_ANALYTICS_COMPACTION_CUTOFF_DAYS)
            expect(config.recentDays).toBe(DEFAULT_ANALYTICS_COMPACTION_RECENT_DAYS)
        })

        it('should reject values below minimum', () => {
            const { config, errors } = parseAnalyticsCompactionConfig({
                ANALYTICS_COMPACTION_CUTOFF_DAYS: '0',
                ANALYTICS_COMPACTION_RECENT_DAYS: '-5',
            })
            expect(errors.length).toBeGreaterThan(0)
            expect(config.cutoffDays).toBe(DEFAULT_ANALYTICS_COMPACTION_CUTOFF_DAYS)
            expect(config.recentDays).toBe(DEFAULT_ANALYTICS_COMPACTION_RECENT_DAYS)
        })

        it('should reject values exceeding maximum', () => {
            const { config, errors } = parseAnalyticsCompactionConfig({
                ANALYTICS_COMPACTION_CUTOFF_DAYS: String(MAX_ANALYTICS_COMPACTION_CUTOFF_DAYS + 1),
                ANALYTICS_COMPACTION_RECENT_DAYS: String(MAX_ANALYTICS_COMPACTION_RECENT_DAYS + 1),
            })
            expect(errors.length).toBeGreaterThan(0)
            expect(config.cutoffDays).toBe(DEFAULT_ANALYTICS_COMPACTION_CUTOFF_DAYS)
            expect(config.recentDays).toBe(DEFAULT_ANALYTICS_COMPACTION_RECENT_DAYS)
        })

        it('should reject when cutoffDays < recentDays and fall back to safe defaults', () => {
            const { config, errors } = parseAnalyticsCompactionConfig({
                ANALYTICS_COMPACTION_CUTOFF_DAYS: '5',
                ANALYTICS_COMPACTION_RECENT_DAYS: '10',
            })
            expect(errors).toContain(
                'ANALYTICS_COMPACTION_CUTOFF_DAYS (5) must be greater than or equal to ANALYTICS_COMPACTION_RECENT_DAYS (10).',
            )
            expect(config.cutoffDays).toBe(DEFAULT_ANALYTICS_COMPACTION_CUTOFF_DAYS)
            expect(config.recentDays).toBe(DEFAULT_ANALYTICS_COMPACTION_RECENT_DAYS)
        })

        it('should allow equal cutoffDays and recentDays (boundary condition)', () => {
            const { config, errors } = parseAnalyticsCompactionConfig({
                ANALYTICS_COMPACTION_CUTOFF_DAYS: '7',
                ANALYTICS_COMPACTION_RECENT_DAYS: '7',
            })
            expect(errors).toHaveLength(0)
            expect(config.cutoffDays).toBe(7)
            expect(config.recentDays).toBe(7)
        })
    })

    describe('getAnalyticsCompactionConfig', () => {
        it('should return config object directly', () => {
            const config = getAnalyticsCompactionConfig({
                ANALYTICS_COMPACTION_CUTOFF_DAYS: '45',
                ANALYTICS_COMPACTION_RECENT_DAYS: '5',
            })
            expect(config).toEqual({
                cutoffDays: 45,
                recentDays: 5,
            })
        })
    })
})
