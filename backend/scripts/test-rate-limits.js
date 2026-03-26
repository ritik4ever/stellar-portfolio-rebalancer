#!/usr/bin/env node

/**
 * Rate Limiting Test Script
 * 
 * Tests various rate limiting scenarios to ensure proper functionality.
 * Run this against a running development server.
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:3001'

async function makeRequest(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`
    const config = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        ...options
    }
    
    try {
        const response = await fetch(url, config)
        const data = await response.json()
        return {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            data
        }
    } catch (error) {
        return {
            status: 0,
            error: error.message
        }
    }
}

async function testGlobalRateLimit() {
    console.log('\n🧪 Testing Global Rate Limit (100 requests/minute)...')
    
    const requests = []
    const startTime = Date.now()
    
    // Make 110 requests rapidly
    for (let i = 0; i < 110; i++) {
        requests.push(makeRequest('/api/assets'))
    }
    
    const results = await Promise.all(requests)
    const throttled = results.filter(r => r.status === 429)
    const successful = results.filter(r => r.status === 200)
    
    console.log(`✅ Successful requests: ${successful.length}`)
    console.log(`🚫 Throttled requests: ${throttled.length}`)
    console.log(`⏱️  Total time: ${Date.now() - startTime}ms`)
    
    if (throttled.length > 0) {
        const firstThrottle = throttled[0]
        console.log(`📋 Throttle response:`, {
            limitType: firstThrottle.data?.error?.details?.limitType,
            retryAfter: firstThrottle.headers['retry-after'],
            message: firstThrottle.data?.error?.message
        })
    }
}

async function testBurstProtection() {
    console.log('\n🧪 Testing Burst Protection (20 requests/10 seconds)...')
    
    const requests = []
    const startTime = Date.now()
    
    // Make 25 requests simultaneously
    for (let i = 0; i < 25; i++) {
        requests.push(makeRequest('/api/assets'))
    }
    
    const results = await Promise.all(requests)
    const throttled = results.filter(r => r.status === 429)
    const successful = results.filter(r => r.status === 200)
    
    console.log(`✅ Successful requests: ${successful.length}`)
    console.log(`🚫 Throttled requests: ${throttled.length}`)
    console.log(`⏱️  Total time: ${Date.now() - startTime}ms`)
    
    if (throttled.length > 0) {
        const burstThrottles = throttled.filter(r => 
            r.data?.error?.details?.limitType === 'burst-protection'
        )
        console.log(`💥 Burst protection triggered: ${burstThrottles.length} times`)
    }
}

async function testWriteRateLimit() {
    console.log('\n🧪 Testing Write Rate Limit (10 requests/minute)...')
    
    const requests = []
    
    // Make 15 POST requests
    for (let i = 0; i < 15; i++) {
        requests.push(makeRequest('/api/consent', {
            method: 'POST',
            body: JSON.stringify({
                userId: `test-user-${i}`,
                terms: true,
                privacy: true,
                cookies: true
            })
        }))
    }
    
    const results = await Promise.all(requests)
    const throttled = results.filter(r => r.status === 429)
    const successful = results.filter(r => r.status === 200 || r.status === 400) // 400 is expected for invalid data
    
    console.log(`✅ Processed requests: ${successful.length}`)
    console.log(`🚫 Throttled requests: ${throttled.length}`)
    
    if (throttled.length > 0) {
        const writeThrottles = throttled.filter(r => 
            r.data?.error?.details?.limitType?.includes('write')
        )
        console.log(`✍️  Write throttles: ${writeThrottles.length}`)
    }
}

async function testAuthRateLimit() {
    console.log('\n🧪 Testing Auth Rate Limit (5 requests/minute)...')
    
    const requests = []
    
    // Make 8 login attempts
    for (let i = 0; i < 8; i++) {
        requests.push(makeRequest('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                address: `GTEST${i}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
            })
        }))
    }
    
    const results = await Promise.all(requests)
    const throttled = results.filter(r => r.status === 429)
    const processed = results.filter(r => r.status !== 429)
    
    console.log(`✅ Processed requests: ${processed.length}`)
    console.log(`🚫 Throttled requests: ${throttled.length}`)
    
    if (throttled.length > 0) {
        const authThrottles = throttled.filter(r => 
            r.data?.error?.details?.limitType === 'authentication'
        )
        console.log(`🔐 Auth throttles: ${authThrottles.length}`)
    }
}

async function testHealthCheckExclusion() {
    console.log('\n🧪 Testing Health Check Exclusion...')
    
    const requests = []
    
    // Make many health check requests
    for (let i = 0; i < 50; i++) {
        requests.push(makeRequest('/health'))
    }
    
    const results = await Promise.all(requests)
    const throttled = results.filter(r => r.status === 429)
    const successful = results.filter(r => r.status === 200)
    
    console.log(`✅ Successful health checks: ${successful.length}`)
    console.log(`🚫 Throttled health checks: ${throttled.length}`)
    
    if (throttled.length === 0) {
        console.log(`✅ Health checks properly excluded from rate limiting`)
    } else {
        console.log(`❌ Health checks should not be rate limited!`)
    }
}

async function main() {
    console.log('🚀 Starting Rate Limiting Tests')
    console.log(`📍 Testing against: ${BASE_URL}`)
    
    try {
        // Test health endpoint first
        const health = await makeRequest('/health')
        if (health.status !== 200) {
            console.error('❌ Server not responding. Make sure the server is running.')
            process.exit(1)
        }
        console.log('✅ Server is responding')
        
        // Run all tests
        await testHealthCheckExclusion()
        await testBurstProtection()
        await testGlobalRateLimit()
        await testWriteRateLimit()
        await testAuthRateLimit()
        
        console.log('\n🎉 Rate limiting tests completed!')
        console.log('\n📊 To view detailed metrics, check: GET /api/admin/rate-limits/metrics')
        
    } catch (error) {
        console.error('❌ Test failed:', error.message)
        process.exit(1)
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main()
}

export { main as runRateLimitTests }