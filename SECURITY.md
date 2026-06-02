# Security Policy

## Supported Versions
We currently support security updates for the latest `main` branch of the Stellar Portfolio Rebalancer.

## Reporting a Vulnerability

Security reporters should not have to guess how to disclose a vulnerability responsibly. Please **do not** open public issues for security vulnerabilities.

### Where to Report
Please use the "Report a vulnerability" button in the "Security" tab of this repository, or email the core maintainers directly at **security@midexol.local**.

### What Information Helps
To help us resolve the issue quickly, please include:
- **Description**: A clear explanation of the vulnerability.
- **Impact**: Who is affected and what can an attacker achieve?
- **Reproduction Steps**: Step-by-step instructions. Example: *"1. Send a transaction to the `execute_rebalance` function in `contracts/src/portfolio.rs` bypassing the threshold check..."*
- **Environment**: Backend/Frontend package versions, network (Testnet/Mainnet), or specific queue worker setups.

### What Response to Expect
- **Acknowledgment**: We will acknowledge your report within 48 hours.
- **Resolution Plan**: Within 1 week, we will provide a status update and a timeline for a patch.
- **Maintenance Notes**: Do not submit Pull Requests directly with fixes for unconfirmed security vulnerabilities. Wait for maintainer coordination to prevent premature disclosure.

Thank you for helping keep the Stellar Portfolio Rebalancer secure!
