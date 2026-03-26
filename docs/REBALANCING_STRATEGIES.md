# Rebalancing Strategies

Portfolios can use different strategies to decide when to rebalance. You choose a strategy when creating a portfolio and can pass optional configuration per strategy.

## Available strategies

### 1. Threshold-based (`threshold`)

**Description:** Rebalance when any asset’s current allocation drifts from its target by more than the configured threshold (percentage).

**When it triggers:** On each check, the service compares current weights (from balances × prices) to target allocations. If the absolute drift for any asset exceeds the portfolio’s threshold, a rebalance is triggered.

**Configuration:** Uses the portfolio’s global **Rebalance threshold (%)** (e.g. 5%). No extra `strategyConfig` fields.

**Use case:** Best when you want to react to allocation drift regardless of time or market volatility.

---

### 2. Periodic / time-based (`periodic`)

**Description:** Rebalance on a fixed schedule (e.g. every 7 or 30 days), regardless of drift.

**When it triggers:** If the time since the last rebalance is greater than or equal to the configured interval (in days), a rebalance is triggered.

**Configuration:**

| Field          | Type   | Default | Description                    |
|----------------|--------|--------|--------------------------------|
| `intervalDays` | number | 7      | Rebalance every N days (1–365). |

**Use case:** Dollar-cost averaging (DCA) style: invest or rebalance at regular intervals.

---

### 3. Volatility-based (`volatility`)

**Description:** Rebalance when market volatility is high (e.g. 24h price change exceeds a percentage) or when allocation drift exceeds the threshold.

**When it triggers:**  
- If any asset’s absolute price change (from the price feed) is ≥ `volatilityThresholdPct`, a rebalance is triggered, or  
- If the threshold-based logic would trigger (drift > threshold), a rebalance is triggered.

**Configuration:**

| Field                    | Type   | Default | Description                          |
|--------------------------|--------|--------|--------------------------------------|
| `volatilityThresholdPct`| number | 10     | Trigger when price change exceeds this %. |

**Use case:** Rebalance when markets move sharply, or combine volatility triggers with drift-based rebalancing.

---

### 4. Custom rules (`custom`)

**Description:** User-defined rules: enforce a minimum number of days between rebalances, and only allow a rebalance when the threshold-based check would also trigger.

**When it triggers:** Only if (1) at least `minDaysBetweenRebalance` days have passed since the last rebalance, and (2) the threshold-based strategy would trigger (drift > threshold).

**Configuration:**

| Field                    | Type   | Default | Description                          |
|--------------------------|--------|--------|--------------------------------------|
| `minDaysBetweenRebalance`| number | 1      | Minimum days between rebalances (0–365). |

**Use case:** Reduce trading frequency while still reacting to drift (e.g. “rebalance at most once per week, and only when drift &gt; 5%”).

---

## API

**Create portfolio with strategy**

```json
POST /api/portfolio
{
  "userAddress": "G...",
  "allocations": { "XLM": 40, "USDC": 35, "BTC": 25 },
  "threshold": 5,
  "strategy": "periodic",
  "strategyConfig": { "intervalDays": 14 }
}
```

**List strategies (metadata for UI)**

```
GET /api/strategies
```

Response includes `strategies`: array of `{ value, label, description }` for each strategy.

## Database

- **PostgreSQL:** Migration `006_rebalancing_strategy` adds `strategy` (VARCHAR, default `'threshold'`) and `strategy_config` (JSONB, default `'{}'`) to `portfolios`.
- **SQLite:** The same columns are added via runtime migration in `DatabaseService`.

Existing portfolios without these columns are treated as `strategy: 'threshold'` with no extra config.
