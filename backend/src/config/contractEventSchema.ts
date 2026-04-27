/**
 * Backend expectations for Soroban contract events consumed by {@link ContractEventIndexerService}.
 * Bump {@link BACKEND_CONTRACT_EVENT_SCHEMA_VERSION} when topic names or payload tuple shapes change.
 */

export const BACKEND_CONTRACT_EVENT_SCHEMA_VERSION = 1

export interface ContractEventSchemaCheck {
    ok: boolean
    message?: string
}

export function checkContractEventSchemaVersion(): ContractEventSchemaCheck {
    const declared = process.env.CONTRACT_EVENT_SCHEMA_VERSION?.trim()
    if (!declared) return { ok: true }
    if (!/^\d+$/.test(declared)) {
        return { ok: false, message: 'CONTRACT_EVENT_SCHEMA_VERSION must be a non-negative integer string' }
    }
    const n = parseInt(declared, 10)
    if (n !== BACKEND_CONTRACT_EVENT_SCHEMA_VERSION) {
        return {
            ok: false,
            message:
                `CONTRACT_EVENT_SCHEMA_VERSION=${n} does not match backend expected ${BACKEND_CONTRACT_EVENT_SCHEMA_VERSION}. ` +
                'Align the deployed contract with docs/CONTRACT_EVENTS.md or use a matching backend release.'
        }
    }
    return { ok: true }
}
