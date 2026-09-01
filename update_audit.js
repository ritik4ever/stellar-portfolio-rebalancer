const fs = require('fs');
let content = fs.readFileSync('docs/SECURITY_AUDIT.md', 'utf8');

const indexTarget = '| [SPR-001](#spr-001) | `get_fee_config` default `fee_recipient` falls back to the contract\'s own address | **High** | Open — fix tracked in #1519 |\n';
const indexEntry = '| [SPR-002](#spr-002) | Unbounded `create_portfolio` allows storage-spam DoS | **Medium** | Open — mitigation recommended |\n';

content = content.replace(indexTarget, indexTarget + indexEntry);

const newFinding = `
---

## SPR-002

**Title:** Unbounded \`create_portfolio\` allows storage-spam DoS

**Severity:** Medium

**Status:** Open — mitigation recommended

**Reported:** 2026-08-31

**Affected file:** \`contracts/src/lib.rs\`

**Affected function:** \`create_portfolio\`, \`create_portfolio_with_strategy\`, \`create_portfolio_from_template\`

---

### Description

Currently, the \`stellar-portfolio-rebalancer\` contract does not restrict how many portfolios can be created globally or across multiple accounts. While a per-user cap is being tracked separately, an attacker could still circumvent this by generating numerous unique accounts and calling \`create_portfolio\` (or its variants) from each one.

Each new portfolio increments the global \`NextPortfolioId\` and writes a new \`Portfolio\` struct to \`persistent\` storage via \`DataKey::PortfolioV2(portfolio_id)\`. 

### Storage-Rent and Cost Implications

In Soroban, persistent storage entries require a minimum rent. While the invoker of \`create_portfolio\` pays the transaction fees and initial storage rent, the long-term rent burden falls on the contract or requires ongoing community effort to bump the ledger entries to prevent them from being archived. 

If an attacker aggressively spams portfolio creation:
1. **Ledger Bloat & Rent Costs:** It increases the storage footprint of the contract significantly. Keeping these entries alive (if necessary for global state operations) will consume excessive rent fees.
2. **Archival DoS Risk:** If the contract relies on querying active portfolios (e.g., via off-chain indexers or future on-chain aggregations) or if the sheer volume of data makes RPC queries expensive, it degrades system performance. If entries are archived, unarchiving them incurs additional costs.
3. **ID Exhaustion:** While a \`u64\` is unlikely to wrap around, a massive number of portfolios might hit theoretical limits or cause issues for off-chain systems indexing \`NextPortfolioId\`.

### Recommended Mitigation

To prevent storage-spam and unbounded creation of portfolios, we recommend implementing a multi-layered defense:

1. **Per-Account Cap (Cross-Reference):** Enforce a strict limit on the number of portfolios a single user can create (this is currently being tracked separately as a per-user cap issue).
2. **Minimum Balance / Fee Requirement (Recommended):** Require users to deposit a minimum balance of a supported asset into the portfolio upon creation, or charge a non-refundable protocol fee in XLM or USDC for each \`create_portfolio\` call. This imposes a direct economic cost on the attacker, effectively neutralizing sybil-based spam.
3. **Admin-Configurable Global Cap (Defense in Depth):** Add a \`max_global_portfolios\` configuration setting that the admin can adjust. If the global limit is reached, new creations are paused until the admin evaluates the system's capacity and raises the limit.
`;

const marker = '\n---\n\n*Last updated:';
const parts = content.split(marker);
if (parts.length === 2) {
    content = parts[0] + '\n' + newFinding + marker + parts[1];
    fs.writeFileSync('docs/SECURITY_AUDIT.md', content, 'utf8');
    console.log('File updated successfully');
} else {
    console.log('Could not find the marker');
}
