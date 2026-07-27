# Description

Please include a summary of the changes and the related issue(s) being resolved.

**Every PR must link to an issue.** If this PR intentionally has no related issue, explain why in the rationale section below.

Fixes # (issue)

> Rationale for no issue (if applicable):

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] DevOps / CI / Documentation update

# 📖 API Changes & Breaking Changes Checklist

If your changes affect any HTTP route, request/response schema, database schema, or CLI/contract signature:

- [ ] **OpenAPI Spec:** Updated `backend/src/openapi/spec.ts` (and exported `backend/openapi.json` via `npm run openapi:export`).
- [ ] **API Documentation:** Updated `API.md` and/or `docs/API.md` explaining route/schema behavior changes.
- [ ] **Changelog:** Added a corresponding entry in `CHANGELOG.md` under the `[Unreleased]` section.
- [ ] **Migration Notes:** Provided instructions for consumers if the change is a breaking or material behavior shift.

# Checklist

- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] **This PR links to an issue or provides a rationale for no issue**
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
