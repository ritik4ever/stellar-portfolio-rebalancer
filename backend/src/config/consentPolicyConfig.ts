/**
 * Deployed legal document versions referenced when recording and exporting consent.
 */

export interface ConsentPolicyVersions {
  terms: string;
  privacy: string;
  cookies: string;
}

const DEFAULT_VERSION = "1.0.0";

export function getConsentPolicyVersions(
  env: NodeJS.ProcessEnv = process.env,
): ConsentPolicyVersions {
  return {
    terms: (env.LEGAL_TERMS_VERSION || DEFAULT_VERSION).trim(),
    privacy: (env.LEGAL_PRIVACY_VERSION || DEFAULT_VERSION).trim(),
    cookies: (env.LEGAL_COOKIE_VERSION || DEFAULT_VERSION).trim(),
  };
}

export function parseConsentPolicyVersions(
  raw: string | null | undefined,
): ConsentPolicyVersions | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentPolicyVersions>;
    if (
      typeof parsed.terms === "string" &&
      typeof parsed.privacy === "string" &&
      typeof parsed.cookies === "string"
    ) {
      return {
        terms: parsed.terms,
        privacy: parsed.privacy,
        cookies: parsed.cookies,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeConsentPolicyVersions(
  versions: ConsentPolicyVersions,
): string {
  return JSON.stringify(versions);
}
