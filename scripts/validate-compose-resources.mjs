import { readFileSync } from 'node:fs'

// Validates that docker-compose.resources.yml is an exact mirror of the
// deploy.resources.limits declared in deployment/docker-compose.yml.
//
// This script deliberately uses a small YAML subset parser instead of a
// dependency: it must run in environments without node_modules (CI installs
// nothing, and the optional pre-commit hook runs before npm install). It only
// accepts the YAML constructs actually used by the two files — nested
// mappings, flow mappings ({ k: v }) and opaque flow/block sequences — and
// exits non-zero on anything else, so a syntax change cannot silently bypass
// the parity check. Sequences carry nothing the limits check needs, so their
// contents are skipped rather than modeled.
//
// Usage: node scripts/validate-compose-resources.mjs [--check]
//   (no flag)  Also validate when deployment/docker-compose.yml is absent
//              (used by the optional pre-push hook).
//   --check    Skip validation when deployment/docker-compose.yml is absent
//              (used by CI / local checks on shallow checkouts).

const args = process.argv.slice(2)
const checkMode = args.includes('--check')

const SOURCE = 'deployment/docker-compose.yml'
const MIRROR = 'docker-compose.resources.yml'

class YamlSubsetError extends Error {}

function parseYamlSubset(text) {
  if (text.includes('\t')) {
    throw new YamlSubsetError('tabs are not allowed for YAML indentation')
  }

  const root = {}
  // Stack of { indent, container } mapping containers currently open.
  const stack = [{ indent: -1, container: root }]
  // Indent of a YAML sequence block currently being skipped, if any.
  let seqIndent = null

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lineNo = i + 1

    // Strip trailing comments that are not inside quotes.
    const withoutComment = stripComment(raw)
    if (withoutComment.trim() === '') continue

    const indent = withoutComment.length - withoutComment.trimStart().length
    const content = withoutComment.trim()

    // Skip the remainder of a sequence block until we dedent past it.
    if (seqIndent !== null) {
      if (indent >= seqIndent) continue
      seqIndent = null
    }

    // A sequence item starts a block we do not model (ports, profiles,
    // healthcheck lists, ...); skip it and everything nested inside it.
    if (content === '-' || content.startsWith('- ')) {
      seqIndent = indent
      continue
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }

    const parent = stack[stack.length - 1].container

    const flowMatch = content.match(/^([^:]+):\s*(\{.*\})$/)
    if (flowMatch) {
      if (typeof parent !== 'object' || Array.isArray(parent)) {
        throw new YamlSubsetError(`line ${lineNo}: unexpected flow mapping position`)
      }
      const key = parseScalar(flowMatch[1].trim(), lineNo)
      parent[key] = parseFlowMapping(flowMatch[2], lineNo)
      continue
    }

    const mapMatch = content.match(/^([^:]+):\s*$/)
    if (mapMatch) {
      if (typeof parent !== 'object' || Array.isArray(parent)) {
        throw new YamlSubsetError(`line ${lineNo}: unexpected mapping position`)
      }
      const key = parseScalar(mapMatch[1].trim(), lineNo)
      const child = {}
      parent[key] = child
      stack.push({ indent, container: child })
      continue
    }

    const scalarMatch = content.match(/^([^:]+):\s*(.+)$/)
    if (scalarMatch) {
      if (typeof parent !== 'object' || Array.isArray(parent)) {
        throw new YamlSubsetError(`line ${lineNo}: unexpected scalar position`)
      }
      const key = parseScalar(scalarMatch[1].trim(), lineNo)
      const value = scalarMatch[2].trim()
      if (value.startsWith('[') && value.endsWith(']')) {
        // Opaque flow sequence (e.g. command: ["sh", "-c", "..."]): the
        // contents never matter for limit validation.
        parent[key] = { __flowSequence: true }
        continue
      }
      parent[key] = parseScalar(value, lineNo)
      continue
    }

    throw new YamlSubsetError(
      `line ${lineNo}: unsupported YAML construct: "${content}". ` +
        'This validator only supports the mappings and { k: v } flow mappings used by the compose files.',
    )
  }

  return root
}

function stripComment(line) {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (ch === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i)
    }
  }
  return line
}

function parseFlowMapping(text, lineNo) {
  const inner = text.trim()
  if (!inner.startsWith('{') || !inner.endsWith('}')) {
    throw new YamlSubsetError(`line ${lineNo}: malformed flow mapping: ${text}`)
  }
  const body = inner.slice(1, -1).trim()
  const result = {}
  if (body === '') return result
  for (const part of splitTopLevel(body, ',')) {
    const idx = part.indexOf(':')
    if (idx === -1) {
      throw new YamlSubsetError(`line ${lineNo}: malformed flow mapping entry: ${part}`)
    }
    const key = parseScalar(part.slice(0, idx).trim(), lineNo)
    result[key] = parseScalar(part.slice(idx + 1).trim(), lineNo)
  }
  return result
}

