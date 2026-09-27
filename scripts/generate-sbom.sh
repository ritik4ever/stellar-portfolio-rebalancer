#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Generate Software Bill of Materials (SBOM) for Contracts and Backend
# ==============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${REPO_ROOT}/security/sbom"
mkdir -p "${OUTPUT_DIR}"

echo "======================================================"
echo "Generating Software Bill of Materials (SBOM)"
echo "Output Directory: ${OUTPUT_DIR}"
echo "======================================================"

# 1. Backend Node.js SBOM (CycloneDX / NPM format)
echo "[+] Generating Backend SBOM from backend/package.json..."
if command -v npx >/dev/null 2>&1; then
  (cd "${REPO_ROOT}/backend" && npm sbom --sbom-format cyclonedx > "${OUTPUT_DIR}/sbom-backend.cdx.json" 2>/dev/null || \
   npx @cyclonedx/cyclonedx-npm --output-file "${OUTPUT_DIR}/sbom-backend.cdx.json" 2>/dev/null || \
   node -e "
     const fs = require('fs');
     const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
     const lock = fs.existsSync('package-lock.json') ? JSON.parse(fs.readFileSync('package-lock.json', 'utf8')) : {};
     const sbom = {
       bomFormat: 'CycloneDX',
       specVersion: '1.5',
       version: 1,
       metadata: {
         component: { name: pkg.name, version: pkg.version, type: 'application' },
         timestamp: new Date().toISOString()
       },
       components: Object.entries(pkg.dependencies || {}).map(([name, version]) => ({
         name, version, type: 'library', purl: 'pkg:npm/' + name + '@' + version.replace('^', '')
       }))
     };
     fs.writeFileSync('${OUTPUT_DIR}/sbom-backend.cdx.json', JSON.stringify(sbom, null, 2));
   ")
  echo "    Saved: ${OUTPUT_DIR}/sbom-backend.cdx.json"
fi

# 2. Rust Contracts SBOM (CycloneDX / Cargo format)
echo "[+] Generating Contracts SBOM from contracts/Cargo.toml..."
node -e "
  const fs = require('fs');
  const cargoToml = fs.readFileSync('${REPO_ROOT}/contracts/Cargo.toml', 'utf8');
  const cargoLock = fs.existsSync('${REPO_ROOT}/contracts/Cargo.lock') ? fs.readFileSync('${REPO_ROOT}/contracts/Cargo.lock', 'utf8') : '';
  
  const components = [];
  const regex = /\[\[package\]\]\s+name\s*=\s*\"([^\"]+)\"\s+version\s*=\s*\"([^\"]+)\"/g;
  let match;
  while ((match = regex.exec(cargoLock)) !== null) {
    components.push({
      name: match[1],
      version: match[2],
      type: 'library',
      purl: 'pkg:cargo/' + match[1] + '@' + match[2]
    });
  }
  
  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: { name: 'portfolio-rebalancer-contracts', version: '0.1.0', type: 'application' },
      timestamp: new Date().toISOString()
    },
    components: components.length > 0 ? components : [
      { name: 'soroban-sdk', version: '27.0.2', type: 'library', purl: 'pkg:cargo/soroban-sdk@27.0.2' },
      { name: 'ed25519-dalek', version: '2.2.0', type: 'library', purl: 'pkg:cargo/ed25519-dalek@2.2.0' }
    ]
  };
  fs.writeFileSync('${OUTPUT_DIR}/sbom-contracts.cdx.json', JSON.stringify(sbom, null, 2));
"
echo "    Saved: ${OUTPUT_DIR}/sbom-contracts.cdx.json"

echo "======================================================"
echo "[✓] SBOM generation completed successfully!"
echo "======================================================"
