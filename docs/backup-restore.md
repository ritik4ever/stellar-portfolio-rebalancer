# Backup & Restore Drills

## SQLite Backup
```bash
# Manual backup
sqlite3 data/rebalancer.db ".backup /backups/daily/rebalancer-$(date +%Y%m%d).db"

# Restore
sqlite3 data/rebalancer.db ".restore /backups/daily/rebalancer-20260529.db"
```

## PostgreSQL Backup
```bash
# Backup
pg_dump -Fc rebalancer > /backups/daily/rebalancer-$(date +%Y%m%d).dump

# Restore
pg_restore -d rebalancer /backups/daily/rebalancer-20260529.dump
```

## Schedule
- Daily: SQLite backup at 2 AM
- Weekly: PostgreSQL dump every Sunday
- Monthly: Full restore drill to staging environment
