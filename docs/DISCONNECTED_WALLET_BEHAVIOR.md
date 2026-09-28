# Disconnected Wallet Behavior

This document explains what happens to a portfolio when the owner's Stellar wallet is never reconnected after the initial setup.

## Short answer

**Nothing happens automatically.** No rebalancing occurs without an explicit signature from the wallet that owns (or has been delegated stewardship over) the portfolio. Funds remain untouched in contract storage until the wallet reconnects and authorizes a transaction.

## How rebalancing authorization works

Every call to `execute_rebalance` requires a Soroban auth signature from the portfolio's **steward**. This is enforced unconditionally in the contract:

```rust
// contracts/src/lib.rs, inside execute_rebalance_internal
let steward: Address = env
    .storage()
    .persistent()
    .get(&DataKey::Steward(portfolio_id))
    .unwrap_or(portfolio.user.clone());
steward.require_auth();
```

- If no steward has been explicitly set, the steward defaults to the **portfolio owner** (the wallet address passed to `create_portfolio`).
- `require_auth()` is a Soroban primitive that causes the transaction to fail unless the referenced address signs the invocation. There is no way to bypass it from outside the contract.

This means:

- The contract cannot rebalance itself on a timer or schedule.
- The backend cannot trigger a rebalance without the owner's (or steward's) active signature.
- The frontend UI cannot submit a rebalance transaction that the wallet has not signed.

## What happens to the portfolio

| Situation | Result |
|---|---|
| Wallet disconnects before any rebalance | Portfolio data and funds stay intact in contract storage |
| Market drifts past the rebalance threshold | `check_rebalance_needed` returns `true`, but no action is taken without a signed `execute_rebalance` call |
| Cooldown period expires | Rebalancing becomes eligible again, but still waits for a signed invocation |
| Emergency stop is activated by the admin | All deposits and rebalances are blocked contract-wide; unrelated to wallet connectivity |

Portfolio data persists in Soroban persistent storage with no expiry tied to wallet activity. There is no automatic deactivation or fund seizure for inactive portfolios.

## Unattended rebalancing is not possible by default

The contract does not support any form of truly unattended, automatic rebalancing for a standard user portfolio. The steward (defaulting to the owner) must be present and able to sign each `execute_rebalance` transaction.

The `admin_force_rebalance` function allows the contract admin or a registered operator to bypass the cooldown period, but it still routes through `execute_rebalance_internal`, which calls `steward.require_auth()`. Admin/operator access does not substitute for the steward's authorization.

## Delegating rebalancing to another address (stewardship)

If you want rebalancing to be possible without your primary wallet (for example, by a multisig, a scheduled automation account, or a third-party service), you can transfer stewardship to another address:

```bash
soroban contract invoke \
  --id YOUR_CONTRACT_ID \
  --source YOUR_WALLET_SECRET \
  --network testnet \
  -- transfer_stewardship \
  --portfolio_id 1 \
  --new_steward NEW_STEWARD_ADDRESS
```

After this call:

- `NEW_STEWARD_ADDRESS` is the only address that can authorize `execute_rebalance` and `deposit` for that portfolio.
- The original owner can no longer sign rebalance transactions on that portfolio's behalf unless stewardship is transferred back.
- The original owner retains the right to transfer stewardship again (the current steward must authorize `transfer_stewardship`, and the original owner is the initial steward).

See `transfer_stewardship` in [CONTRACT_ABI.md](../contracts/CONTRACT_ABI.md#transfer_stewardship) for the full function signature and preconditions.

## How to revoke delegated stewardship

To return signing control to your primary wallet, call `transfer_stewardship` again with your own address as `new_steward`. This requires the **current steward** (the delegated address) to authorize the call.

```bash
soroban contract invoke \
  --id YOUR_CONTRACT_ID \
  --source CURRENT_STEWARD_SECRET \
  --network testnet \
  -- transfer_stewardship \
  --portfolio_id 1 \
  --new_steward YOUR_WALLET_ADDRESS
```

## Summary

| Question | Answer |
|---|---|
| Does rebalancing continue if I disconnect my wallet? | No. All rebalances require a live signature. |
| Are my funds at risk if I go offline? | No. Funds sit untouched until you sign a transaction. |
| Can the admin rebalance my portfolio without my consent? | No. Admin/operator force-rebalance still requires the steward's auth. |
| Can I set up unattended rebalancing? | Yes, by delegating stewardship to an automation contract or hot wallet via `transfer_stewardship`. |
| How do I revoke a delegation? | Call `transfer_stewardship` from the current steward address, passing your wallet address as `new_steward`. |

## Related docs

- [Wallet FAQ](wallet-faq.md) – connecting wallets and signing transactions
- [Wallet Troubleshooting](WALLET_TROUBLESHOOTING.md) – fixing connection errors
- [Contract ABI](../contracts/CONTRACT_ABI.md) – full function signatures and auth requirements
- [Glossary](GLOSSARY.md) – definitions for steward, stewardship delegation, and other terms
