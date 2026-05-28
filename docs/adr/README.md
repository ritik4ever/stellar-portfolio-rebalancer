# Architecture Decision Records (ADRs)

This folder contains **Architecture Decision Records** for the Stellar Portfolio Rebalancer.

ADRs capture important architectural decisions, their context, consequences, and the rationale behind them.

## When to write an ADR

Write an ADR when you make a decision that affects the project's architecture, such as:

- Choosing a new dependency, framework, or protocol
- Changing the data model or API contract
- Adopting a new design pattern or infrastructure component
- Revising a previously made decision
- Defining cross-cutting policies (caching, error handling, observability)

## ADR lifecycle

| Status       | Meaning                                               |
| ------------ | ----------------------------------------------------- |
| **Proposed** | Under discussion; not yet accepted.                   |
| **Accepted** | Approved and implemented (or about to be).            |
| **Deprecated** | Superseded by a later ADR; kept for historical context. |
| **Rejected** | Considered and not adopted; rationale recorded.       |

## Numbering

ADRs are numbered sequentially (starting at 0001). Use the next available number when adding a new record.

## Template

```markdown
# ADR NNNN: Title

| Field          | Value                                |
| -------------- | ------------------------------------ |
| **Status**     | Proposed / Accepted / Deprecated / Rejected |
| **Date**       | YYYY-MM-DD                           |
| **Author(s)**  | @username                            |
| **Supersedes** | ADR-XXXX (if any)                    |

## Context

What is the problem we are solving? What constraints, trade-offs, or background information are relevant?

## Decision

What are we doing? Be specific. Include code snippets, diagrams, or configuration examples if helpful.

## Consequences

- **Positive:** What improves as a result?
- **Negative:** What regresses or becomes more complex?
- **Risks:** What could go wrong and how do we mitigate?

## Alternatives Considered

| Option         | Pros                        | Cons                     |
| -------------- | --------------------------- | ------------------------ |
| Option A       | ...                         | ...                      |
| Option B       | ...                         | ...                      |

## References

- Links to related ADRs, issues, PRs, or external resources
```

## Existing ADRs

| #    | Title | Status | Date |
| ---- | ----- | ------ | ---- |
| —    | _None yet_ | | |

---

*For guidance on writing good ADRs, see [Michael Nygard's original article](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).*
