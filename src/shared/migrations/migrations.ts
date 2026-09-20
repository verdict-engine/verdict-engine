/**
 * Ordered, explicit schema migrations. Each runs exactly once, inside its own transaction,
 * and is recorded in `schema_migrations` — production no longer relies on lazy
 * `CREATE TABLE IF NOT EXISTS` scattered through adapters. Migrations are append-only:
 * never edit a shipped one, add a new one. `up` is applied; `down` documents the reverse
 * for a manual rollback (we do not auto-roll-back forward migrations in place).
 */
export interface Migration {
  readonly id: string;
  readonly up: string;
  readonly down: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: "001_documents",
    up: `CREATE TABLE IF NOT EXISTS documents (
      collection text NOT NULL,
      id text NOT NULL,
      data jsonb NOT NULL,
      PRIMARY KEY (collection, id)
    )`,
    down: "DROP TABLE IF EXISTS documents",
  },
  {
    id: "002_outbox_indexes",
    // The outbox lives in `documents` (collection = 'outbox') so it commits in the same
    // transaction as the verdict. These partial indexes keep the relay's poll and the
    // hot read paths from scanning a whole collection.
    up: `
      CREATE INDEX IF NOT EXISTS documents_outbox_status_idx
        ON documents ((data->>'status'), (data->>'nextAttemptAt'))
        WHERE collection = 'outbox';
      CREATE INDEX IF NOT EXISTS documents_verdicts_decided_idx
        ON documents ((data->>'decidedAt'))
        WHERE collection = 'verdicts';
      CREATE INDEX IF NOT EXISTS documents_activity_decided_idx
        ON documents ((data->>'decidedAt'))
        WHERE collection = 'activity';
      CREATE INDEX IF NOT EXISTS documents_activity_user_idx
        ON documents ((data->'request'->'subject'->>'userId'))
        WHERE collection = 'activity';
      CREATE INDEX IF NOT EXISTS documents_replay_type_idx
        ON documents ((data->>'eventType'))
        WHERE collection = 'replay-samples';
      CREATE INDEX IF NOT EXISTS documents_cases_status_idx
        ON documents ((data->>'status'))
        WHERE collection = 'cases';
      CREATE INDEX IF NOT EXISTS documents_labels_event_idx
        ON documents ((data->>'eventId'))
        WHERE collection = 'labels';
    `,
    down: `
      DROP INDEX IF EXISTS documents_outbox_status_idx;
      DROP INDEX IF EXISTS documents_verdicts_decided_idx;
      DROP INDEX IF EXISTS documents_activity_decided_idx;
      DROP INDEX IF EXISTS documents_activity_user_idx;
      DROP INDEX IF EXISTS documents_replay_type_idx;
      DROP INDEX IF EXISTS documents_cases_status_idx;
      DROP INDEX IF EXISTS documents_labels_event_idx;
    `,
  },
  {
    id: "003_webhook_deliveries_index",
    up: `
      CREATE INDEX IF NOT EXISTS documents_webhook_deliveries_status_idx
        ON documents ((data->>'status'), (data->>'nextAttemptAt'))
        WHERE collection = 'webhook-deliveries';
    `,
    down: "DROP INDEX IF EXISTS documents_webhook_deliveries_status_idx",
  },
  {
    id: "004_retention_indexes",
    // The retention prune job deletes rows older than a cutoff by the collection's timestamp field.
    // verdicts/activity already have a decidedAt index (002); these cover the remaining prunable
    // collections so the periodic sweep is an indexed range delete, not a full-collection scan.
    up: `
      CREATE INDEX IF NOT EXISTS documents_replay_decided_idx
        ON documents ((data->>'decidedAt'))
        WHERE collection = 'replay-samples';
      CREATE INDEX IF NOT EXISTS documents_idempotency_claimed_idx
        ON documents ((data->>'claimedAt'))
        WHERE collection = 'idempotency';
      CREATE INDEX IF NOT EXISTS documents_outbox_dead_created_idx
        ON documents ((data->>'createdAt'))
        WHERE collection = 'outbox_dead';
    `,
    down: `
      DROP INDEX IF EXISTS documents_replay_decided_idx;
      DROP INDEX IF EXISTS documents_idempotency_claimed_idx;
      DROP INDEX IF EXISTS documents_outbox_dead_created_idx;
    `,
  },
  {
    id: "005_notification_deliveries_index",
    up: `
      CREATE INDEX IF NOT EXISTS documents_notification_deliveries_status_idx
        ON documents ((data->>'status'), (data->>'nextAttemptAt'))
        WHERE collection = 'notification-deliveries';
    `,
    down: "DROP INDEX IF EXISTS documents_notification_deliveries_status_idx",
  },
  {
    id: "006_audit_log_index",
    up: `
      CREATE INDEX IF NOT EXISTS documents_audit_at_idx
        ON documents ((data->>'at'))
        WHERE collection = 'audit-log';
    `,
    down: "DROP INDEX IF EXISTS documents_audit_at_idx",
  },
];
