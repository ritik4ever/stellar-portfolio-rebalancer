# Notification System Documentation

## Overview

The Stellar Portfolio Rebalancer includes a comprehensive notification system that alerts users about important portfolio events via email and webhooks.

## Features

- **Email Notifications**: Send alerts via SMTP (Gmail, SendGrid, Mailgun, AWS SES, etc.)
- **Webhook Notifications**: POST JSON payloads to custom endpoints
- **Event Filtering**: Subscribe to specific event types
- **User Preferences**: Per-user notification configuration
- **Retry Logic**: Automatic retry for failed webhook deliveries
- **Non-blocking**: Notification failures don't affect core operations

## Event Types

### 1. Rebalance Events
Triggered when a portfolio is rebalanced (manual or automatic).

**When triggered:**
- Manual rebalance executed via API
- Automatic rebalance executed by auto-rebalancer service

**Payload data:**
- `portfolioId`: Portfolio identifier
- `trades`: Number of trades executed
- `gasUsed`: Gas consumed (e.g., "0.0234 XLM")
- `trigger`: "manual" or "automatic"

### 2. Circuit Breaker Events
Triggered when circuit breakers activate due to market conditions.

**When triggered:**
- High volatility detected
- Extreme price movements
- Market instability

**Payload data:**
- `asset`: Asset that triggered the breaker
- `priceChange`: Percentage change
- `cooldownMinutes`: Cooldown period

### 3. Price Movement Events
Triggered when significant price movements are detected.

**When triggered:**
- Asset price changes exceed threshold (typically >10%)

**Payload data:**
- `asset`: Asset symbol
- `priceChange`: Percentage change
- `currentPrice`: Current price in USD
- `direction`: "increased" or "decreased"

### 4. Risk Level Change Events
Triggered when portfolio risk level changes.

**When triggered:**
- Risk level increases or decreases
- Concentration risk changes
- Volatility risk changes

**Payload data:**
- `portfolioId`: Portfolio identifier
- `oldLevel`: Previous risk level
- `newLevel`: Current risk level
- `severity`: "increased" or "decreased"

## Webhook Payload Format

All webhook notifications are sent as HTTP POST requests with the following JSON structure:

```json
{
  "event": "rebalance",
  "title": "Portfolio Rebalanced",
  "message": "Your portfolio has been automatically rebalanced. 3 trades executed with 0.0234 XLM gas used.",
  "data": {
    "portfolioId": "portfolio-123",
    "trades": 3,
    "gasUsed": "0.0234 XLM",
    "trigger": "automatic"
  },
  "timestamp": "2024-02-20T10:30:00.000Z",
  "userId": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

### Webhook Headers

```
Content-Type: application/json
User-Agent: StellarPortfolioRebalancer/1.0
```

### Webhook Response

Your webhook endpoint should:
- Respond with HTTP 2xx status code for success
- Respond within 5 seconds (timeout)
- Handle retries gracefully (1 retry after 1 second delay)

### Example Webhook Implementations

#### Node.js/Express
```javascript
app.post('/webhook', express.json(), (req, res) => {
  const { event, title, message, data, timestamp, userId } = req.body
  
  console.log(`Received ${event} notification for user ${userId}`)
  console.log(`Message: ${message}`)
  console.log(`Data:`, data)
  
  // Process notification
  // ... your logic here ...
  
  res.status(200).json({ received: true })
})
```

#### Python/Flask
```python
@app.route('/webhook', methods=['POST'])
def webhook():
    payload = request.json
    event = payload.get('event')
    message = payload.get('message')
    data = payload.get('data')
    
    print(f"Received {event} notification")
    print(f"Message: {message}")
    
    # Process notification
    # ... your logic here ...
    
    return jsonify({'received': True}), 200
```

## SMTP Configuration

### Gmail Setup

1. **Enable 2-Factor Authentication**
   - Go to Google Account settings
   - Security → 2-Step Verification → Turn on

2. **Generate App Password**
   - Go to: https://myaccount.google.com/apppasswords
   - Select "Mail" and your device
   - Copy the generated 16-character password

3. **Configure Environment Variables**
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-16-char-app-password
   SMTP_FROM=your-email@gmail.com
   ```

### SendGrid Setup

1. **Create SendGrid Account**
   - Sign up at https://sendgrid.com

