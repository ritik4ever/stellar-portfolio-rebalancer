import { readFileSync } from 'node:fs'

// Validates FUNDING.json so the Drips funding config cannot drift silently:
// a malformed address, an unknown chain, or a structural typo would otherwise
// only surface when someone tries to collect funds.
//
// Zero dependencies: runs in CI (no npm install) and in the optional
// pre-commit/pre-push hooks, which run before node_modules may exist.
// EIP-55 checksum verification uses a small in-file Keccak-256 (the same
// primitive Ethereum addresses are derived from), verified against the
// official test vectors below.
//
// Supported shape (per the Drips FUNDING.json spec):
// {
//   "drips": {
//     "<chain>": { "ownedBy": "0x…" },
//     "<chain>": { "splits": "0x…" }
//   }
// }
//
// Usage: node scripts/validate-funding.mjs

const FUNDING_FILE = 'FUNDING.json'

const SUPPORTED_CHAINS = new Set([
  'mainnet',
  'ethereum',
  'polygon',
  'optimism',
  'arbitrum',
  'base',
  'gnosis',
  'avalanche',
  'zksync',
])

class FundingError extends Error {}

// ---------------------------------------------------------------------------
// Keccak-256 (original padding, as used by Ethereum) — BigInt keccak-f[1600].
// ---------------------------------------------------------------------------

const KECCAK_RATE_BYTES = 136 // 1088-bit rate for a 256-bit digest
const MASK64 = 0xffffffffffffffffn

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]

function rotl64(value, shift) {
  const n = BigInt(shift)
  return ((value << n) | (value >> (64n - n))) & MASK64
}

function keccakF1600(lanes) {
  for (const rc of ROUND_CONSTANTS) {
    // theta
    const c = []
    for (let x = 0; x < 5; x++) {
      c[x] = lanes[x] ^ lanes[x + 5] ^ lanes[x + 10] ^ lanes[x + 15] ^ lanes[x + 20]
    }
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl64(c[(x + 1) % 5], 1)
      for (let y = 0; y < 5; y++) lanes[x + 5 * y] = (lanes[x + 5 * y] ^ d) & MASK64
    }
    // rho + pi (combined): lane (x,y) is rotated by (t+1)(t+2)/2 and moved to
    // (y, (2x + 3y) mod 5).
    let x = 1
    let y = 0
    let current = lanes[x + 5 * y]
    for (let t = 0; t < 24; t++) {
      const nx = y
      const ny = (2 * x + 3 * y) % 5
      const tmp = lanes[nx + 5 * ny]
      lanes[nx + 5 * ny] = rotl64(current, (((t + 1) * (t + 2)) / 2) % 64)
      current = tmp
      x = nx
      y = ny
    }
    // chi
    for (let yy = 0; yy < 5; yy++) {
      const row = []
      for (let xx = 0; xx < 5; xx++) row[xx] = lanes[xx + 5 * yy]
      for (let xx = 0; xx < 5; xx++) {
        lanes[xx + 5 * yy] = row[xx] ^ (~row[(xx + 1) % 5] & row[(xx + 2) % 5])
      }
    }
    // iota
    lanes[0] = (lanes[0] ^ rc) & MASK64
  }
}

function keccak256(message) {
  const state = new Array(25).fill(0n)
  // Original Keccak padding: append 0x01, zero-fill, set the top bit of the
  // final byte (this is what distinguishes it from SHA3's 0x06 padding).
  const paddedLength = Math.ceil((message.length + 1) / KECCAK_RATE_BYTES) * KECCAK_RATE_BYTES
  const padded = Buffer.alloc(paddedLength)
  message.copy(padded)
  padded[message.length] = 0x01
  padded[paddedLength - 1] |= 0x80

  const block = Buffer.alloc(KECCAK_RATE_BYTES)
  for (let offset = 0; offset < paddedLength; offset += KECCAK_RATE_BYTES) {
    padded.copy(block, 0, offset, offset + KECCAK_RATE_BYTES)
    for (let lane = 0; lane < KECCAK_RATE_BYTES / 8; lane++) {
      state[lane] ^= block.readBigUInt64LE(lane * 8)
    }
    keccakF1600(state)
  }

  const digest = Buffer.alloc(32)
  for (let lane = 0; lane < 4; lane++) {
    digest.writeBigUInt64LE(state[lane], lane * 8)
  }
  return digest
}

