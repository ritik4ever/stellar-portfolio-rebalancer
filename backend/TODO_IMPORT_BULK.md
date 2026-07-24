# TODO - Bulk Import Portfolio Allocations (/api/v1/portfolio/import)

- [ ] Implement backend endpoint accepting JSON or CSV bulk allocations.
- [ ] Add CSV parsing without external ripgrep/search (use manual implementation).
- [ ] Validate: allocations sum to 100%, max 10 assets, valid asset codes, per-row validation errors with row/field detail.
- [ ] Create new portfolio from imported data.
- [ ] Ensure error responses have consistent structure.
- [ ] Update frontend: add file upload import button and UI to submit file.
- [ ] Add frontend parsing for JSON/CSV or send raw to backend.
- [ ] Add tests (backend + minimal frontend) for validation and parsing.
- [ ] Run backend/frontend test/lint/build.

