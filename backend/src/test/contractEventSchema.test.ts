import { describe, expect, it, afterEach } from 'vitest'
import {
    BACKEND_CONTRACT_EVENT_SCHEMA_VERSION,
    checkContractEventSchemaVersion
} from '../config/contractEventSchema.js'

describe('contractEventSchema', () => {
    const original = process.env.CONTRACT_EVENT_SCHEMA_VERSION

    afterEach(() => {
        if (original === undefined) delete process.env.CONTRACT_EVENT_SCHEMA_VERSION
        else process.env.CONTRACT_EVENT_SCHEMA_VERSION = original
    })

    it('allows omitting CONTRACT_EVENT_SCHEMA_VERSION', () => {
        delete process.env.CONTRACT_EVENT_SCHEMA_VERSION
        expect(checkContractEventSchemaVersion()).toEqual({ ok: true })
    })

    it('allows matching version', () => {
        process.env.CONTRACT_EVENT_SCHEMA_VERSION = String(BACKEND_CONTRACT_EVENT_SCHEMA_VERSION)
        expect(checkContractEventSchemaVersion()).toEqual({ ok: true })
    })

    it('rejects mismatching version', () => {
        process.env.CONTRACT_EVENT_SCHEMA_VERSION = String(BACKEND_CONTRACT_EVENT_SCHEMA_VERSION + 99)
        const r = checkContractEventSchemaVersion()
        expect(r.ok).toBe(false)
        expect(r.message).toMatch(/does not match backend expected/)
    })

    it('rejects non-integer values', () => {
        process.env.CONTRACT_EVENT_SCHEMA_VERSION = 'v1'
        const r = checkContractEventSchemaVersion()
        expect(r.ok).toBe(false)
        expect(r.message).toMatch(/integer/)
    })
})
