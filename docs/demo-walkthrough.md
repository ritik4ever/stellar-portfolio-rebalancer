# Demo Walkthrough

This guide provides a step-by-step walkthrough of the Stellar Portfolio Rebalancer with notes on what you should see at each step.

## Prerequisites

- [Freighter wallet](https://freighter.app/) with a Stellar Testnet account
- [Testnet XLM](https://stellar.org/laboratory/#account-creator?network=testnet) (use the Friendbot faucet)

## 1. Connect Wallet

1. Open the rebalancer frontend
2. Click **Connect Wallet** in the top-right corner
3. Freighter will prompt you to approve the connection
4. **Expected:** Your public key displays in the header and the "Dashboard" tab becomes active

## 2. Create a Portfolio

1. Navigate to the **Portfolios** tab
2. Click **+ New Portfolio**
3. Enter a name (e.g., "My First Portfolio")
4. Select assets: XLM and USDC
5. Click **Create**
6. **Expected:** The new portfolio appears in the list with status "Pending"

## 3. Trigger a Rebalance

1. Select your portfolio from the list
2. Click **Rebalance Now**
3. Approve the Freighter signature request
4. **Expected:** Status changes to "Rebalancing..." with a spinner
5. **Expected:** On completion, status shows "Completed" with the new allocation breakdown

## 4. View Rebalance History

1. Click the portfolio row to expand details
2. Scroll to the **History** section
3. **Expected:** A list of past rebalance operations with timestamps, amounts, and status

## 5. Monitor Health

1. Navigate to the **Settings** tab
2. Click **Health Check**
3. **Expected:** Green checkmarks for backend, database, and contract connectivity

## See Also

- [FAQ](wallet-faq.md) — Wallet connection troubleshooting
- [API Reference](API.md) — Full API documentation
