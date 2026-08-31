# Notification System Documentation

## Overview

The Stellar Portfolio Rebalancer includes a comprehensive notification system that alerts users about important portfolio events via email, webhooks, Slack, and SMS.

## Features

- **Email Notifications**: Send alerts via SMTP (Gmail, SendGrid, Mailgun, AWS SES, etc.)
- **Webhook Notifications**: POST JSON payloads to custom endpoints
- **Slack Notifications**: Send alerts to Slack channels via incoming webhooks
- **SMS Notifications**: Send text message alerts via Twilio
- **Event Filtering**: Subscribe to specific event types
- **User Preferences**: Per-user notification configuration
- **Configurable backoff**: Provider-specific retry timing for email, webhooks, Slack, and SMS (max attempts, initial delay, exponential multiplier, cap)
- **Delivery logs**: Each attempt records status (`sent`, `retried`, `failed`, `skipped`) with optional `attempt_number` and `backoff_delay_ms`
- **Non-blocking**: Notification failures don't affect core operations

## Delivery backoff configuration

Retry behavior is loaded at startup from environment variables (validated in `startupConfig`) and applied in `notificationService` via `deliverWithBackoff`.

| Variable | Provider | Default | Description |
|----------|----------|---------|-------------|
| `WEBHOOK_TIMEOUT` | Webhook | `5000` | HTTP request timeout (ms) |
| `WEBHOOK_RETRY_COUNT` | Webhook | `1` | Retries after the first failure (total attempts = `1 + WEBHOOK_RETRY_COUNT`) |
| `WEBHOOK_RETRY_DELAY` | Webhook | `1000` | Initial backoff before the first webhook retry (ms) |
| `WEBHOOK_MAX_BACKOFF_MS` | Webhook | `60000` | Maximum delay between webhook retries (ms) |
| `WEBHOOK_BACKOFF_MULTIPLIER` | Webhook | `2` | Exponential multiplier per retry |
| `EMAIL_MAX_ATTEMPTS` | Email | `3` | Total SMTP send attempts (including the first try) |
| `EMAIL_INITIAL_BACKOFF_MS` | Email | `1000` | Initial backoff before the first email retry (ms) |
| `EMAIL_MAX_BACKOFF_MS` | Email | `30000` | Maximum delay between email retries (ms) |
| `EMAIL_BACKOFF_MULTIPLIER` | Email | `2` | Exponential multiplier per retry |
| `SLACK_TIMEOUT_MS` | Slack | `5000` | HTTP request timeout (ms) |
| `SLACK_RETRY_COUNT` | Slack | `1` | Retries after the first failure |
| `SLACK_RETRY_DELAY_MS` | Slack | `1000` | Initial backoff before the first Slack retry (ms) |
| `SLACK_MAX_BACKOFF_MS` | Slack | `60000` | Maximum delay between Slack retries (ms) |
| `SLACK_BACKOFF_MULTIPLIER` | Slack | `2` | Exponential multiplier per retry |
| `SMS_RETRY_COUNT` | SMS | `1` | Retries after the first failure |
| `SMS_RETRY_DELAY_MS` | SMS | `1000` | Initial backoff before the first SMS retry (ms) |
| `SMS_MAX_BACKOFF_MS` | SMS | `60000` | Maximum delay between SMS retries (ms) |
| `SMS_BACKOFF_MULTIPLIER` | SMS | `2` | Exponential multiplier per retry |

On each failed attempt (before the final failure), the service logs a `retried` row with the scheduled backoff delay. After all attempts are exhausted, a `failed` row is written and an error is logged with `maxAttempts` and the last error message.

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

## Slack Configuration

> **Implementation module:** `backend/src/notifications/slack.ts`  
> Slack notifications are delivered via a Slack App with an **Incoming Webhook** integration. Each user can configure their own Slack webhook URL to receive notifications in the channel of their choice.

### Slack Setup

