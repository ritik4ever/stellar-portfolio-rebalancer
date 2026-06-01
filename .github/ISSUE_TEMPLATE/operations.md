---
name: Operations Issue
about: Report deployment, infrastructure, or operational concerns
title: '[OPS] '
labels: ['operations', 'needs-triage']
assignees: ''
---

## Operations Issue

**Category:**  
<!-- Select one: Deployment / Infrastructure / Performance / Monitoring / Configuration / Maintenance -->

**Environment:**  
<!-- Local / Testnet / Staging / Production -->

**Severity:**  
<!-- Critical (service down) / High (degraded) / Medium (minor impact) / Low (optimization) -->

## Issue Description

**Summary:**  
<!-- Clear description of the operational issue -->

**Impact:**  
<!-- What is affected? Users, services, data, etc. -->

**Current State:**  
<!-- What is happening right now? -->

**Desired State:**  
<!-- What should be happening? -->

## Technical Details

**Component:**  
<!-- Which service or infrastructure component? Backend API / Frontend / Database / Redis / Queue Workers / Contract / Load Balancer / etc. -->

**Symptoms:**  
<!-- Observable symptoms: error rates, latency, resource usage, etc. -->

**Metrics/Logs:**  
<!-- Paste relevant metrics, logs, or monitoring data -->

```
Logs or metrics here
```

**Timeline:**  
<!-- When did this start? Is it ongoing or intermittent? -->

**Recent Changes:**  
<!-- Were there any recent deployments, config changes, or infrastructure updates? -->

## Reproduction (if applicable)

**Steps to Reproduce:**  
1. <!-- Step 1 -->
2. <!-- Step 2 -->

**Frequency:**  
<!-- Always / Intermittent / Under specific load / etc. -->

## Investigation

**Hypothesis:**  
<!-- What do you think is causing this? -->

**Attempted Fixes:**  
<!-- What have you tried so far? -->

**Workaround:**  
<!-- Is there a temporary workaround in place? -->

## Proposed Solution

**Short-term Fix:**  
<!-- Immediate action to mitigate impact -->

**Long-term Fix:**  
<!-- Permanent solution to prevent recurrence -->

**Resource Requirements:**  
<!-- Does this require infrastructure changes, scaling, or additional services? -->

## Monitoring & Alerting

**Current Monitoring:**  
<!-- What monitoring is in place for this component? -->

**Alert Gaps:**  
<!-- Should we add alerts to catch this earlier next time? -->

**Health Check Impact:**  
<!-- Does this affect /health or /ready endpoints? -->

## Documentation

**Runbook:**  
<!-- Should this be added to docs/OPERATIONS.md or a runbook? -->

**Related Documentation:**  
<!-- Link to relevant operational docs -->

- [OPERATIONS.md](../../docs/OPERATIONS.md)
- [ENVIRONMENT.md](../../docs/ENVIRONMENT.md)
- [Deployment Guide](../../deployment/README.md)

## Additional Context

**Related Issues:**  
<!-- Link to related operational issues or incidents -->

**External Dependencies:**  
<!-- Are external services (Stellar Horizon, Reflector, etc.) involved? -->

---

## Incident Response Checklist

<!-- For critical/high severity issues -->

- [ ] Impact assessed and communicated
- [ ] Immediate mitigation applied
- [ ] Root cause identified
- [ ] Permanent fix implemented
- [ ] Monitoring/alerting updated
- [ ] Postmortem documented (if applicable)
- [ ] Runbook updated
