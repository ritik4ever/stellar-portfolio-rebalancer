#!/usr/bin/env node

/**
 * Chaos / Load Test for WebSocket Portfolio Feed
 * Simulates large numbers of concurrent WebSocket subscriptions to portfolioFeed,
 * measuring connection acceptance latency, message delivery latency, and identifying
 * practical connection ceilings.
 */

import { WebSocket } from 'ws';
import os from 'os';

const TARGET_HOST = process.env.WS_HOST || 'localhost';
const TARGET_PORT = process.env.WS_PORT || '3001';
const WS_URL = process.env.WS_URL || `ws://${TARGET_HOST}:${TARGET_PORT}/ws/portfolio-feed`;

const CONCURRENT_CLIENTS = parseInt(process.env.CHAOS_CLIENTS || '50', 10);
const DURATION_SECONDS = parseInt(process.env.CHAOS_DURATION || '10', 10);
const PORTFOLIOS_PER_CLIENT = parseInt(process.env.CHAOS_PORTFOLIOS || '3', 10);
const VERBOSE = Boolean(process.env.CHAOS_VERBOSE);

function calculatePercentiles(latencies) {
  if (latencies.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const avg = sum / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(avg * 100) / 100,
    p50,
    p95,
    p99,
  };
}

async function runLoadTest() {
  console.log(`\n======================================================`);
  console.log(`WebSocket Portfolio Feed Load & Chaos Benchmark`);
  console.log(`Target URL: ${WS_URL}`);
  console.log(`Clients: ${CONCURRENT_CLIENTS} | Duration: ${DURATION_SECONDS}s | Portfolios/client: ${PORTFOLIOS_PER_CLIENT}`);
  console.log(`System: ${os.type()} ${os.arch()} | CPUs: ${os.cpus().length} | Free Mem: ${(os.freemem() / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`======================================================\n`);

  const connectionLatencies = [];
  const messageLatencies = [];
  let totalMessagesReceived = 0;
  let connectionErrors = 0;
  const sockets = [];

  console.log(`[+] Initiating ${CONCURRENT_CLIENTS} concurrent WebSocket connections...`);
  const startTime = Date.now();

  const clientPromises = Array.from({ length: CONCURRENT_CLIENTS }).map((_, i) => {
    return new Promise((resolve) => {
      const connectStart = Date.now();
      let ws;
      try {
        ws = new WebSocket(WS_URL);
        sockets.push(ws);
      } catch (err) {
        connectionErrors++;
        return resolve();
      }

      ws.on('open', () => {
        const connectTime = Date.now() - connectStart;
        connectionLatencies.push(connectTime);

        // Subscribe to simulated portfolio channels
        for (let p = 1; p <= PORTFOLIOS_PER_CLIENT; p++) {
          const portfolioId = ((i + p) % 100) + 1;
          ws.send(JSON.stringify({
            action: 'subscribe',
            channel: `portfolio:${portfolioId}`,
            timestamp: Date.now(),
          }));
        }

        if (VERBOSE && i % 10 === 0) {
          console.log(`    Client #${i} connected (${connectTime}ms)`);
        }
        resolve();
      });

      ws.on('message', (data) => {
        totalMessagesReceived++;
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.timestamp) {
            const transitLatency = Date.now() - parsed.timestamp;
            if (transitLatency >= 0) messageLatencies.push(transitLatency);
          }
        } catch {
          // Ignored non-JSON messages
        }
      });

      ws.on('error', (err) => {
        connectionErrors++;
        if (VERBOSE) {
          console.warn(`    Client #${i} socket error: ${err.message}`);
        }
        resolve();
      });
    });
  });

  await Promise.all(clientPromises);
  const connectionDuration = Date.now() - startTime;
  console.log(`[✓] Handshake completed in ${connectionDuration}ms`);

  console.log(`[+] Running sustained traffic load for ${DURATION_SECONDS} seconds...`);
  await new Promise((res) => setTimeout(res, DURATION_SECONDS * 1000));

  // Cleanup
  console.log(`[+] Closing connections...`);
  sockets.forEach((s) => {
    if (s.readyState === WebSocket.OPEN) s.close();
  });

  // Calculate Metrics
  const connStats = calculatePercentiles(connectionLatencies);
  const msgStats = calculatePercentiles(messageLatencies);
  const msgThroughput = (totalMessagesReceived / DURATION_SECONDS).toFixed(1);

  console.log(`\n================== LOAD TEST REPORT ==================`);
  console.log(`Successful Connections : ${connectionLatencies.length} / ${CONCURRENT_CLIENTS}`);
  console.log(`Connection Errors      : ${connectionErrors}`);
  console.log(`Total Messages Received: ${totalMessagesReceived} (${msgThroughput} msgs/sec)`);
  console.log(`\n--- Connection Handshake Latencies (ms) ---`);
  console.log(`Min: ${connStats.min}ms | Avg: ${connStats.avg}ms | p50: ${connStats.p50}ms | p95: ${connStats.p95}ms | p99: ${connStats.p99}ms | Max: ${connStats.max}ms`);
  
  if (messageLatencies.length > 0) {
    console.log(`\n--- Message Delivery Latencies (ms) ---`);
    console.log(`Min: ${msgStats.min}ms | Avg: ${msgStats.avg}ms | p50: ${msgStats.p50}ms | p95: ${msgStats.p95}ms | p99: ${msgStats.p99}ms | Max: ${msgStats.max}ms`);
  }

  const connectionCeiling = connectionErrors === 0 && connStats.p95 < 250
    ? `> ${CONCURRENT_CLIENTS} connections (Healthy headroom)`
    : `${Math.round(CONCURRENT_CLIENTS * 0.8)} connections (Saturated)`;

  console.log(`\nCapacity Assessment: Practical Connection Ceiling ~ ${connectionCeiling}`);
  console.log(`======================================================\n`);
}

runLoadTest().catch((err) => {
  console.error('Fatal load test error:', err);
  process.exit(1);
});
