# Disaster Recovery Runbook

## Scope
This runbook covers recovery procedures for contract, backend, and frontend outages.

## Contract Recovery

### Symptom: Contract fails to deploy
1. Check Soroban RPC endpoint health: `curl <rpc_url>/health`
2. Verify account has sufficient XLM balance
3. Rebuild WASM: `make build-contract`
4. Retry deployment: `make deploy-contract`

### Symptom: Contract state corrupted
1. Identify affected ledger entries
2. Restore from last known good snapshot
3. Submit recovery transaction via admin account
4. Verify state consistency with `make verify-state`

## Backend Recovery

### Symptom: Database corruption
1. Stop backend: `systemctl stop rebalancer-backend`
2. Restore from latest backup: `pg_restore -d rebalancer /backups/latest.dump`
3. Verify integrity: `make db-verify`
4. Start backend: `systemctl start rebalancer-backend`

### Symptom: API unresponsive
1. Check health endpoint: `curl /api/health`
2. Review logs: `journalctl -u rebalancer-backend -n 100`
3. Check database connectivity
4. Restart service if needed

## Frontend Recovery

### Symptom: Page fails to load
1. Check CDN/static serving status
2. Verify build artifacts exist
3. Clear CDN cache
4. Redeploy if needed: `make deploy-frontend`

## Backup Verification

Monthly:
1. Restore backup to staging environment
2. Run full test suite
3. Verify data integrity with checksums
4. Document any discrepancies
