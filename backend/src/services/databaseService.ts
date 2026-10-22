            new Date().toISOString(),
            new Date().toISOString(),
            "threshold",
            "{}",
          );
      }
    } catch (err) {
      throw new Error(
        `Failed to ensure portfolio '${portfolioId}' exists: ${err}`,
      );
    }
  }

  getReadiness(): { ready: boolean; databasePath: string; error?: string } {
    const dbPath = process.env.DB_PATH || "./data/portfolio.db";
    try {
      this.db.prepare("SELECT 1").get();
      return { ready: true, databasePath: dbPath };
    } catch (err) {
      return {
        ready: false,
        databasePath: dbPath,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  recordAdminAuditEntry(
    actor: string,
    action: string,
    target: string | null,
    beforeValue: unknown,
    afterValue: unknown,
  ): string {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    this._withTiming("recordAdminAuditEntry", () => {
      this.db
        .prepare(
          `INSERT INTO admin_audit_log (id, actor, action, target, before_value, after_value, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          actor,
          action,
          target,
          beforeValue != null ? JSON.stringify(beforeValue) : null,
          afterValue != null ? JSON.stringify(afterValue) : null,
          timestamp,
        );
    });
    return id;
  }

  queryAdminAuditLog(filters: {
    actor?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): { entries: Array<{
    id: string;
    actor: string;
    action: string;
    target: string | null;
    before_value: string | null;
    after_value: string | null;
    timestamp: string;
  }>; total: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.actor) {
      conditions.push("actor = ?");
      params.push(filters.actor);
    }
    if (filters.action) {
      conditions.push("action = ?");
      params.push(filters.action);
    }
    if (filters.startDate) {
      conditions.push("timestamp >= ?");
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push("timestamp <= ?");
      params.push(filters.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = filters.offset ?? 0;

    return this._withTiming("queryAdminAuditLog", () => {
      const total = (
        this.db
          .prepare(`SELECT COUNT(*) as cnt FROM admin_audit_log ${whereClause}`)
          .get(...params) as { cnt: number }
      ).cnt;

      const entries = this.db
        .prepare(
          `SELECT * FROM admin_audit_log ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as Array<{
          id: string;
          actor: string;
          action: string;
          target: string | null;
          before_value: string | null;
          after_value: string | null;
          timestamp: string;
        }>;

      return { entries, total };
    });
  }
}

// Singleton export
export const databaseService = new DatabaseService();


check for any error and change any code 