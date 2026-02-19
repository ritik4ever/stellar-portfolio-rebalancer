/**
 * portfolioStorage.ts
 *
 * Backward-compatible re-export: all callers that import `portfolioStorage`
 * now transparently use the SQLite-backed DatabaseService singleton.
 */
export { databaseService as portfolioStorage, type Portfolio } from './databaseService.js'