2. **Generate API Key**
   - Settings → API Keys → Create API Key
   - Select "Full Access" or "Mail Send" permissions

3. **Configure Environment Variables**
   ```env
   SMTP_HOST=smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=apikey
   SMTP_PASS=your-sendgrid-api-key
   SMTP_FROM=verified-sender@yourdomain.com
   ```

### Mailgun Setup

1. **Create Mailgun Account**
   - Sign up at https://mailgun.com

2. **Get SMTP Credentials**
   - Sending → Domain Settings → SMTP Credentials

3. **Configure Environment Variables**
   ```env
   SMTP_HOST=smtp.mailgun.org
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=postmaster@your-domain.mailgun.org
   SMTP_PASS=your-mailgun-password
   SMTP_FROM=noreply@your-domain.com
   ```

### AWS SES Setup

1. **Verify Email/Domain**
   - AWS Console → SES → Verified Identities

2. **Create SMTP Credentials**
   - SES → SMTP Settings → Create SMTP Credentials

3. **Configure Environment Variables**
   ```env
   SMTP_HOST=email-smtp.us-east-1.amazonaws.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-smtp-username
   SMTP_PASS=your-smtp-password
   SMTP_FROM=verified@yourdomain.com
   ```

## Email Template

Emails are sent in both plain text and HTML formats:

### Plain Text Format
```
Portfolio Rebalanced

Your portfolio has been automatically rebalanced. 3 trades executed with 0.0234 XLM gas used.

Event Type: rebalance
Time: 2024-02-20T10:30:00.000Z

---
Stellar Portfolio Rebalancer
```

### HTML Format
```html
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #3B82F6; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
        .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>Portfolio Rebalanced</h2>
        </div>
        <div class="content">
            <p>Your portfolio has been automatically rebalanced. 3 trades executed with 0.0234 XLM gas used.</p>
            <p><strong>Event Type:</strong> rebalance</p>
            <p><strong>Time:</strong> 2024-02-20T10:30:00.000Z</p>
        </div>
        <div class="footer">
            <p>Stellar Portfolio Rebalancer</p>
        </div>
    </div>
</body>
</html>
```

## API Endpoints

### Subscribe to Notifications
```http
POST /api/notifications/subscribe
Content-Type: application/json

{
  "userId": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "emailEnabled": true,
  "emailAddress": "user@example.com",
  "webhookEnabled": true,
  "webhookUrl": "https://your-domain.com/webhook",
  "events": {
    "rebalance": true,
    "circuitBreaker": true,
    "priceMovement": true,
    "riskChange": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Notification preferences saved successfully",
  "timestamp": "2024-02-20T10:30:00.000Z"
}
```

### Get Notification Preferences
```http
GET /api/notifications/preferences?userId=GXXXXXXX...
```

**Response:**
```json
{
  "success": true,
  "preferences": {
    "userId": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "emailEnabled": true,
    "emailAddress": "user@example.com",
    "webhookEnabled": true,
    "webhookUrl": "https://your-domain.com/webhook",
    "events": {
      "rebalance": true,
      "circuitBreaker": true,
      "priceMovement": true,
      "riskChange": true
    }
  },
  "timestamp": "2024-02-20T10:30:00.000Z"
}
```

### Unsubscribe from Notifications
```http
DELETE /api/notifications/unsubscribe?userId=GXXXXXXX...
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully unsubscribed from all notifications",
  "timestamp": "2024-02-20T10:30:00.000Z"
}
```

### Test Notification Delivery
```http
POST /api/notifications/test
Content-Type: application/json

{
  "userId": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "eventType": "rebalance"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Test notification sent successfully",
  "sentTo": {
    "email": "user@example.com",
    "webhook": "https://your-domain.com/webhook"
  },
  "eventType": "rebalance",
  "timestamp": "2024-02-20T10:30:00.000Z"
}
```

### Test All Notification Types
```http
POST /api/notifications/test-all
Content-Type: application/json

{
  "userId": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Test notifications sent",
  "results": [
    { "eventType": "rebalance", "status": "sent" },
    { "eventType": "circuitBreaker", "status": "sent" },
    { "eventType": "priceMovement", "status": "sent" },
    { "eventType": "riskChange", "status": "sent" }
  ],
  "sentTo": {
    "email": "user@example.com",
    "webhook": "https://your-domain.com/webhook"
  },
  "timestamp": "2024-02-20T10:30:00.000Z"
}
```

