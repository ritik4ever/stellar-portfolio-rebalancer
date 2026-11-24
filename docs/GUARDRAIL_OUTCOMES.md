# Rebalance guardrail outcomes

The circuit breaker, cooldown, and concentration-limit guardrails each log one structured line per decision. Each line says whether the work went ahead, was held back for now, or was refused. Implementation: [`backend/src/services/guardrailOutcomes.ts`](../backend/src/services/guardrailOutcomes.ts).

## Outcome classes

| `outcome` | Meaning | Log level | What happens next |
| --- | --- | --- | --- |
| `allowed` | The guardrail passed and the work goes ahead. | `debug` | Nothing. |
| `delayed` | The work was held back for a reason that clears with time. | `info` | The next scheduled cycle tries again. No action needed unless it keeps happening. |
| `blocked` | The work was refused for a reason that waiting will not fix. | `warn` | An operator or the user must change something, such as the allocation. |

Each line is logged with the message `[GUARDRAIL] <guardrail> <outcome>` and these fields:

| Field | Example |
| --- | --- |
| `guardrail` | `circuit_breaker`, `cooldown`, `concentration_limit` |
| `source` | `auto_rebalance`, `rebalance_worker` |
| `outcome` | `allowed`, `delayed`, `blocked` |
| `reasonCode` | see the tables below |
| `reason` | readable text |
| `portfolioId`, `jobId`, `triggeredBy` | identifiers for correlating log lines |
| `evaluatedAt` | ISO timestamp |
| context fields | timestamps and numbers only (see below) |

These lines never include wallet addresses, keys, signatures, or provider credentials.

Example Loki query: `{service="stellar-portfolio-backend"} |= "[GUARDRAIL]" | json | outcome="blocked"`.

## Circuit breaker

| `reasonCode` | `outcome` | Context |
| --- | --- | --- |
| `MARKET_OK` | `allowed` | – |
| `HIGH_VOLATILITY` | `delayed` | – |
| `STALE_PRICE_DATA` | `delayed` | `asset`, `priceTimestamp`, `ageSeconds`, `maxAgeSeconds`, `priceSource` |
| `CORRELATION_BREAKDOWN` | `delayed` | `direction`, `significantMoves` |
| `CIRCUIT_BREAKER_ACTIVE` | `delayed` | `riskReasonCode` |
| `STALE_PRICES_WHILE_QUEUED` | `delayed` | `pricesObservedAt`, `enqueuedAt`, `priceAgeMs`, `queuedForMs`, `maxAgeMs` |
| `QUEUED_PRICES_FRESH` | `allowed` | same as above |

**Prices that go stale while a job is queued.** When the auto-rebalance job enqueues an execution, it stores `pricesObservedAt` in the job data: the oldest price timestamp in the snapshot it used to decide. When the rebalance worker picks up the job, it checks that snapshot's age again. If the snapshot is now older than the 10-minute freshness window, the worker skips the execution, logs `STALE_PRICES_WHILE_QUEUED`, and writes a `rebalance_deferred_stale_prices` audit event. Compare `queuedForMs` with `priceAgeMs`:

- Most of the age came from time in the queue: the queue is backed up.
- The prices were already old when the job was enqueued: the price feed is lagging.

Jobs without `pricesObservedAt` (manual and forced jobs, and jobs from older releases) run as before.

## Cooldown enforcement

| `reasonCode` | `outcome` | Context |
| --- | --- | --- |
| `COOLDOWN_EXPIRED` | `allowed` | `lastRunAt`, `cooldownEndsAt`, `cooldownMs`, `elapsedMs`, `recordedLastRunAt` (only when this request claimed the window) |
| `COOLDOWN_NO_PRIOR_RUN` | `allowed` | `cooldownMs` |
| `COOLDOWN_ACTIVE` | `delayed` | `lastRunAt`, `cooldownEndsAt`, `remainingMs` |
| `COOLDOWN_ALREADY_CLAIMED` | `delayed` | `lastRunAt` (the winning claim), `persistedLastRunAt`, `claimedBySource`, `cooldownEndsAt` |

### Boundary contract

- The cooldown window is half-open: `[lastRun, lastRun + cooldown)`. A request evaluated exactly at `lastRun + cooldown` is **allowed**. A request 1 ms earlier is delayed.
- All comparisons use whole milliseconds, so fractional-hour cooldowns have a fixed boundary. For example, 0.1 h is exactly 360 000 ms.
- If the last-run time is missing or cannot be parsed, there is no prior run, and the request is allowed with `COOLDOWN_NO_PRIOR_RUN`.
- If the last-run time is in the future (clock skew), the cooldown stays active.
- The same inputs always give the same decision.

### Concurrent requests at the expiry instant

Several requests can reach a portfolio at the moment its cooldown expires, for example a scheduled cycle and a forced check. All of them read the same persisted `lastRebalance`, so a plain check would let all of them through.

The auto-rebalance job therefore claims the cooldown window just before it enqueues an execution. The claim is recorded synchronously, so:

- Exactly **one** request is allowed. Its `recordedLastRunAt` is the last-run time for this execution, and it is passed to the job as `cooldownClaimedAt`.
- Every other request gets `COOLDOWN_ALREADY_CLAIMED` and the winner's last-run time.
- If enqueueing fails, the claim is released so the next cycle can try again.

The last run is taken as the later of the persisted value and the latest claim. The claim is held in memory in one process. Across processes, the per-portfolio worker lock (`acquireWorkerLock`) still stops two executions from running at the same time.

## Concentration limit

| `reasonCode` | `outcome` | Context |
| --- | --- | --- |
| `CONCENTRATION_WITHIN_CAP` | `allowed` | – |
| `CONCENTRATION_PARTIAL_FILL_OVER_CAP` | `delayed` | `asset`, `weightPct`, `capPct`, `overByPct`, `totalValueUsd`, `assetCount`, `plannedLegs`, `filledLegs`, `pendingLegs`, `partialFill` |
| `CONCENTRATION_OVER_CAP` | `blocked` | same as above, or `asset`, `weightPct`, `capPct` for target allocations |
| `INSUFFICIENT_DIVERSIFICATION` | `blocked` | `activeAssets`, `minDiversification` |

`evaluatePartialFillConcentration` checks the cap (80% by default) against holdings after the fills seen so far:

- **Over the cap with legs still pending:** a partial fill has left one asset too heavy. This is `delayed`, because finishing or retrying the remaining legs should bring the weight back under the cap.
- **Over the cap with every leg filled:** this is `blocked`, because waiting will not fix it.

A target allocation over the cap (`CircuitBreakers.checkConcentrationRisk`) is always `blocked`. So is a `CONCENTRATION_BREACH` from the risk service.

## Compatibility

`CircuitBreakers.check*` still return `{ safe, reason }` with the same values and reason text. The new `outcome`, `reasonCode`, and `context` fields are added alongside them.
