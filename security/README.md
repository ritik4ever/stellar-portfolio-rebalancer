# Security & Compliance Tooling

This directory contains security baselines, vulnerability auditing configurations, and Software Bill of Materials (SBOM) specifications for `stellar-portfolio-rebalancer`.

---

## Software Bill of Materials (SBOM)

We maintain CycloneDX-compliant (v1.5) Software Bill of Materials (SBOM) for both the on-chain Soroban contracts and the Node.js backend services.

### Generated Artifacts
- `security/sbom/sbom-contracts.cdx.json`: Complete dependency inventory of the Rust contracts crate (`soroban-sdk`, `ed25519-dalek`, cryptographic libraries).
- `security/sbom/sbom-backend.cdx.json`: Complete dependency tree of the TypeScript/Node.js backend API and workers.

### Generating SBOM Locally
Run the generation script:
```bash
./scripts/generate-sbom.sh
```
Or via npm:
```bash
npm run sbom
```

### Automated CI/CD Generation
SBOM generation runs automatically on release builds and dependency updates via `.github/workflows/sbom.yml`.

### Vulnerability Scanning & Compliance Ingestion
The generated CycloneDX SBOM files can be scanned with industry-standard compliance and security tools:
- **Trivy**: `trivy sbom security/sbom/sbom-contracts.cdx.json`
- **Grype**: `grype sbom:security/sbom/sbom-backend.cdx.json`
- **Dependency-Track**: Ingest automatically via REST API into enterprise compliance portals.
