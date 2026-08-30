import crypto from 'crypto';
import axios from 'axios';

interface WebhookPayload {
  event_type: 'DRIFT_EXCEEDED' | 'REBALANCE_COMPLETED' | 'CIRCUIT_BREAKER_TRIGGERED';
  portfolio_id: string;
  timestamp: number;
  drift_details?: any;
  rebalance_summary?: any;
}

export const fireWebhook = async (url: string, secret: string, payload: WebhookPayload) => {
  const timestamp = Date.now();
  const body = JSON.stringify({ ...payload, timestamp });
  
  const signature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  try {
    await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'X-Signature': signature,
      },
      timeout: 5000,
    });
  } catch (error) {
    console.error('Webhook delivery failed, pushing to DLQ:', error);
  }
};
