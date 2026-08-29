import { z } from "zod";
import type { NotificationPreferences, PortfolioNotificationOverride } from "../db/notificationDb.js";

export const NOTIFICATION_EVENTS = [
  "rebalance",
  "circuitBreaker",
  "priceMovement",
  "riskChange",
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number];

export const notificationEventsSchema = z.object({
  rebalance: z.boolean(),
  circuitBreaker: z.boolean(),
  priceMovement: z.boolean(),
  riskChange: z.boolean(),
});

const webhookUrlSchema = z
  .string()
  .url("webhookUrl must be a valid URL")
  .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
    message: "webhookUrl must use http or https",
  });

export const priceAlertThresholdsSchema = z
  .record(
    z.string().trim().min(1).toUpperCase(),
    z.number().positive("price alert thresholds must be positive numbers").max(10000)
  )
  .optional();

export const notificationPreferencesSchema = z
  .object({
    userId: z.string().min(1, "userId is required").optional(),
    emailEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    digestMode: z.enum(['immediate','daily','weekly']).optional(),
    priceAlertThresholds: priceAlertThresholdsSchema,
    emailAddress: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().email("emailAddress must be a valid email").optional(),
    ),
    webhookUrl: z.preprocess(
      (v) => (v === "" ? undefined : v),
      webhookUrlSchema.optional(),
    ),
    events: notificationEventsSchema,
  })
  .superRefine((data, ctx) => {
    if (data.emailEnabled && !data.emailAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "emailAddress is required when emailEnabled is true",
        path: ["emailAddress"],
      });
    }
    if (data.webhookEnabled && !data.webhookUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "webhookUrl is required when webhookEnabled is true",
        path: ["webhookUrl"],
      });
    }
  });

export type NotificationPreferencesInput = z.infer<
  typeof notificationPreferencesSchema
>;

export function normalizeNotificationPreferences(
  input: NotificationPreferencesInput & { userId: string },
): NotificationPreferences {
  return {
    userId: input.userId.trim(),
    emailEnabled: input.emailEnabled,
    emailAddress: input.emailEnabled
      ? input.emailAddress?.trim() || undefined
      : undefined,
    webhookEnabled: input.webhookEnabled,
    webhookUrl: input.webhookEnabled
      ? input.webhookUrl?.trim() || undefined
      : undefined,
    digestMode: input.digestMode || 'immediate',
    priceAlertThresholds: input.priceAlertThresholds,
    events: {
      rebalance: input.events.rebalance,
      circuitBreaker: input.events.circuitBreaker,
      priceMovement: input.events.priceMovement,
      riskChange: input.events.riskChange,
    },
  };
}

// ── per-portfolio overrides (#1395) ──────────────────────────────────────────

/**
 * A portfolio-level override is a *partial* set of preferences layered on top of
 * the user's global settings. Every field is optional: omitting one means "keep
 * whatever my global preference says", so a later change to a global setting
 * still reaches portfolios that never overrode it.
 */
export const portfolioNotificationOverrideSchema = z
  .object({
    emailEnabled: z.boolean().optional(),
    webhookEnabled: z.boolean().optional(),
    emailAddress: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().email("emailAddress must be a valid email").optional(),
    ),
    webhookUrl: z.preprocess(
      (v) => (v === "" ? undefined : v),
      webhookUrlSchema.optional(),
    ),
    digestMode: z.enum(["immediate", "daily", "weekly"]).optional(),
    events: notificationEventsSchema.partial().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Turning a channel on for one portfolio requires a destination — either in
    // the override itself or already present globally, which the route checks.
    if (data.emailEnabled === true && data.emailAddress === undefined) return
    if (data.webhookEnabled === true && data.webhookUrl === undefined) return
    if (Object.keys(data).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one preference field must be provided",
      });
    }
  });

export type PortfolioNotificationOverrideInput = z.infer<
  typeof portfolioNotificationOverrideSchema
>;

/**
 * Resolve the preferences that actually apply to one portfolio: the user's
 * global preferences with any override fields layered on top. Event flags merge
 * key-by-key, so overriding `rebalance` alone leaves the other three global.
 *
 * Returns the global preferences unchanged when no override exists.
 */
export function resolvePortfolioNotificationPreferences(
  global: NotificationPreferences,
  override?: PortfolioNotificationOverride | null,
): NotificationPreferences & { overrideApplied: boolean } {
  if (!override) {
    return { ...global, overrideApplied: false };
  }

  const emailEnabled = override.emailEnabled ?? global.emailEnabled;
  const webhookEnabled = override.webhookEnabled ?? global.webhookEnabled;
  const emailAddress = override.emailAddress ?? global.emailAddress;
  const webhookUrl = override.webhookUrl ?? global.webhookUrl;

  return {
    userId: global.userId,
    // A channel enabled by the override but with no destination anywhere stays
    // off — a half-configured override must not silently drop notifications.
    emailEnabled: emailEnabled && Boolean(emailAddress),
    emailAddress,
    webhookEnabled: webhookEnabled && Boolean(webhookUrl),
    webhookUrl,
    digestMode: override.digestMode ?? global.digestMode ?? "immediate",
    priceAlertThresholds: global.priceAlertThresholds,
    events: {
      rebalance: override.events?.rebalance ?? global.events.rebalance,
      circuitBreaker: override.events?.circuitBreaker ?? global.events.circuitBreaker,
      priceMovement: override.events?.priceMovement ?? global.events.priceMovement,
      riskChange: override.events?.riskChange ?? global.events.riskChange,
    },
    overrideApplied: true,
  };
}
