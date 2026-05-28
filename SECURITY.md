# Security Policy

## Supported Versions

We currently support security fixes for the latest stable release of Stellar Portfolio Rebalancer.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < latest| :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, **please do not open a public GitHub issue**. Instead, report it privately using one of the following methods.

### Preferred: GitHub Private Vulnerability Reporting

The easiest way to report a vulnerability is through GitHub's built-in private reporting feature:

1. Go to the repository's **Security** tab: [https://github.com/ritik4ever/stellar-portfolio-rebalancer/security](https://github.com/ritik4ever/stellar-portfolio-rebalancer/security)
2. Click **"Report a vulnerability"** and follow the instructions.

### Alternative: Encrypted Email

If you cannot use GitHub's private reporting, send an encrypted email to the repository maintainer.

> **For the latest contact email, check the repository's `README.md` or the commit history of this file.**

### What to Include

When reporting a vulnerability, please include as much of the following as possible:

- **Type of vulnerability** (e.g., SQL injection, XSS, privilege escalation, race condition)
- **Affected component** (backend API, smart contract, frontend, authentication flow)
- **Steps to reproduce** — a minimal, self-contained proof of concept is ideal
- **Expected vs. actual behavior**
- **Suggested impact** (what an attacker could achieve)
- **Environment details** (browser, OS, network, or on-chain context)

### Response Expectation

- **Acknowledgement:** You will receive an acknowledgement within **48 hours** of submitting your report.
- **Investigation:** We will triage and investigate the report within **5 business days**.
- **Updates:** We will provide status updates at least once every **7 days** until the issue is resolved.
- **Fix timeline:** Critical issues will be addressed within **14 days**. Lower-severity issues will be handled in the next planned release cycle.
- **Disclosure:** We coordinate public disclosure. We ask that you give us reasonable time to fix the issue before publishing any details.

## Scope

The following areas are in scope for security reports:

- **Smart contracts** (`contracts/`) — Stellar Soroban contracts managing portfolio positions, escrow, and rebalancing logic
- **Backend API** (`backend/`) — REST endpoints, authentication, database queries, and blockchain interaction
- **Frontend** (`frontend/`) — Wallet connection, transaction signing, and user data handling
- **Authentication & authorization** — Wallet-based authentication flows and API access controls
- **Cross-chain bridges** — Any bridge or swap mechanisms integrated into rebalancing strategies

The following are **out of scope** (unless they enable a higher-severity attack):

- Minor UI/UX bugs with no security impact
- Missing HTTP headers that do not enable a real attack
- Rate limiting bypass without demonstrated harm
- Phishing via social engineering (unrelated to code)
- Issues in third-party dependencies that are already patched upstream

## Safe Harbor

We consider security research conducted in good faith to be:


- **Authorized** — You are authorized to access the software and test its security within the boundaries described in this policy.
- **Protected** — We will not take legal action against researchers who comply with this policy.
- **Appreciated** — We may publicly acknowledge your contribution (with your permission) and, where applicable, offer a bug bounty.

### Safe Harbor Conditions

- You make a good-faith effort to **avoid privacy violations, destruction of data, and interruption of production services**.
- You do not intentionally access data that does not belong to you.
- You do not exploit a vulnerability beyond what is necessary to demonstrate it.
- You report the vulnerability promptly using the private channels above.
- You do not disclose the vulnerability publicly until we have addressed it.

## Bug Bounty Program

Stellar Portfolio Rebalancer participates in the Stellar ecosystem bounty program. Rewards are paid in USDC or XLM for qualifying security reports.

- **Critical vulnerabilities:** Up to $500 USDC
- **High severity:** Up to $250 USDC
- **Medium severity:** Up to $100 USDC
- **Low severity / informational:** Acknowledgement only

Bounty eligibility is determined at the sole discretion of the maintainer team and depends on the severity, impact, and quality of the report.

## Security Best Practices for Contributors

When contributing to this project, please follow these security guidelines:

1. **Never commit secrets, keys, or tokens** — Use environment variables (`.env`) and reference them in `.env.example`
2. **Validate all inputs** — Both on the backend (Zod schemas) and frontend (form validation)
3. **Use Soroban's built-in security** — Follow contract-level patterns for access control and reentrancy protection
4. **Review wallet interaction code** — Transaction signing and account access should follow the principle of least privilege
5. **Audit dependency changes** — When adding or updating dependencies, review for known vulnerabilities (`npm audit`)

## Dependencies and Supply Chain Security

- Dependencies are pinned to specific versions in `package.json` and lock files.
- Automated `npm audit` runs in CI to flag known vulnerabilities.
- Major dependency updates are reviewed manually before merging.
- Contract dependencies (Soroban SDK) are versioned and verified against Stellar's official releases.

## Contact

For urgent security issues, contact the maintainers via the GitHub Security tab.

For general inquiries about security, open a [Discussion](https://github.com/ritik4ever/stellar-portfolio-rebalancer/discussions) in the repository.
