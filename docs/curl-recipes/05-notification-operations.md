# Notification Operations

Subscribe to notifications, manage preferences, and view delivery logs.

## Subscribe to Notifications

```bash
curl -X POST "$API_BASE/api/v1/notifications/subscribe" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "GABCD...",
    "emailAddress": "user@example.com",
    "emailEnabled": true,
    "webhookUrl": "https://example.com/webhook",
    "webhookEnabled": true
  }' | jq
```

## Get Notification Preferences

```bash
curl -s "$API_BASE/api/v1/notifications/preferences?userId=GABCD..." | jq
```

## Update Notification Preferences

```bash
curl -X PUT "$API_BASE/api/v1/notifications/preferences" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "GABCD...",
    "emailEnabled": false,
    "webhookEnabled": true
  }' | jq
```

## Unsubscribe from Notifications

```bash
curl -X DELETE "$API_BASE/api/v1/notifications/unsubscribe?userId=GABCD..." | jq
```

## Get Notification Delivery Logs

```bash
curl -s "$API_BASE/api/v1/notifications/logs?userId=GABCD..." | jq
```

## Get Notification Delivery Logs with Pagination

```bash
curl -s "$API_BASE/api/v1/notifications/logs?userId=GABCD...&limit=10&offset=0" | jq
```

## Verify Webhook Signature (for inbound callbacks)

```bash
curl -X POST "$API_BASE/api/v1/notifications/webhook/callback" \
  -H "Content-Type: application/json" \
  -H "x-signature-256: SIGNATURE_HERE" \
  -d '{
    "event": "notification_delivered",
    "data": {}
  }' | jq
```
