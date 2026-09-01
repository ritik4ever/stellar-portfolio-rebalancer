/**
 * RDS manual snapshot retention.
 *
 * Runs daily via EventBridge. Deletes manual snapshots that:
 *   1. are tagged SnapshotOwner === SNAPSHOT_OWNER (exact match), AND
 *   2. are older than RETENTION_DAYS, AND
 *   3. are not the final snapshot (FINAL_SNAPSHOT identifier), AND
 *   4. have status "available" (never touch in-progress/failed ones).
 *
 * Anything without the exact ownership tag is NEVER considered — unrelated
 * or third-party snapshots in the same account cannot be selected, and the
 * lack of any resource-level IAM restriction on rds:DeleteDBSnapshot is
 * compensated by this strict allowlist.
 *
 * Snapshots we own get SnapshotOwner + SnapshotEnvironment tags stamped on
 * (with SnapshotCreateTime visible in the AWS console) for identification.
 *
 * Idempotent: a snapshot either still exists or is already gone; failures on
 * one snapshot are logged and do not stop processing the rest.
 */

import {
  DescribeDBSnapshotsCommand,
  DeleteDBSnapshotCommand,
  AddTagsToResourceCommand,
  RDSClient,
} from '@aws-sdk/client-rds';

const rds = new RDSClient({});

const OWNER_TAG = 'SnapshotOwner';
const ENV_TAG = 'SnapshotEnvironment';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const handler = async () => {
  const owner = process.env.SNAPSHOT_OWNER;
  const environment = process.env.ENVIRONMENT || 'unknown';
  const retentionDays = Number(process.env.RETENTION_DAYS || 7);
  const finalSnapshot = process.env.FINAL_SNAPSHOT || '';
  const cutoff = Date.now() - retentionDays * MS_PER_DAY;

  const snapshots = [];
  let marker;
  do {
    const page = await rds.send(new DescribeDBSnapshotsCommand({
      SnapshotType: 'manual',
      MaxRecords: 100,
      Marker: marker,
    }));
    snapshots.push(...(page.DBSnapshots ?? []));
    marker = page.Marker;
  } while (marker);

  const results = { examined: snapshots.length, deleted: [], tagged: 0, failed: [] };

  // Stamp ownership/environment metadata on our own snapshots that lack it,
  // so identification in the AWS console is straightforward.
  for (const snap of snapshots) {
    const tags = snap.TagList ?? [];
    const taggedOwner = tags.find((t) => t.Key === OWNER_TAG)?.Value;
    if (taggedOwner !== owner) continue; // never touch others' snapshots
    const needsOwner = !taggedOwner;
    const needsEnv = !tags.some((t) => t.Key === ENV_TAG);
    if (needsOwner || needsEnv) {
      try {
        const toAdd = [];
        if (needsOwner) toAdd.push({ Key: OWNER_TAG, Value: owner });
        if (needsEnv) toAdd.push({ Key: ENV_TAG, Value: environment });
        await rds.send(new AddTagsToResourceCommand({
          ResourceName: snap.DBSnapshotArn,
          Tags: toAdd,
        }));
        results.tagged += 1;
      } catch (err) {
        results.failed.push({ id: snap.DBSnapshotIdentifier, error: err.message });
        console.error(`TAG FAILED ${snap.DBSnapshotIdentifier}: ${err.message}`);
      }
    }
  }

  const deletable = snapshots.filter((s) => {
    if (s.Status !== 'available') return false;
    if (s.DBSnapshotIdentifier === finalSnapshot) return false;
    const taggedOwner = (s.TagList ?? []).find((t) => t.Key === OWNER_TAG)?.Value;
    if (taggedOwner !== owner) return false;
    return new Date(s.SnapshotCreateTime).getTime() < cutoff;
  });
  for (const snap of deletable) {
    try {
      await rds.send(new DeleteDBSnapshotCommand({ DBSnapshotIdentifier: snap.DBSnapshotIdentifier }));
      results.deleted.push(snap.DBSnapshotIdentifier);
      console.log(`deleted ${snap.DBSnapshotIdentifier} (created ${snap.SnapshotCreateTime})`);
    } catch (err) {
      // One bad snapshot must not block the rest; alarm fires if any fail.
      results.failed.push({ id: snap.DBSnapshotIdentifier, error: err.message });
      console.error(`FAILED ${snap.DBSnapshotIdentifier}: ${err.message}`);
    }
  }

  console.log(JSON.stringify({
    owner, environment, retentionDays,
    examined: results.examined,
    eligible: deletable.length,
    deleted: results.deleted.length,
    tagged: results.tagged,
    failed: results.failed.length,
  }));

  if (results.failed.length > 0) {
    throw new Error(`${results.failed.length} snapshot deletion(s) failed: ${JSON.stringify(results.failed)}`);
  }
  return results;
};