function splitTopLevel(text, separator) {
  const parts = []
  let current = ''
  let inSingle = false
  let inDouble = false
  for (const ch of text) {
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    if (ch === separator && !inSingle && !inDouble) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

function parseScalar(value, lineNo) {
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return JSON.parse(value)
  }
  if (value.startsWith('$')) {
    // Environment substitution (e.g. ${REDIS_URL:-redis://redis:6379}): opaque
    // to this validator, which only inspects deploy.resources.limits.
    return value
  }
  if (/:$/.test(value) || value.includes(': ') || /^[&*!|>%@`{}\[\],]/.test(value)) {
    throw new YamlSubsetError(`line ${lineNo}: unsupported scalar: ${value}`)
  }
  return value
}

function collectLimits(doc, label) {
  const services = doc.services
  if (!services || typeof services !== 'object' || Array.isArray(services)) {
    throw new YamlSubsetError(`${label}: missing "services" mapping`)
  }

  const limits = {}
  for (const [name, service] of Object.entries(services)) {
    if (!service || typeof service !== 'object' || Array.isArray(service)) {
      throw new YamlSubsetError(`${label}: service "${name}" is not a mapping`)
    }
    const deploy = service.deploy
    if (deploy === undefined) continue
    if (deploy === null || typeof deploy !== 'object' || Array.isArray(deploy)) {
      throw new YamlSubsetError(`${label}: service "${name}" has a non-mapping "deploy"`)
    }
    const resources = deploy.resources
    if (resources === undefined || resources === null) {
      throw new YamlSubsetError(`${label}: service "${name}" has deploy without "resources"`)
    }
    if (typeof resources !== 'object' || Array.isArray(resources)) {
      throw new YamlSubsetError(`${label}: service "${name}" has a non-mapping "deploy.resources"`)
    }
    if (resources.reservations !== undefined) {
      throw new YamlSubsetError(
        `${label}: service "${name}" uses deploy.resources.reservations, which the mirror does not track. ` +
          'Either drop it or extend scripts/validate-compose-resources.mjs.',
      )
    }
    const limitsBlock = resources.limits
    if (limitsBlock === undefined || limitsBlock === null) {
      throw new YamlSubsetError(`${label}: service "${name}" has deploy.resources without "limits"`)
    }
    if (typeof limitsBlock !== 'object' || Array.isArray(limitsBlock)) {
      throw new YamlSubsetError(`${label}: service "${name}" has a non-mapping "deploy.resources.limits"`)
    }
    const { cpus, memory } = limitsBlock
    if (typeof cpus !== 'string' || !/^\d+(\.\d+)?$/.test(cpus)) {
      throw new YamlSubsetError(
        `${label}: service "${name}" has deploy.resources.limits.cpus "${cpus}", expected a decimal string like "0.5"`,
      )
    }
    if (typeof memory !== 'string' || !/^\d+(?:\.\d+)?(?:b|k|m|g)$/i.test(memory)) {
      throw new YamlSubsetError(
        `${label}: service "${name}" has deploy.resources.limits.memory "${memory}", expected a byte value like "256M"`,
      )
    }
    limits[name] = { cpus, memory: memory.toLowerCase() }
  }
  return limits
}

function formatDiff(limits) {
  const names = [...new Set([...Object.keys(limits.source), ...Object.keys(limits.mirror)])].sort()
  const problems = []
  for (const name of names) {
    const inSource = limits.source[name]
    const inMirror = limits.mirror[name]
    if (inSource && !inMirror) {
      problems.push(`  ${name}: present in ${SOURCE} (cpus ${inSource.cpus}, memory ${inSource.memory}) but missing in ${MIRROR}`)
    } else if (!inSource && inMirror) {
      problems.push(`  ${name}: present in ${MIRROR} (cpus ${inMirror.cpus}, memory ${inMirror.memory}) but not in ${SOURCE}`)
    } else if (inSource.cpus !== inMirror.cpus || inSource.memory !== inMirror.memory) {
      problems.push(
        `  ${name}: ${SOURCE} has cpus ${inSource.cpus}, memory ${inSource.memory} but ${MIRROR} has cpus ${inMirror.cpus}, memory ${inMirror.memory}`,
      )
    }
  }
  return problems
}

let sourceText
try {
  sourceText = readFileSync(SOURCE, 'utf8')
} catch {
  if (checkMode) {
    console.log(`[compose-resources] SKIP ${SOURCE} not present (shallow checkout?)`)
    process.exit(0)
  }
  console.error(`[compose-resources] FAIL ${SOURCE} is required for validation but was not found.`)
  process.exit(1)
}

let mirrorText
try {
  mirrorText = readFileSync(MIRROR, 'utf8')
} catch {
  console.error(`[compose-resources] FAIL ${MIRROR} is missing. Restore it to mirror ${SOURCE}.`)
  process.exit(1)
}

let sourceLimits
let mirrorLimits
try {
  sourceLimits = collectLimits(parseYamlSubset(sourceText), SOURCE)
  mirrorLimits = collectLimits(parseYamlSubset(mirrorText), MIRROR)
} catch (error) {
  console.error(`[compose-resources] FAIL ${error.message}`)
  process.exit(1)
}

const problems = formatDiff({ source: sourceLimits, mirror: mirrorLimits })
if (problems.length > 0) {
  console.error(`[compose-resources] FAIL ${MIRROR} does not match ${SOURCE}:`)
  for (const problem of problems) console.error(problem)
  console.error('')
  console.error('Update the limits in deployment/docker-compose.yml first, then regenerate')
  console.error(`${MIRROR} so the two files agree.`)
  process.exit(1)
}

console.log(
  `[compose-resources] OK ${MIRROR} matches ${SOURCE} (${Object.keys(sourceLimits).length} services with resource limits)`,
)
