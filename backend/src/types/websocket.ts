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

/**
 * WebSocket session metadata containing authentication and expiry info
 * Ensures real-time sessions do not outlive their HTTP session auth guarantees
 */
export interface WSSessionMetadata {
  /** User's wallet address from JWT sub claim */
  userId: string;
  
  /** When the connection was authenticated (ISO 8601) */
  authenticatedAt: string;
  
  /** When the JWT token expires (ISO 8601) */
  tokenExpiresAt: string;
  
  /** Token expiry as Unix timestamp (seconds) */
  tokenExpiryTimestamp: number;
}