1. **Create a Slack App**
   - Go to https://api.slack.com/apps
   - Click "Create New App" → "From scratch"
   - Name your app (e.g., "Stellar Portfolio Rebalancer") and select your workspace

2. **Enable Incoming Webhooks**
   - In your app's sidebar, navigate to "Incoming Webhooks"
   - Toggle "Activate Incoming Webhooks" to **On**
   - Click "Add New Webhook to Workspace"
   - Select the channel where notifications should be posted
   - Copy the generated webhook URL (starts with `https://hooks.slack.com/services/`)

3. **Configure Environment Variables**
   ```env
   SLACK_ENABLED=true
   SLACK_DEFAULT_WEBHOOK_URL=<your-slack-incoming-webhook-url>
   SLACK_TIMEOUT_MS=5000
   SLACK_RETRY_COUNT=1
   SLACK_RETRY_DELAY_MS=1000
   SLACK_MAX_BACKOFF_MS=60000
   SLACK_BACKOFF_MULTIPLIER=2
   ```

### Per-User Configuration

Users can override the default webhook URL with their own Slack channel webhook via the subscribe endpoint:

```http
POST /api/notifications/subscribe
Content-Type: application/json

{
  "userId": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "slackEnabled": true,
  "slackWebhookUrl": "<your-slack-incoming-webhook-url>",
  "events": {
    "rebalance": true,
    "circuitBreaker": true,
    "priceMovement": true,
    "riskChange": true
  }
}
```

**Important:** The `slackWebhookUrl` must:
- Start with `https://hooks.slack.com/services/`
- Be a valid, active incoming webhook URL
- Point to a channel the Slack App has permission to post to

### Slack Message Format

Notifications are sent as richly formatted Slack messages using Block Kit:

```json
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "🔄 Portfolio Rebalanced"
      }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Portfolio:*\nportfolio-123" },
        { "type": "mrkdwn", "text": "*Trades:*\n3" },
        { "type": "mrkdwn", "text": "*Gas Used:*\n0.0234 XLM" },
        { "type": "mrkdwn", "text": "*Trigger:*\nautomatic" }
      ]
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "Stellar Portfolio Rebalancer | 2024-02-20T10:30:00.000Z" }
      ]
    }
  ]
}
```

### Slack Delivery Backoff

| Variable | Default | Description |
|----------|---------|-------------|
| `SLACK_TIMEOUT_MS` | `5000` | HTTP request timeout (ms) |
| `SLACK_RETRY_COUNT` | `1` | Retries after the first failure (total = `1 + SLACK_RETRY_COUNT`) |
| `SLACK_RETRY_DELAY_MS` | `1000` | Initial backoff before the first retry (ms) |
| `SLACK_MAX_BACKOFF_MS` | `60000` | Maximum delay between retries (ms) |
| `SLACK_BACKOFF_MULTIPLIER` | `2` | Exponential multiplier per retry |

## SMS Configuration (Twilio)

> **Implementation module:** `backend/src/notifications/sms.ts`  
> SMS notifications are delivered via the **Twilio Programmable Messaging API**. Users must verify their phone number before receiving SMS alerts.

### Twilio Setup

1. **Create a Twilio Account**
   - Sign up at https://www.twilio.com
   - Verify your email and phone number

2. **Get a Twilio Phone Number**
   - Console → Phone Numbers → Manage → Buy a Number
   - Choose a number with SMS capabilities
   - Note: Trial accounts can only send to verified numbers

3. **Get API Credentials**
   - Console → Account → API keys & tokens
   - Copy your **Account SID** and **Auth Token**
   - For production, create a dedicated API Key instead of using the Auth Token

4. **Configure Environment Variables**
   ```env
   SMS_ENABLED=true
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your-auth-token-here
   TWILIO_PHONE_NUMBER=+15551234567
   SMS_RETRY_COUNT=1
   SMS_RETRY_DELAY_MS=1000
   SMS_MAX_BACKOFF_MS=60000
   SMS_BACKOFF_MULTIPLIER=2
   ```

