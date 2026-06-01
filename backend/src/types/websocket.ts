import { z } from 'zod';

export const PROTOCOL_VERSION = "1.0.0";
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const RECONNECT_MAX_ATTEMPTS = 12;
export const RECONNECT_SUGGESTED_BACKOFF_MS = 30_000;

export const WSIncomingMessageTypeEnum = z.enum(['PING', 'PONG', 'SUBSCRIBE']);
export type WSIncomingMessageType = z.infer<typeof WSIncomingMessageTypeEnum>;

export const WSMessageSchema = z.object({
  version: z.string().refine((v) => v === PROTOCOL_VERSION, {
    message: "Protocol version mismatch. Required: " + PROTOCOL_VERSION
  }),
  type: WSIncomingMessageTypeEnum,
  payload: z.any().optional(),
  timestamp: z.number().default(() => Date.now())
});

export type WSMessage = z.infer<typeof WSMessageSchema>;