## Testing

### Test with webhook.site

1. **Create Test Webhook**
   - Go to https://webhook.site
   - Copy your unique URL

2. **Configure Notification Preferences**
   ```bash
   curl -X POST http://localhost:3001/api/notifications/subscribe \
     -H "Content-Type: application/json" \
     -d '{
       "userId": "YOUR_STELLAR_ADDRESS",
       "emailEnabled": false,
       "emailAddress": "",
       "webhookEnabled": true,
       "webhookUrl": "https://webhook.site/your-unique-id",
       "events": {
         "rebalance": true,
         "circuitBreaker": true,
         "priceMovement": true,
         "riskChange": true
       }
     }'
   ```

3. **Send Test Notification**
   ```bash
   curl -X POST http://localhost:3001/api/notifications/test \
     -H "Content-Type: application/json" \
     -d '{
       "userId": "YOUR_STELLAR_ADDRESS",
       "eventType": "rebalance"
     }'
   ```

4. **Check webhook.site**
   - View the received payload
   - Verify JSON structure
   - Check headers

### Test Email Delivery

1. **Configure SMTP in .env**
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   SMTP_FROM=your-email@gmail.com
   ```

2. **Subscribe with Email**
   ```bash
   curl -X POST http://localhost:3001/api/notifications/subscribe \
     -H "Content-Type: application/json" \
     -d '{
       "userId": "YOUR_STELLAR_ADDRESS",
       "emailEnabled": true,
       "emailAddress": "your-email@gmail.com",
       "webhookEnabled": false,
       "webhookUrl": "",
       "events": {
         "rebalance": true,
         "circuitBreaker": true,
         "priceMovement": true,
         "riskChange": true
       }
     }'
   ```

3. **Send Test Email**
   ```bash
   curl -X POST http://localhost:3001/api/notifications/test \
     -H "Content-Type: application/json" \
     -d '{
       "userId": "YOUR_STELLAR_ADDRESS",
       "eventType": "rebalance"
     }'
   ```

4. **Check Your Inbox**
   - Verify email received
   - Check spam folder if not in inbox
   - Verify HTML formatting

## Troubleshooting

### Email Not Sending

**Problem**: Emails are not being delivered

**Solutions**:
1. Check SMTP credentials in .env
2. Verify SMTP_PASS is app password (not regular password for Gmail)
3. Check backend logs for error messages
4. Test SMTP connection with a simple script
5. Verify sender email is verified (for AWS SES, SendGrid)

### Webhook Failing

**Problem**: Webhook notifications failing

**Solutions**:
1. Verify webhook URL is accessible from server
2. Check webhook endpoint returns 2xx status code
3. Ensure webhook responds within 5 seconds
4. Check backend logs for specific error messages
5. Test webhook with webhook.site first

### Notifications Not Triggering

**Problem**: No notifications received after rebalance

**Solutions**:
1. Verify notification preferences are saved
2. Check event type is enabled in preferences
3. Verify userId matches wallet address
4. Check backend logs for notification attempts
5. Test with `/api/notifications/test` endpoint

## Security Considerations

1. **SMTP Credentials**
   - Never commit .env files with real credentials
   - Use app passwords, not regular passwords
   - Rotate credentials regularly

2. **Webhook URLs**
   - Use HTTPS in production
   - Validate webhook URLs before saving
   - Implement webhook signature verification (future enhancement)

3. **Rate Limiting**
   - Notification endpoints are rate-limited
   - Maximum 10 notifications per hour per user
   - Prevents spam and abuse

4. **Data Privacy**
   - Email addresses are stored securely
   - Webhook URLs are validated
   - User data is not shared with third parties

## Future Enhancements

- [ ] SMS notifications via Twilio
- [ ] Push notifications for mobile apps
- [ ] Webhook signature verification
- [ ] Notification templates customization
- [ ] Notification history/logs
- [ ] Batch notifications
- [ ] Notification scheduling
- [ ] Multi-language support

## Support

For issues or questions:
- GitHub Issues: https://github.com/your-repo/issues
- Documentation: https://github.com/your-repo/docs
- Email: support@stellarportfolio.com
