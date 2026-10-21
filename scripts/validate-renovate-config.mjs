#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Validates renovate.json against the repository's active components and toolchains.
 * Prevents configuration drift between renovate.json and source code / infrastructure.
 *
 * Checks:
 * 1. JSON syntax and schema reference
 * 2. Enabled managers correspond to existing project files
 * 3. Required ignore paths for build and VCS artifacts
 * 4. Datasources and update rules match Renovate conventions
 */

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (p) => readFileSync(join(root, p), 'utf8')
const exists = (p) => existsSync(join(root, p))

export function validateRenovateConfig(config = null) {
  const errors = []

  if (!config) {
    try {
      config = JSON.parse(read('renovate.json'))
    } catch (e) {
      return { valid: false, errors: [`Failed to parse renovate.json: ${e.message}`] }
    }
  }

  // Schema validation
  if (!config.$schema || !config.$schema.includes('renovate-schema.json')) {
    errors.push('Missing or invalid $schema reference in renovate.json.')
  }

  // Check extends
  if (!Array.isArray(config.extends) || config.extends.length === 0) {
    errors.push('renovate.json should specify base configuration in "extends".')
  }

  // Manager to file mapping
  const MANAGER_EVIDENCE = {
    npm: ['package.json'],
    cargo: ['contracts/Cargo.toml'],
    dockerfile: ['Dockerfile', 'backend/Dockerfile', 'frontend/Dockerfile'],
    'docker-compose': ['docker-compose.resources.yml', 'deployment/docker-compose.yml'],
    'github-actions': ['.github/workflows'],
    terraform: ['terraform/main.tf', 'terraform/versions.tf'],
    'pre-commit': ['.pre-commit-config.yaml'],
  }

  const enabledManagers = new Set(config.enabledManagers || [])

  for (const [manager, paths] of Object.entries(MANAGER_EVIDENCE)) {
    const hasEvidence = paths.some((p) => exists(p))
    if (hasEvidence && !enabledManagers.has(manager)) {
      errors.push(`Repository has evidence for "${manager}" (${paths.find((p) => exists(p))}), but manager is missing from enabledManagers.`)
    }
    if (!hasEvidence && enabledManagers.has(manager)) {
      errors.push(`Manager "${manager}" is enabled in renovate.json, but no matching files found in repository.`)
    }
  }

  // Verify ignorePaths
  const ignorePaths = new Set(config.ignorePaths || [])
  const REQUIRED_IGNORES = [
    '**/node_modules/**',
    '**/target/**',
    '.git/**',
  ]

  for (const req of REQUIRED_IGNORES) {
    if (!ignorePaths.has(req)) {
      errors.push(`Missing essential ignore path: "${req}" in ignorePaths.`)
    }
  }

  // Verify packageRules datasources
  const VALID_DATASOURCES = new Set([
    'npm',
    'crate',
    'docker',
    'github-runners',
    'github-tags',
    'node-version',
    'rust-version',
  ])

  for (const rule of config.packageRules || []) {
    if (rule.matchDatasources) {
      for (const ds of rule.matchDatasources) {
        if (!VALID_DATASOURCES.has(ds)) {
          errors.push(`Invalid datasource "${ds}" in packageRules (description: "${rule.description || 'unnamed'}").`)
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// CLI runner
if (process.argv[1] && process.argv[1].endsWith('validate-renovate-config.mjs')) {
  const result = validateRenovateConfig()
  if (!result.valid) {
    console.error('[renovate-validation] FAIL: renovate.json has configuration mismatches:')
    for (const err of result.errors) {
      console.error(`  - ${err}`)
    }
    process.exit(1)
  }
  console.log('[renovate-validation] OK: renovate.json matches what the application reads and needs.')
  process.exit(0)
}
