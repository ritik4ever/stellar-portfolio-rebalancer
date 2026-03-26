import { z } from 'zod';

export const PROTOCOL_VERSION = "1.0.0";

export const WSMessageSchema = z.object({
  version: z.string().refine(v => v === PROTOCOL_VERSION, {
    message: "Protocol version mismatch. Required: " + PROTOCOL_VERSION
  }),
  type: z.enum(['PING', 'PONG', 'PRICE_UPDATE', 'REBALANCE_STATUS', 'ERROR']),
  payload: z.any().optional(),
  timestamp: z.number().default(() => Date.now())
});

export type WSMessage = z.infer<typeof WSMessageSchema>;