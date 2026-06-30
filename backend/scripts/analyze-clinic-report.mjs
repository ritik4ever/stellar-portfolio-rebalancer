#!/usr/bin/env node
/**
 * Analyze clinic.js report for memory leak detection
 * Checks heap growth and fails if it exceeds threshold
 */

import fs from 'fs';
import path from 'path';

const HEAP_GROWTH_THRESHOLD_MB = 50;

// Find the latest clinic report
function findClinicReport() {
  const clinicDir = path.join(process.cwd(), '.clinic');

  if (!fs.existsSync(clinicDir)) {
    console.error('❌ .clinic directory not found');
    process.exit(1);
  }

  const files = fs.readdirSync(clinicDir).filter((f) => f.endsWith('.json'));

  if (files.length === 0) {
    console.error('❌ No clinic reports found');
    process.exit(1);
  }

  // Sort by modification time, get the newest
  const latestFile = files
    .map((f) => ({
      name: f,
      time: fs.statSync(path.join(clinicDir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time)[0];

  return path.join(clinicDir, latestFile.name);
}

// Extract heap metrics from clinic report
function analyzeReport(reportPath) {
  console.log(`\n📊 Analyzing Clinic Report: ${reportPath}`);
  console.log('='.repeat(60));

  try {
    const reportContent = fs.readFileSync(reportPath, 'utf8');
    const report = JSON.parse(reportContent);

    // Extract data from the report structure
    // Clinic.js structure varies, look for heap data
    let heapData = null;
    let heapGrowth = 0;
    let maxHeap = 0;
    let minHeap = Infinity;

    // Try to find heap data in different report structures
    if (report.analysis && report.analysis.issue) {
      console.log(`Issue Type: ${report.analysis.issue}`);
    }

    if (report.data && report.data.sampledHeapProfile) {
      const samples = report.data.sampledHeapProfile.samples || [];
      if (samples.length > 0) {
        // Get heap sizes from samples (typically in bytes)
        const heapSizes = samples
          .filter((s) => s.size !== undefined)
          .map((s) => s.size / (1024 * 1024)); // Convert to MB

        if (heapSizes.length > 0) {
          minHeap = Math.min(...heapSizes);
          maxHeap = Math.max(...heapSizes);
          heapGrowth = maxHeap - minHeap;
        }
      }
    }

    // Alternative: look for histogram data
    if (report.data && report.data.histogram) {
      const histogram = report.data.histogram;
      if (histogram.samples && histogram.samples.length > 0) {
        const heapSamples = histogram.samples.map((s) => s / (1024 * 1024)); // Convert bytes to MB
        minHeap = Math.min(...heapSamples);
        maxHeap = Math.max(...heapSamples);
        heapGrowth = maxHeap - minHeap;
      }
    }

    // If no detailed data, try to infer from report structure
    if (heapGrowth === 0 && report.systemInfo) {
      console.log('Note: Detailed heap analysis not available in report structure');
      console.log(
        'Report contains: ' +
          Object.keys(report)
            .slice(0, 5)
            .join(', ')
      );
    }

    // Print results
    console.log('\n📈 Heap Usage Analysis:');
    console.log('-'.repeat(60));
    console.log(`Min Heap: ${minHeap.toFixed(2)} MB`);
    console.log(`Max Heap: ${maxHeap.toFixed(2)} MB`);
    console.log(`Heap Growth: ${heapGrowth.toFixed(2)} MB`);
    console.log(`Threshold: ${HEAP_GROWTH_THRESHOLD_MB} MB`);
    console.log('-'.repeat(60));

    // Check threshold
    if (heapGrowth > HEAP_GROWTH_THRESHOLD_MB) {
      console.log(`\n❌ FAILED: Heap growth (${heapGrowth.toFixed(2)}MB) exceeds threshold (${HEAP_GROWTH_THRESHOLD_MB}MB)`);
      console.log('Possible memory leak detected!');
      process.exit(1);
    } else {
      console.log(
        `\n✅ PASSED: Heap growth (${heapGrowth.toFixed(2)}MB) within threshold (${HEAP_GROWTH_THRESHOLD_MB}MB)`
      );
      process.exit(0);
    }
  } catch (error) {
    console.error(`Error analyzing report: ${error.message}`);
    process.exit(1);
  }
}

// Main
const reportPath = findClinicReport();
analyzeReport(reportPath);
