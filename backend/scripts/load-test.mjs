#!/usr/bin/env node
/**
 * Load test script for backend performance testing
 * Makes concurrent HTTP requests to stress test the backend
 * Used with clinic.js doctor for memory profiling
 */

import http from 'http';

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const DURATION_MS = 5 * 60 * 1000; // 5 minutes
const CONCURRENT_REQUESTS = 10;
const REQUEST_INTERVAL_MS = 100; // Request every 100ms per worker

let totalRequests = 0;
let successfulRequests = 0;
let failedRequests = 0;
let startTime = Date.now();

// Parse URL safely
function parseUrl(urlString) {
  try {
    const url = new URL(urlString);
    return {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      protocol: url.protocol,
    };
  } catch (error) {
    console.error(`Invalid URL: ${urlString}`);
    process.exit(1);
  }
}

// Make a simple health check request
function makeRequest() {
  return new Promise((resolve) => {
    try {
      const urlInfo = parseUrl(BASE_URL);
      const options = {
        hostname: urlInfo.hostname,
        port: urlInfo.port,
        path: '/api/health',
        method: 'GET',
        timeout: 5000,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          totalRequests++;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            successfulRequests++;
          } else {
            failedRequests++;
          }
          resolve({ success: res.statusCode < 400, statusCode: res.statusCode });
        });
      });

      req.on('error', (error) => {
        totalRequests++;
        failedRequests++;
        console.error(`Request error: ${error.message}`);
        resolve({ success: false, error: error.message });
      });

      req.on('timeout', () => {
        totalRequests++;
        failedRequests++;
        req.destroy();
        resolve({ success: false, error: 'timeout' });
      });

      req.end();
    } catch (error) {
      totalRequests++;
      failedRequests++;
      console.error(`Request failed: ${error.message}`);
      resolve({ success: false, error: error.message });
    }
  });
}

// Wait before starting (allow backend to initialize)
async function waitForBackendReady(maxRetries = 30) {
  console.log(`Waiting for backend at ${BASE_URL}...`);
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await makeRequest();
      if (result.success) {
        console.log('✓ Backend is ready');
        return;
      }
    } catch (error) {
      // Continue retrying
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.warn('⚠ Backend may not be ready, proceeding anyway');
}

// Load test worker
async function loadTestWorker(workerId) {
  while (Date.now() - startTime < DURATION_MS) {
    await makeRequest();
    await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
  }
  console.log(`Worker ${workerId} completed`);
}

// Run the load test
async function runLoadTest() {
  console.log('Starting load test...');
  console.log(`Duration: 5 minutes`);
  console.log(`Concurrent workers: ${CONCURRENT_REQUESTS}`);
  console.log(`Target: ${BASE_URL}/api/health`);
  console.log('');

  await waitForBackendReady();

  startTime = Date.now();
  const workers = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
    loadTestWorker(i)
  );

  // Print progress every 30 seconds
  const progressInterval = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const rps = (totalRequests / (elapsedSeconds || 1)).toFixed(2);
    console.log(
      `[${elapsedSeconds}s] Requests: ${totalRequests} | RPS: ${rps} | Success: ${successfulRequests} | Failed: ${failedRequests}`
    );
  }, 30000);

  await Promise.all(workers);
  clearInterval(progressInterval);

  const totalTime = (Date.now() - startTime) / 1000;
  const finalRps = (totalRequests / totalTime).toFixed(2);

  console.log('\n=== Load Test Complete ===');
  console.log(`Total Time: ${totalTime.toFixed(2)}s`);
  console.log(`Total Requests: ${totalRequests}`);
  console.log(`Successful: ${successfulRequests}`);
  console.log(`Failed: ${failedRequests}`);
  console.log(`Average RPS: ${finalRps}`);
  console.log('==========================\n');
}

runLoadTest().catch((error) => {
  console.error('Load test failed:', error);
  process.exit(1);
});
