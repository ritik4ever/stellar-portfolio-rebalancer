# ADR 0003: On-Chain Strategy Execution Architecture

## Status

Accepted

## Context

The stellar-portfolio-rebalancer needs to execute rebalancing strategies such as periodic, volatility, and custom strategies. We need to decide whether to implement these strategies fully on-chain via smart contracts or purely in a centralized backend that triggers transactions. 
Key considerations involve gas costs, the trust model required by users, and the flexibility needed to upgrade or change strategies over time.

## Decision

We have decided to implement the rebalancing strategies on-chain. The strategy logic is encapsulated within specific contract modules.

This approach was chosen over a purely backend-driven model because it provides a superior trust model. Users can independently verify the logic and rules of the rebalancing strategies on the blockchain, eliminating the need to trust a centralized off-chain entity to calculate and execute the rebalances fairly and accurately.

## Consequences

Positive:
* **Trust Model:** High transparency and trustlessness. Strategy rules are verifiable on-chain.
* **Security:** Decentralized execution prevents a single point of failure (a centralized backend) from compromising strategy execution.

Negative:
* **Gas Cost:** Executing complex strategies on-chain incurs higher transaction fees (gas costs) for users compared to off-chain computation.
* **Upgrade Flexibility:** On-chain contracts are inherently more difficult to upgrade. Changes to strategy logic require careful contract upgrades or the deployment of new strategy contracts, unlike a backend where code can be updated seamlessly.

## Implementation Context

* `strategies/periodic.rs`
* `strategies/volatility.rs`
* `strategies/custom.rs`
