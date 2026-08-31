# Issuer Verification for Unlisted Assets

Unlisted assets submitted by users go through an explicit review workflow instead of
being silently trusted (#1412).

## States

| Status | Enabled | Meaning |
| --- | --- | --- |
| `pending` | no | Submitted by a user, awaiting admin review |
| `verified` | yes | Approved by an admin; tradable and visible in the catalog |
| `rejected` | no | Reviewed and refused |

A pending or rejected asset is stored **disabled**, so it never appears in the enabled
catalog (`assetRegistryService.list(true)`) and cannot be traded. Assets that predate
the workflow report `verified`, preserving existing behaviour.

Only `pending` assets can be decided on; a second decision returns 409.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/assets/submissions` | JWT | Submit an unlisted asset |
| `GET` | `/api/v1/admin/assets/submissions` | admin | List pending submissions |
| `POST` | `/api/v1/admin/assets/:symbol/verification` | admin | `{ "decision": "approve" \| "reject", "notes": "…" }` |

Submissions record `submitted_by`; decisions record `reviewed_by`, `reviewed_at`, and
the reviewer's `notes`. Both sides are written to the audit log.

## Frontend

`AssetVerificationBadge` flags an asset's status in `AssetSearch` and `AssetSelector`.
Verified assets show no badge by default (verified is the norm); `pending` renders an
amber "Unverified issuer" badge and `rejected` a red one, each with an explanatory
tooltip.

## Storage

The `assets` table gains `verification_status`, `verification_notes`, `submitted_by`,
`reviewed_by`, and `reviewed_at`, added by an idempotent column migration that defaults
existing rows to `verified`.
