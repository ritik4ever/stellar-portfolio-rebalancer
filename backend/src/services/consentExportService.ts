import type { ConsentPolicyVersions } from "../config/consentPolicyConfig.js";
import { getConsentPolicyVersions } from "../config/consentPolicyConfig.js";
import {
  databaseService,
  type ConsentAuditEvent,
  type ConsentRecord,
} from "./databaseService.js";

export interface ConsentSnapshotExport {
  active: boolean;
  accepted: boolean;
  termsAcceptedAt: string | null;
  privacyAcceptedAt: string | null;
  cookieAcceptedAt: string | null;
  revokedAt: string | null;
  updatedAt: string | null;
  policyVersions: ConsentPolicyVersions | null;
}

export interface ConsentHistoryEventExport {
  id: string;
  action: ConsentAuditEvent["action"];
  timestamp: string;
  policyVersions: ConsentPolicyVersions | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface ConsentHistoryExport {
  userId: string;
  exportedAt: string;
  deployedPolicyVersions: ConsentPolicyVersions;
  current: ConsentSnapshotExport | null;
  history: ConsentHistoryEventExport[];
}

function buildSnapshot(
  userId: string,
  consent: ConsentRecord | undefined,
): ConsentSnapshotExport | null {
  if (!consent) return null;
  return {
    active: consent.active,
    accepted: databaseService.hasFullConsent(userId),
    termsAcceptedAt: consent.termsAcceptedAt,
    privacyAcceptedAt: consent.privacyAcceptedAt,
    cookieAcceptedAt: consent.cookieAcceptedAt,
    revokedAt: consent.revokedAt,
    updatedAt: consent.updatedAt,
    policyVersions: consent.policyVersions,
  };
}

export function buildConsentHistoryExport(userId: string): ConsentHistoryExport {
  const consent = databaseService.getConsent(userId);
  const events = databaseService.getConsentAudit(userId);

  return {
    userId,
    exportedAt: new Date().toISOString(),
    deployedPolicyVersions: getConsentPolicyVersions(),
    current: buildSnapshot(userId, consent),
    history: events.map((event) => ({
      id: event.id,
      action: event.action,
      timestamp: event.timestamp,
      policyVersions: event.policyVersions,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
    })),
  };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function formatConsentHistoryCsv(exportData: ConsentHistoryExport): string {
  const header = [
    "record_type",
    "user_id",
    "event_id",
    "action",
    "timestamp",
    "terms_version",
    "privacy_version",
    "cookie_version",
    "terms_accepted_at",
    "privacy_accepted_at",
    "cookie_accepted_at",
    "revoked_at",
    "active",
    "accepted",
    "ip_address",
    "user_agent",
    "exported_at",
  ].join(",");

  const rows: string[] = [header];
  const pushRow = (cells: string[]) => rows.push(cells.map(csvEscape).join(","));

  if (exportData.current) {
    const c = exportData.current;
    const v = c.policyVersions ?? exportData.deployedPolicyVersions;
    pushRow([
      "snapshot",
      exportData.userId,
      "",
      "",
      c.updatedAt ?? exportData.exportedAt,
      v.terms,
      v.privacy,
      v.cookies,
      c.termsAcceptedAt ?? "",
      c.privacyAcceptedAt ?? "",
      c.cookieAcceptedAt ?? "",
      c.revokedAt ?? "",
      String(c.active),
      String(c.accepted),
      "",
      "",
      exportData.exportedAt,
    ]);
  }

  for (const event of exportData.history) {
    const v = event.policyVersions ?? exportData.deployedPolicyVersions;
    pushRow([
      "history",
      exportData.userId,
      event.id,
      event.action,
      event.timestamp,
      v.terms,
      v.privacy,
      v.cookies,
      "",
      "",
      "",
      "",
      "",
      "",
      event.ipAddress ?? "",
      event.userAgent ?? "",
      exportData.exportedAt,
    ]);
  }

  return rows.join("\n");
}
