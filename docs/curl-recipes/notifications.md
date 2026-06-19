# Notifications workflow

These recipes demonstrate how to subscribe to notifications, read preferences, and unsubscribe using the backend API.

## 1. Subscribe to notifications

```bash
curl -X POST http://localhost:3001/api/v1/notifications/subscribe \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: b1b256c8-7f8b-4e95-a43d-9a1c1a6c4a16" \
  -d '{
    "userId": "GABCEXAMPLE1234567890",
    "emailEnabled": true,
    "emailAddress": "user@example.com",
    "webhookEnabled": false,
    "events": {
      "rebalance": true,
      "circuitBreaker": true,
      "priceMovement": false,
      "riskChange": false
    }
  }'
```

If JWT auth is enabled, omit `userId` and add:

```bash
-H "Authorization: Bearer <token>"
```

## 2. Get notification preferences

```bash
curl "http://localhost:3001/api/v1/notifications/preferences?userId=GABCEXAMPLE1234567890"
```

## 3. Unsubscribe from notifications

```bash
curl -X DELETE "http://localhost:3001/api/v1/notifications/unsubscribe?userId=GABCEXAMPLE1234567890"
```

## 4. (Optional) Read delivery logs

```bash
curl "http://localhost:3001/api/v1/notifications/logs?userId=GABCEXAMPLE1234567890"
```

This is useful when debugging notification delivery or verifying webhook behavior.
