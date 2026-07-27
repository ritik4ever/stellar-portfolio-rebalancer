import { describe, it, expect } from 'vitest'
import {
    LEGAL_BUNDLE_VERSION,
    LEGAL_EFFECTIVE_DATE,
    formatLegalVersionLabel,
} from './legalMetadata'

describe('legalMetadata', () => {
    it('exposes stable version and effective date', () => {
        expect(LEGAL_BUNDLE_VERSION).toMatch(/^\d{4}\.\d{2}\.\d{2}$/)
        expect(LEGAL_EFFECTIVE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(formatLegalVersionLabel()).toContain(LEGAL_BUNDLE_VERSION)
        expect(formatLegalVersionLabel()).toContain(LEGAL_EFFECTIVE_DATE)
    })
})
