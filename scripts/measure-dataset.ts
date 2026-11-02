// Diagnostic measurement of dataset reading (spec 001, CA-10).
// Usage: node dist/scripts/measure-dataset.js <dataset> [...datasets]
// With `node --expose-gc`, heap is also sampled after garbage collection
// (retained memory); timings in that mode are not representative.

import { stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { readDataset } from "../src/dataset/read-dataset.js";

const SAMPLE_EVERY_GROUPS = 1000;
const MIB = 1024 * 1024;

const gc = (globalThis as { gc?: () => void }).gc;

async function measure(path: string) {
  const { size } = await stat(path);
  gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  let peakHeap = heapBefore;
  let peakRetainedHeap = 0;
  let records = 0;
  let groups = 0;
  let largestGroup = 0;

  const start = performance.now();
  for await (const group of readDataset(path)) {
    groups++;
    records += group.records.length;
    largestGroup = Math.max(largestGroup, group.records.length);
    if (groups % SAMPLE_EVERY_GROUPS === 0) {
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
      if (gc) {
        gc();
        peakRetainedHeap = Math.max(peakRetainedHeap, process.memoryUsage().heapUsed);
      }
    }
  }
  const seconds = (performance.now() - start) / 1000;
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);

  return {
    file: path,
    sizeMiB: +(size / MIB).toFixed(1),
    records,
    groups,
    largestGroup,
    seconds: +seconds.toFixed(3),
    recordsPerSecond: Math.round(records / seconds),
    heapBeforeMiB: +(heapBefore / MIB).toFixed(1),
    peakHeapMiB: +(peakHeap / MIB).toFixed(1),
    ...(gc ? { peakRetainedHeapMiB: +(peakRetainedHeap / MIB).toFixed(1) } : {}),
    maxRssMiB: +((process.resourceUsage().maxRSS * 1024) / MIB).toFixed(1),
  };
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  process.stderr.write("Usage: node dist/scripts/measure-dataset.js <dataset> [...datasets]\n");
  process.exitCode = 1;
} else {
  for (const path of paths) {
    process.stdout.write(`${JSON.stringify(await measure(path))}\n`);
  }
}
