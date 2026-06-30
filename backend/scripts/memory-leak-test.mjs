#!/usr/bin/env node
/**
 * Test script to verify memory leak detection
 * Simulates a memory leak using setTimeout refs to trigger heap growth
 * Used to verify that the performance test can detect memory leaks
 */

import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Simulated data store that grows indefinitely (memory leak)
const leakedData = [];

// Endpoint that triggers the memory leak
app.get('/api/health', (req, res) => {
  // Create memory leak: store data in setTimeout closure
  // This keeps references alive beyond the request lifecycle
  const data = new Array(1024 * 100).fill('data'); // ~100KB per request
  leakedData.push(data);

  setTimeout(() => {
    // This keeps the closure alive
    console.log(`Leaked data count: ${leakedData.length}`);
  }, 30000); // Hold for 30 seconds

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    leakCount: leakedData.length,
  });
});

// Endpoint for metrics
app.get('/api/metrics', (req, res) => {
  const memUsage = process.memoryUsage();
  res.json({
    heapUsed: memUsage.heapUsed,
    heapTotal: memUsage.heapTotal,
    external: memUsage.external,
    leakedDataSize: leakedData.length,
  });
});

app.listen(PORT, () => {
  console.log(`🔴 Memory leak test server running on port ${PORT}`);
  console.log('This server intentionally leaks memory via setTimeout refs');
  console.log('Use with: clinic doctor -- npm run test:memory-leak');
});
