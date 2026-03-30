import { z } from "zod";
import type { NotificationPreferences } from "../db/notificationDb.js";

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

export const notificationPreferencesSchema = z
  .object({
    userId: z.string().min(1, "userId is required").optional(),
    emailEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
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
    events: {
      rebalance: input.events.rebalance,
      circuitBreaker: input.events.circuitBreaker,
      priceMovement: input.events.priceMovement,
      riskChange: input.events.riskChange,
    },
  };
}
