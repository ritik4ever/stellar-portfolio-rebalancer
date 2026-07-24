# Repair plan: fix backend/src/api/portfolios.routes.ts and mount import endpoint

- [ ] Restore `backend/src/api/portfolios.routes.ts` to a consistent single `export const portfoliosRouter = Router()` and remove duplicate imports/statements introduced during bulk import wiring.
- [ ] Ensure all existing route handlers compile (createDraftSchema/updateDraftSchema/etc referenced from `./validation.js`).
- [ ] Mount the new router exactly once: `portfoliosRouter.use(portfolioImportRouter)`.
- [ ] Confirm endpoint compiles by running `npm test` or `npm run build` in `backend`.
- [ ] Only after backend compiles: implement frontend upload UI + submit logic.

