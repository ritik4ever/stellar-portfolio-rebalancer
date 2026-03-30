import { Keypair } from '@stellar/stellar-sdk'

const ALL_EVENTS = ['rebalance', 'circuitBreaker', 'priceMovement', 'riskChange']

function parseArgs(argv) {
    const options = {
        baseUrl: 'http://localhost:3001',
        eventType: 'all',
        adminSecretKey: process.env.ADMIN_SECRET_KEY,
        userId: process.env.NOTIFY_TEST_USER_ID,
        emailAddress: process.env.NOTIFY_TEST_EMAIL,
        webhookUrl: process.env.NOTIFY_TEST_WEBHOOK,
    }

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i]
        const next = argv[i + 1]

        if ((arg === '--base-url' || arg === '-u') && next) {
            options.baseUrl = next
            i += 1
            continue
        }

        if ((arg === '--user-id' || arg === '-i') && next) {
            options.userId = next
            i += 1
            continue
        }

        if ((arg === '--event-type' || arg === '-e') && next) {
            if (next === 'all' || ALL_EVENTS.includes(next)) {
                options.eventType = next
            }
            i += 1
            continue
        }

        if ((arg === '--admin-secret-key' || arg === '-k') && next) {
            options.adminSecretKey = next
            i += 1
            continue
        }

        if (arg === '--email' && next) {
            options.emailAddress = next
            i += 1
            continue
        }

        if (arg === '--webhook' && next) {
            options.webhookUrl = next
            i += 1
            continue
        }
    }

    return options
}

function buildAdminHeaders(secretKey) {
    const keypair = Keypair.fromSecret(secretKey)
    const message = Date.now().toString()
    const signature = keypair.sign(Buffer.from(message, 'utf8')).toString('base64')

    return {
        'x-public-key': keypair.publicKey(),
        'x-message': message,
        'x-signature': signature,
    }
}

async function postJson(url, body, headers = {}) {
    return fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
        body: JSON.stringify(body),
    })
}

async function readJsonSafe(response) {
    try {
        return await response.json()
    } catch {
        return { raw: await response.text() }
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2))

    if (!options.adminSecretKey) {
        throw new Error('Missing admin secret key. Set ADMIN_SECRET_KEY or pass --admin-secret-key.')
    }

    const adminKeypair = Keypair.fromSecret(options.adminSecretKey)
    const userId = options.userId || adminKeypair.publicKey()
    const baseUrl = options.baseUrl.replace(/\/$/, '')

    const subscribeBody = {
        userId,
        emailEnabled: Boolean(options.emailAddress),
        emailAddress: options.emailAddress || '',
        webhookEnabled: Boolean(options.webhookUrl),
        webhookUrl: options.webhookUrl || '',
        events: {
            rebalance: true,
            circuitBreaker: true,
            priceMovement: true,
            riskChange: true,
        },
    }

    console.log('Preparing notification preferences...')
    const subscribeResponse = await postJson(`${baseUrl}/api/v1/notifications/subscribe`, subscribeBody, {
        'Idempotency-Key': `dev-notify-${Date.now()}`,
    })
    const subscribePayload = await readJsonSafe(subscribeResponse)

    if (!subscribeResponse.ok) {
        console.error('Failed to save notification preferences')
        console.error(subscribePayload)
        process.exit(1)
    }

    console.log('Preferences saved successfully')

    const eventsToRun = options.eventType === 'all' ? ALL_EVENTS : [options.eventType]
    let failures = 0

    for (const eventType of eventsToRun) {
        const headers = buildAdminHeaders(options.adminSecretKey)
        const testResponse = await postJson(`${baseUrl}/api/v1/debug/notifications/test`, { userId, eventType }, headers)
        const payload = await readJsonSafe(testResponse)

        if (testResponse.ok) {
            console.log(`PASS ${eventType}`)
        } else {
            failures += 1
            console.log(`FAIL ${eventType}`)
            console.log(payload)
        }
    }

    console.log('Fetching recent notification logs...')
    const logsResponse = await fetch(`${baseUrl}/api/v1/notifications/logs?userId=${encodeURIComponent(userId)}`)
    if (logsResponse.ok) {
        const logsPayload = await readJsonSafe(logsResponse)
        console.log('Notification logs:')
        console.log(JSON.stringify(logsPayload, null, 2))
    } else {
        const logsPayload = await readJsonSafe(logsResponse)
        console.log('Could not fetch logs (this can happen when JWT auth is enabled).')
        console.log(JSON.stringify(logsPayload, null, 2))
    }

    if (failures > 0) {
        process.exit(1)
    }

    console.log('Completed local notification simulation successfully.')
}

main().catch((error) => {
    console.error('Notification harness failed')
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
})
