# Security Policy

Last verified: 2026-09-29 against commit `717ea953f3a338c35bfdbc73e06eddb95f216273` on `main`.

## Supported Versions

There are no tagged releases. Security fixes are applied on the latest `main` branch of the Stellar Portfolio Rebalancer.

## Reporting a Vulnerability

Please **do not** open a public issue for a security vulnerability.

### Where to Report

Use the **Report a vulnerability** button on the Security tab, which opens a private GitHub Security Advisory:

https://github.com/ritik4ever/stellar-portfolio-rebalancer/security/advisories/new

A public security mailbox is not configured. `docs/TRIAGE.md` and `.github/ISSUE_TEMPLATE/security.md` both treat GitHub Security Advisories as the disclosure channel. Low-risk hardening suggestions that are not vulnerabilities may use the public security issue template.

### What Information Helps

- **Description**: A clear explanation of the vulnerability.
- **Impact**: Who is affected and what an attacker can achieve.
- **Reproduction Steps**: Step-by-step instructions. Example: *"1. Submit `execute_rebalance` on the contract in `contracts/src/lib.rs`. The call enters `execute_rebalance_internal`, which requires the portfolio steward's signature, enforces the cooldown, and runs the allocation threshold check in `contracts/src/portfolio.rs`. `admin_force_rebalance` skips the cooldown only; it still requires steward authorization and does not skip the threshold check."*
- **Environment**: Backend or frontend package versions, network (`testnet` or `mainnet`), and whether Redis-backed queue workers are running.

### What Response to Expect

Maintainer handling for critical reports follows `docs/TRIAGE.md`:

- **Acknowledgment**: We acknowledge a private report within 24 hours.
- **Assessment**: We assess severity and develop the fix in private.
- **Disclosure**: We coordinate disclosure with the reporter. The usual window is 90 days.
- **Maintenance Notes**: Do not open a public pull request with a fix for an unconfirmed vulnerability. Wait for maintainer coordination so the report is not disclosed early.

Thank you for helping keep the Stellar Portfolio Rebalancer secure.