### Phone Verification

Before a user can receive SMS notifications, their phone number must be verified:

1. **User submits phone number** via the subscribe endpoint:
   ```http
   POST /api/notifications/subscribe
   Content-Type: application/json

   {
     "userId": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
     "smsEnabled": true,
     "smsPhoneNumber": "+15559876543",
     "events": {
       "rebalance": true,
       "circuitBreaker": true,
       "priceMovement": true,
       "riskChange": true
     }
   }
   ```

2. **Verify via one-time code:** A verification code is sent via SMS. The user must confirm it:
   ```http
   POST /api/notifications/verify-phone
   Content-Type: application/json

   {
     "userId": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
     "phoneNumber": "+15559876543",
     "verificationCode": "123456"
   }
   ```

3. **Phone number requirements:**
   - Must be in E.164 format (e.g., `+15551234567`)
   - Must be capable of receiving SMS
   - Twilio trial accounts: only verified numbers in your Twilio console can receive messages

### SMS Message Format

SMS messages are plain text, kept concise to fit within the 160-character limit (longer messages are automatically concatenated):

```
[Stellar RB] Portfolio Rebalanced
3 trades | 0.0234 XLM gas | automatic trigger
View: https://app.stellarportfolio.com/portfolio-123
```

### SMS Delivery Backoff

| Variable | Default | Description |
|----------|---------|-------------|
| `SMS_RETRY_COUNT` | `1` | Retries after the first failure (total = `1 + SMS_RETRY_COUNT`) |
| `SMS_RETRY_DELAY_MS` | `1000` | Initial backoff before the first retry (ms) |
| `SMS_MAX_BACKOFF_MS` | `60000` | Maximum delay between retries (ms) |
| `SMS_BACKOFF_MULTIPLIER` | `2` | Exponential multiplier per retry |

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
  "slackEnabled": true,
  "slackWebhookUrl": "<your-slack-incoming-webhook-url>",
  "smsEnabled": true,
  "smsPhoneNumber": "+15559876543",
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
    "slackEnabled": true,
    "slackWebhookUrl": "<your-slack-incoming-webhook-url>",
    "smsEnabled": true,
    "smsPhoneNumber": "+15559876543",
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

### Dev-only Test Notification Delivery
```http
POST /api/v1/debug/notifications/test
Content-Type: application/json
X-Public-Key: G...
X-Message: <unix_ms_timestamp>
X-Signature: <base64_signature_of_message>

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
    "webhook": "https://your-domain.com/webhook",
    "slack": "<your-slack-incoming-webhook-url>",
    "sms": "+15559876543"
  },
  "eventType": "rebalance",
  "timestamp": "2024-02-20T10:30:00.000Z"
}
```

To test all event types locally, use the backend script:

```bash
cd backend
npm run test:notifications:dev
```

The script iterates through `rebalance`, `circuitBreaker`, `priceMovement`, and `riskChange` using safe sample payloads.

## Testing

### Test with webhook.site

Set `ENABLE_DEBUG_ROUTES=true` before running these steps locally.

1. **Create Test Webhook**
   - Go to https://webhook.site
   - Copy your unique URL

2. **Configure Notification Preferences**
   ```bash
   curl -X POST http://localhost:3001/api/v1/notifications/subscribe \
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
   curl -X POST http://localhost:3001/api/v1/debug/notifications/test \
     -H "Content-Type: application/json" \
     -H "X-Public-Key: G..." \
     -H "X-Message: <unix_ms_timestamp>" \
     -H "X-Signature: <base64_signature_of_message>" \
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
  curl -X POST http://localhost:3001/api/v1/notifications/subscribe \
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
   curl -X POST http://localhost:3001/api/v1/debug/notifications/test \
     -H "Content-Type: application/json" \
     -H "X-Public-Key: G..." \
     -H "X-Message: <unix_ms_timestamp>" \
     -H "X-Signature: <base64_signature_of_message>" \
     -d '{
       "userId": "YOUR_STELLAR_ADDRESS",
       "eventType": "rebalance"
     }'
   ```

