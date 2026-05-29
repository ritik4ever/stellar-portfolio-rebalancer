---
name: Security Report
about: Report a security vulnerability (use private disclosure for critical issues)
title: '[SECURITY] '
labels: ['security', 'needs-triage']
assignees: ''
---

## ⚠️ Security Disclosure Guidelines

**For Critical Vulnerabilities:**  
Please **DO NOT** create a public issue. Instead, report privately via:
- GitHub Security Advisories (preferred): [Report a vulnerability](https://github.com/ritik4ever/stellar-portfolio-rebalancer/security/advisories/new)
- Email: [security contact - add your email here]

**For Low-Risk Security Improvements:**  
You may use this public template for non-critical security enhancements, hardening suggestions, or dependency updates.

---

## Security Issue

**Severity:**  
<!-- Select one: Critical / High / Medium / Low / Informational -->

**Category:**  
<!-- Select one: Authentication / Authorization / Input Validation / Cryptography / Dependency / Configuration / Smart Contract / API Security / Data Exposure / Other -->

**Component:**  
<!-- Which part of the system? Frontend / Backend / Smart Contract / Infrastructure / All -->

## Issue Description

**Summary:**  
<!-- High-level description without revealing exploit details publicly -->

**Attack Vector:**  
<!-- How could this be exploited? (Be cautious with details in public issues) -->

**Impact:**  
<!-- What could an attacker achieve? Data breach / Unauthorized access / Denial of service / Fund loss / etc. -->

**Affected Versions:**  
<!-- Which versions are vulnerable? -->

## Proof of Concept

<!-- ⚠️ DO NOT include working exploits in public issues -->
<!-- For critical issues, share PoC privately via security advisory -->

**Conceptual Steps:**  
1. <!-- High-level step without exploit details -->
2. <!-- ... -->

## Suggested Mitigation

**Immediate Actions:**  
<!-- What should be done right away to reduce risk? -->

**Long-term Fix:**  
<!-- Permanent solution to address the root cause -->

**Code Changes:**  
<!-- If applicable, suggest secure code patterns (without revealing the vulnerability) -->

## References

**Related CVEs:**  
<!-- Link to related Common Vulnerabilities and Exposures -->

**Security Best Practices:**  
<!-- Link to OWASP, CWE, or other security resources -->

**Similar Issues:**  
<!-- Link to similar security issues in other projects (if public) -->

## Additional Context

**Discovery Method:**  
<!-- How was this found? Security audit / Automated scan / Manual testing / Responsible disclosure -->

**Affected Users:**  
<!-- Who is at risk? All users / Specific configurations / Admin only / etc. -->

**Workaround:**  
<!-- Is there a temporary mitigation users can apply? -->

---

## Security Response Checklist

<!-- For maintainers handling this report -->

- [ ] Severity and impact assessed
- [ ] Affected versions identified
- [ ] Fix developed and tested
- [ ] Security advisory drafted (if applicable)
- [ ] Coordinated disclosure timeline established
- [ ] Patch released
- [ ] Users notified (if necessary)
- [ ] Postmortem completed
- [ ] Security documentation updated

---

## Responsible Disclosure

We appreciate security researchers who follow responsible disclosure practices:

1. **Report privately** for critical issues
2. **Allow time** for us to develop and release a fix (typically 90 days)
3. **Coordinate disclosure** timing with maintainers
4. **Avoid exploitation** of the vulnerability

We are committed to:
- Acknowledging your report within 48 hours
- Providing regular updates on fix progress
- Crediting you in security advisories (if desired)
- Working with you on coordinated disclosure
