export const DEFAULT_JWT_CLOCK_SKEW_SEC = 30;
export const MAX_JWT_CLOCK_SKEW_SEC = 300;

/**
 * Returns the JWT clock skew tolerance, in seconds.
 *
 * Distributed API deployments can see small wall-clock differences between
 * nodes. JWT_CLOCK_SKEW_SEC provides a bounded tolerance for exp and iat
 * validation so tokens that are only a few seconds early/late are not rejected
 * solely due to clock drift.
 */
export function getJwtClockSkewSec(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = (env.JWT_CLOCK_SKEW_SEC || `${DEFAULT_JWT_CLOCK_SKEW_SEC}`).trim();
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0 || value > MAX_JWT_CLOCK_SKEW_SEC) {
    return DEFAULT_JWT_CLOCK_SKEW_SEC;
  }
  return value;
}
