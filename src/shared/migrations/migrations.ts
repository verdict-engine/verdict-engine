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
  {
    id: "007_typed_decision_tables",
    // The high-volume, append-only decision logs move out of the shared `documents` table into
    // dedicated typed tables with real indexed columns, so `recent`, `samplesFor` and subject erasure
    // become indexed queries instead of full-collection scans, and their vacuum/index maintenance no
    // longer competes with every other collection. The full record is still kept as `data jsonb`; the
    // typed columns are a query surface. Existing rows are backfilled from `documents`, then removed
    // (this migration runs in one transaction, before the app serves traffic — an all-or-nothing
    // cutover). See src/shared/adapters/typed-tables.ts for the column registry the store reads.
    up: `
      CREATE TABLE IF NOT EXISTS verdict_log (
        id text PRIMARY KEY,
        decided_at timestamptz,
        verdict text,
        event_id text,
        data jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS verdict_log_decided_idx ON verdict_log (decided_at DESC);

      CREATE TABLE IF NOT EXISTS activity_log (
        id text PRIMARY KEY,
        decided_at timestamptz,
        subject_user_id text,
        event_type text,
        data jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS activity_log_decided_idx ON activity_log (decided_at DESC);
      CREATE INDEX IF NOT EXISTS activity_log_user_idx ON activity_log (subject_user_id);

      CREATE TABLE IF NOT EXISTS replay_log (
        id text PRIMARY KEY,
        decided_at timestamptz,
        event_type text,
        subject_user_id text,
        data jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS replay_log_type_decided_idx ON replay_log (event_type, decided_at DESC);
      CREATE INDEX IF NOT EXISTS replay_log_user_idx ON replay_log (subject_user_id);

      INSERT INTO verdict_log (id, decided_at, verdict, event_id, data)
        SELECT id, (data->>'decidedAt')::timestamptz, data->>'verdict', data->>'eventId', data
        FROM documents WHERE collection = 'verdicts'
        ON CONFLICT (id) DO NOTHING;
      DELETE FROM documents WHERE collection = 'verdicts';

      INSERT INTO activity_log (id, decided_at, subject_user_id, event_type, data)
        SELECT id, (data->>'decidedAt')::timestamptz, data->'request'->'subject'->>'userId', data->>'eventType', data
        FROM documents WHERE collection = 'activity'
        ON CONFLICT (id) DO NOTHING;
      DELETE FROM documents WHERE collection = 'activity';

      INSERT INTO replay_log (id, decided_at, event_type, subject_user_id, data)
        SELECT id, (data->>'decidedAt')::timestamptz, data->>'eventType', data->'event'->'subject'->>'userId', data
        FROM documents WHERE collection = 'replay-samples'
        ON CONFLICT (id) DO NOTHING;
      DELETE FROM documents WHERE collection = 'replay-samples';

      DROP INDEX IF EXISTS documents_verdicts_decided_idx;
      DROP INDEX IF EXISTS documents_activity_decided_idx;
      DROP INDEX IF EXISTS documents_activity_user_idx;
      DROP INDEX IF EXISTS documents_replay_type_idx;
      DROP INDEX IF EXISTS documents_replay_decided_idx;
    `,
    // Reverse (manual): copy rows back into `documents`, then drop the typed tables. We never
    // auto-roll-back a forward migration in place; this documents the inverse.
    down: `
      INSERT INTO documents (collection, id, data)
        SELECT 'verdicts', id, data FROM verdict_log ON CONFLICT (collection, id) DO NOTHING;
      INSERT INTO documents (collection, id, data)
        SELECT 'activity', id, data FROM activity_log ON CONFLICT (collection, id) DO NOTHING;
      INSERT INTO documents (collection, id, data)
        SELECT 'replay-samples', id, data FROM replay_log ON CONFLICT (collection, id) DO NOTHING;
      DROP TABLE IF EXISTS verdict_log;
      DROP TABLE IF EXISTS activity_log;
      DROP TABLE IF EXISTS replay_log;
    `,
  },
  {
    id: "008_org_scoping",
    // Multi-tenancy: every row gains an owning org. Existing rows belong to the 'default' org (a
    // single-tenant deployment stays entirely in 'default'). The store filters scoped collections by
    // the request's org, so one tenant can never read another's data. The documents primary key gains
    // org_id so the same logical id (e.g. an Idempotency-Key) can exist independently per org. Typed
    // tables keep their globally-unique id as the key and add org_id as a scoping column with an index
    // matching the scoped hot read (org_id + recency). See src/shared/adapters/tenant-context.ts.
    up: `
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
      ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_pkey;
      ALTER TABLE documents ADD PRIMARY KEY (collection, org_id, id);

      ALTER TABLE verdict_log ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
      CREATE INDEX IF NOT EXISTS verdict_log_org_decided_idx ON verdict_log (org_id, decided_at DESC);

      ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
      CREATE INDEX IF NOT EXISTS activity_log_org_decided_idx ON activity_log (org_id, decided_at DESC);

      ALTER TABLE replay_log ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
      CREATE INDEX IF NOT EXISTS replay_log_org_type_decided_idx ON replay_log (org_id, event_type, decided_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS verdict_log_org_decided_idx;
      DROP INDEX IF EXISTS activity_log_org_decided_idx;
      DROP INDEX IF EXISTS replay_log_org_type_decided_idx;
      ALTER TABLE verdict_log DROP COLUMN IF EXISTS org_id;
      ALTER TABLE activity_log DROP COLUMN IF EXISTS org_id;
      ALTER TABLE replay_log DROP COLUMN IF EXISTS org_id;
      ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_pkey;
      ALTER TABLE documents ADD PRIMARY KEY (collection, id);
      ALTER TABLE documents DROP COLUMN IF EXISTS org_id;
    `,
  },
];