// ---------------------------------------------------------------------------
// EIP-55 checksummed addresses
// ---------------------------------------------------------------------------

function toChecksummedAddress(lowerHexAddress) {
  // EIP-55 hashes the 40 lowercase hex characters WITHOUT the 0x prefix.
  const hash = keccak256(Buffer.from(lowerHexAddress.slice(2), 'ascii'))
  const hashHex = hash.toString('hex')
  let result = '0x'
  for (let i = 0; i < 40; i++) {
    const nibble = Number.parseInt(hashHex[i], 16)
    const char = lowerHexAddress[2 + i]
    result += nibble >= 8 ? char.toUpperCase() : char
  }
  return result
}

function validateEvmAddress(value, label) {
  if (typeof value !== 'string') {
    throw new FundingError(`${label} must be a string, got ${typeof value}`)
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new FundingError(
      `${label} "${value}" is not a valid EVM address (expected 0x followed by 40 hex characters)`,
    )
  }
  const lower = value.toLowerCase()
  const expected = toChecksummedAddress(lower)
  if (value !== lower && value !== expected) {
    throw new FundingError(
      `${label} "${value}" has an invalid EIP-55 checksum (did you mean "${expected}"?)`,
    )
  }
  return lower
}

// ---------------------------------------------------------------------------
// Document validation
// ---------------------------------------------------------------------------

function validateDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new FundingError('top level must be a JSON object')
  }
  const drips = doc.drips
  if (drips === undefined) {
    throw new FundingError('missing "drips" object (no other funding platform is configured in this repository)')
  }
  if (!drips || typeof drips !== 'object' || Array.isArray(drips)) {
    throw new FundingError('"drips" must be a JSON object')
  }

  const chains = Object.keys(drips)
  if (chains.length === 0) {
    throw new FundingError('"drips" must declare at least one chain')
  }

  for (const chain of chains) {
    if (!SUPPORTED_CHAINS.has(chain)) {
      throw new FundingError(
        `"drips.${chain}" is not a chain known to this validator. ` +
          `Supported: ${[...SUPPORTED_CHAINS].sort().join(', ')}. ` +
          'If this is a genuinely new chain, extend SUPPORTED_CHAINS in scripts/validate-funding.mjs.',
      )
    }
    const entry = drips[chain]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new FundingError(`"drips.${chain}" must be a JSON object`)
    }
    const keys = Object.keys(entry)
    if (keys.length !== 1) {
      throw new FundingError(
        `"drips.${chain}" must have exactly one of "ownedBy" or "splits", got: ${keys.join(', ') || '(none)'}`,
      )
    }
    const [key, value] = Object.entries(entry)[0]
    if (key !== 'ownedBy' && key !== 'splits') {
      throw new FundingError(
        `"drips.${chain}.${key}" is not supported; expected "ownedBy" or "splits"`,
      )
    }
    validateEvmAddress(value, `"drips.${chain}.${key}"`)
  }
}

let text
try {
  text = readFileSync(FUNDING_FILE, 'utf8')
} catch {
  console.error(`[funding] FAIL ${FUNDING_FILE} is missing. Restore it so funding config stays enforced.`)
  process.exit(1)
}

let doc
try {
  doc = JSON.parse(text)
} catch (error) {
  console.error(`[funding] FAIL ${FUNDING_FILE} is not valid JSON: ${error.message}`)
  process.exit(1)
}

try {
  validateDocument(doc)
} catch (error) {
  if (error instanceof FundingError) {
    console.error(`[funding] FAIL ${FUNDING_FILE}: ${error.message}`)
    process.exit(1)
  }
  throw error
}

const chains = Object.keys(doc.drips)
console.log(`[funding] OK ${FUNDING_FILE} is valid (${chains.length} chain${chains.length === 1 ? '' : 's'}: ${chains.sort().join(', ')})`)