4. **Check Your Inbox**
   - Verify email received
   - Check spam folder if not in inbox
   - Verify HTML formatting

### Test Slack Delivery

1. **Create a Slack App and webhook** (see [Slack Setup](#slack-setup))

2. **Subscribe with Slack**
   ```bash
   curl -X POST http://localhost:3001/api/v1/notifications/subscribe \
     -H "Content-Type: application/json" \
     -d '{
       "userId": "YOUR_STELLAR_ADDRESS",
       "emailEnabled": false,
       "emailAddress": "",
       "webhookEnabled": false,
       "webhookUrl": "",
       "slackEnabled": true,
       "slackWebhookUrl": "<your-slack-incoming-webhook-url>",
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
   curl -X POST http://localhost:3001/api/v1/debug/notifications/test \
     -H "Content-Type: application/json" \
     -H "X-Public-Key: G..." \
     -H "X-Message: <unix_ms_timestamp>" \
     -H "X-Signature: <base64_signature_of_message>" \
     -d '{
       "userId": "YOUR_STELLAR_ADDRESS",
       "eventType": "rebalance"
     }'
   ```

4. **Check the Slack Channel**
   - Verify the message appears in the target channel
   - Check the message formatting (header, fields, timestamp)
   - If not received within 10 seconds, check backend logs for `slack` provider entries

### Test SMS Delivery

1. **Set up Twilio** (see [Twilio Setup](#twilio-setup))

2. **Subscribe with SMS**
   ```bash
   curl -X POST http://localhost:3001/api/v1/notifications/subscribe \
     -H "Content-Type: application/json" \
     -d '{
       "userId": "YOUR_STELLAR_ADDRESS",
       "emailEnabled": false,
       "emailAddress": "",
       "webhookEnabled": false,
       "webhookUrl": "",
       "smsEnabled": true,
       "smsPhoneNumber": "+15559876543",
       "events": {
         "rebalance": true,
         "circuitBreaker": true,
         "priceMovement": true,
         "riskChange": true
       }
     }'
   ```

3. **Verify the phone number** using the verification code sent via SMS (see [Phone Verification](#phone-verification))

4. **Send Test Notification**
   ```bash
   curl -X POST http://localhost:3001/api/v1/debug/notifications/test \
     -H "Content-Type: application/json" \
     -H "X-Public-Key: G..." \
     -H "X-Message: <unix_ms_timestamp>" \
     -H "X-Signature: <base64_signature_of_message>" \
     -d '{
       "userId": "YOUR_STELLAR_ADDRESS",
       "eventType": "rebalance"
     }'
   ```

5. **Check the Phone**
   - Verify SMS received within ~30 seconds
   - Confirm the message is concise and readable
   - Check the Twilio console (Monitor → Messaging → Logs) for delivery status

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
5. Test with `/api/v1/debug/notifications/test` endpoint (requires debug routes enabled and admin headers)

### Slack Delivery Failures

**Problem**: Slack notifications not appearing in channel

**Solutions**:
1. Verify the webhook URL is valid and starts with `https://hooks.slack.com/services/`
2. Check that the Slack App is still installed in the workspace (https://api.slack.com/apps → Your App → Install App)
3. Confirm the webhook hasn't been revoked or regenerated (Slack regenerates the URL when you reinstall the app)
4. Verify the channel still exists and the app has permission to post to it
5. Check backend logs for HTTP error responses from Slack's API (look for `slack` provider entries)

**Problem**: Slack returns `invalid_token` or `channel_not_found`

**Solutions**:
1. Regenerate the incoming webhook URL by reinstalling the Slack App
2. Ensure the target channel is not archived or deleted
3. If using a private channel, verify the Slack App has been explicitly invited to it

**Problem**: Slack rate limiting (`429 Too Many Requests`)

**Solutions**:
1. Slack allows ~1 message per second per channel. If you have many portfolios, aggregate notifications into fewer messages
2. The built-in exponential backoff (`SLACK_BACKOFF_MULTIPLIER=2`) will automatically retry with increasing delays
3. Consider using a dedicated notification channel to avoid rate limit contention with other integrations

### SMS Delivery Failures

**Problem**: SMS not being delivered to phone

**Solutions**:
1. Verify the phone number is in E.164 format (e.g., `+15551234567`)
2. Confirm the phone number has been verified (check verification status via `GET /api/notifications/preferences`)
3. Check that `SMS_ENABLED=true` is set in environment variables
4. Verify Twilio credentials: confirm `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are correct
5. Check the Twilio console (https://console.twilio.com) for message logs and error details
6. Twilio trial accounts can only send to verified numbers — upgrade to a paid account for unrestricted delivery

**Problem**: Twilio returns error `21603` ("A 'From' phone number is required") or `21211` ("Invalid 'To' phone number")

**Solutions**:
1. Ensure `TWILIO_PHONE_NUMBER` is set to a valid Twilio number with SMS capabilities
2. Verify the destination number is in valid E.164 format
3. Check that the destination number is not on a do-not-call list or blocked by carrier

**Problem**: Twilio error `30008` ("Unknown destination handset") or message stuck in "queued" status

**Solutions**:
1. The destination number may be a landline or VoIP number that can't receive SMS
2. Check for carrier filtering — some carriers block application-to-person (A2P) SMS
3. Register your Twilio phone number for A2P 10DLC (US/Canada) to improve deliverability
4. Verify the phone is in service and has signal

**Problem**: High SMS costs or unexpected charges

**Solutions**:
1. Review Twilio's per-segment pricing at https://www.twilio.com/sms/pricing
2. SMS messages are kept concise to minimize segments (long messages may use 2+ segments)
3. Disable SMS for high-frequency event types (e.g., `priceMovement`) and reserve it for critical alerts only
4. Monitor usage in the Twilio console → Monitor → Usage

## Security Considerations

1. **Debug test surface isolation**
  - `/api/v1/debug/*` routes are intended for local development and are blocked unless `ENABLE_DEBUG_ROUTES=true`
  - Keep `ENABLE_DEBUG_ROUTES=false` in production

2. **SMTP Credentials**
   - Never commit .env files with real credentials
   - Use app passwords, not regular passwords
   - Rotate credentials regularly

3. **Webhook URLs**
   - Use HTTPS in production
   - Validate webhook URLs before saving
   - Implement webhook signature verification (future enhancement)

4. **Slack Webhook URLs**
   - Never commit Slack webhook URLs to version control
   - Webhook URLs grant write access to a specific channel — treat them like passwords
   - Rotate webhook URLs if they are ever leaked (reinstall the Slack App to regenerate)
   - Validate Slack webhook URLs before saving (must start with `https://hooks.slack.com/services/`)

4. **Twilio Credentials**
   - Store `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` securely — never commit to version control
   - Use Twilio API Keys instead of the Auth Token for production deployments
   - Monitor Twilio usage regularly to detect unauthorized access
   - Enable two-factor authentication on your Twilio account

5. **Phone Number Privacy**
   - Phone numbers are stored encrypted at rest
   - Users must verify ownership before SMS delivery is enabled
   - Phone numbers are never shared with third parties

6. **Rate Limiting**
   - Notification endpoints are rate-limited
   - Maximum 10 notifications per hour per user
   - Prevents spam and abuse

7. **Data Privacy**
   - Email addresses are stored securely
   - Webhook URLs are validated
   - User data is not shared with third parties

## Future Enhancements

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
