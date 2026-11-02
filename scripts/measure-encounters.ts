// Diagnostic measurement of encounter detection (spec 002, T08/T09).
// Usage: node dist/scripts/measure-encounters.js [--list] <dataset> [...datasets]
// `--list` prints every encounter found. With `node --expose-gc`, heap is also
// sampled after garbage collection; timings in that mode are not representative.

import { performance } from "node:perf_hooks";

import { readDataset } from "../src/dataset/read-dataset.js";
import { detectEncounters } from "../src/encounters/detect.js";
import type { Encounter, EncounterType } from "../src/encounters/types.js";

const SAMPLE_EVERY_GROUPS = 1000;
const MIB = 1024 * 1024;

const gc = (globalThis as { gc?: () => void }).gc;

async function measure(path: string, list: boolean) {
  gc?.();
  let peakHeap = process.memoryUsage().heapUsed;
  let peakRetainedHeap = 0;
  let records = 0;
  let groups = 0;
  let distances = 0;
  let detectionMs = 0;
  const byType: Record<EncounterType, number> = { generico: 0, faccao: 0, protetiva: 0 };
  const found: Encounter[] = [];

  const start = performance.now();
  for await (const group of readDataset(path)) {
    const n = group.records.length;
    groups++;
    records += n;
    distances += (n * (n - 1)) / 2;

    const detectionStart = performance.now();
    const encounters = detectEncounters(group);
    detectionMs += performance.now() - detectionStart;

    for (const encounter of encounters) {
      byType[encounter.type]++;
      if (list) found.push(encounter);
    }
    if (groups % SAMPLE_EVERY_GROUPS === 0) {
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
      if (gc) {
        gc();
        peakRetainedHeap = Math.max(peakRetainedHeap, process.memoryUsage().heapUsed);
      }
    }
  }
  const totalMs = performance.now() - start;
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);

  const result = {
    file: path,
    records,
    groups,
    distances,
    encounters: byType.generico + byType.faccao + byType.protetiva,
    byType,
    totalSeconds: +(totalMs / 1000).toFixed(3),
    detectionSeconds: +(detectionMs / 1000).toFixed(3),
    readingAndOverheadSeconds: +((totalMs - detectionMs) / 1000).toFixed(3),
    distancesPerSecond: Math.round(distances / (detectionMs / 1000)),
    peakHeapMiB: +(peakHeap / MIB).toFixed(1),
    ...(gc ? { peakRetainedHeapMiB: +(peakRetainedHeap / MIB).toFixed(1) } : {}),
    maxRssMiB: +((process.resourceUsage().maxRSS * 1024) / MIB).toFixed(1),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  for (const e of found) {
    process.stdout.write(`  ${e.timestamp} ${e.first.id}-${e.second.id} ${e.type} ${e.distanceMeters}\n`);
  }
}

const args = process.argv.slice(2);
const list = args.includes("--list");
const paths = args.filter((arg) => arg !== "--list");
if (paths.length === 0) {
  process.stderr.write("Usage: node dist/scripts/measure-encounters.js [--list] <dataset> [...datasets]\n");
  process.exitCode = 1;
} else {
  for (const path of paths) await measure(path, list);
}
