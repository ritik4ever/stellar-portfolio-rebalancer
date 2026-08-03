# Dependency Audit Process

## What is Scanned
| Tool | Target | Path |
| --- | --- | --- |
| npm audit | Node.js dependencies | Root (`.`), `backend/`, `frontend/` |
| cargo audit | Rust dependencies | `contracts/` |

## When Scans Run
- **Per-PR**: Scans run on PRs when relevant dependency files (`package.json`, `Cargo.toml`, etc.) are modified.
- **Daily**: A scheduled scan runs every day at 06:00 UTC to catch newly disclosed vulnerabilities.
- **Manual**: Can be triggered via workflow dispatch.

## Handling Failures
If the CI fails due to a dependency vulnerability:
1. Review the workflow logs to identify the vulnerable package.
2. Attempt to update the package to a fixed version.
3. If an update is not feasible or the vulnerability is a known accepted risk, you may add a waiver.

## Waiver Process
Waivers are stored in `.github/audit-waivers.json`. To add a waiver, append an object to the relevant array (`npm` or `cargo`).

Required fields for a waiver:
- `id`: The advisory ID (e.g., from npm or rustsec).
- `reason`: A brief explanation of why this risk is accepted.
- `added_by`: GitHub username of the person adding the waiver.
- `added_date`: Date the waiver was added (YYYY-MM-DD).
- `review_by`: Date by which the waiver should be reviewed (YYYY-MM-DD).

### Reviewing Waivers
Waivers should be periodically reviewed to ensure they are still applicable and that a fix hasn't become available.

## Related Files
- `.github/workflows/dep-scan.yml`
- `.github/audit-waivers.json`
