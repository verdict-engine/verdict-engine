/**
 * Export a labelled training dataset for the ML scorer from REAL history. It joins the fraud/legit
 * labels (analyst case resolutions + PSP chargebacks) to the feature snapshot each labelled event was
 * decided from (the replay log), and writes rows of { x: <14 scaled features>, y: 0|1 } — the exact
 * feature vector the engine serves on, via the shared extractor, so training can't drift from serving.
 *
 * Run against your production database, then train on the result:
 *
 *   DATABASE_URL=postgres://…  npx tsx scripts/export-training-data.ts  [out.json]
 *   npm run train:model -- --data out.json
 *
 * This is the "close the loop" step: the labels you already collect become the ML model's training set,
 * replacing the bundled synthetic demo model.
 */
import { writeFileSync } from "node:fs";
import { PgStore } from "../src/shared/adapters/pg-store.adapter";
import { mlVector } from "../src/contexts/scoring/domain/ml-features";
import type { Label } from "../src/contexts/feedback/application/feedback.port";
import type { ReplaySample } from "../src/contexts/decision/application/replay-log.port";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error("DATABASE_URL is required — the labelled history lives in Postgres.");
    process.exit(1);
  }
  const out = process.argv[2] ?? "ml-training-data.json";
  const store = new PgStore();

  const labels = await store.collection<Label>("labels").all();
  const replay = store.collection<ReplaySample>("replay-samples");

  // One label per event (latest wins), so a re-labelled event is not double-counted.
  const latest = new Map<string, Label>();
  for (const l of labels) {
    const prev = latest.get(l.eventId);
    if (!prev || l.at > prev.at) latest.set(l.eventId, l);
  }

  const rows: Array<{ x: number[]; y: number }> = [];
  let noSample = 0;
  for (const [eventId, label] of latest) {
    const sample = await replay.get(eventId);
    if (!sample) {
      // Labelled but nothing to replay — e.g. a list short-circuit or a decision before sampling.
      noSample += 1;
      continue;
    }
    rows.push({ x: mlVector(sample.score, sample.features), y: label.outcome === "fraud" ? 1 : 0 });
  }

  const fraud = rows.filter((r) => r.y === 1).length;
  writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), rows }));

  // eslint-disable-next-line no-console
  console.log(`Exported ${rows.length} rows (${fraud} fraud, ${rows.length - fraud} legit) to ${out}.`);
  if (noSample > 0) {
    // eslint-disable-next-line no-console
    console.log(`Skipped ${noSample} labelled events with no replay sample.`);
  }
  if (rows.length < 200 || fraud < 20) {
    // eslint-disable-next-line no-console
    console.warn("Warning: too few labelled rows for a trustworthy model — collect more labels before relying on it.");
  }
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
