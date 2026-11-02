// Diagnostic measurement of encounter detection (spec 002 T08/T09, spec 003 T07).
// Usage: node dist/scripts/measure-encounters.js [--search all|spatial] [--count] [--list] <dataset> [...datasets]
// `--search` selects the pair search strategy (default: all).
// `--count` counts candidate pairs and haversine evaluations; it wraps the
// strategy, so its timings are not representative.
// `--list` prints every encounter found.
// With `node --expose-gc`, heap is also sampled after garbage collection;
// timings in that mode are not representative.

import { performance } from "node:perf_hooks";

import { readDataset } from "../src/dataset/read-dataset.js";
import { detectEncounters } from "../src/encounters/detect.js";
import { allPairs, type PairSearch } from "../src/encounters/pair-search.js";
import { spatialHash } from "../src/encounters/spatial-hash.js";
import type { Encounter, EncounterType } from "../src/encounters/types.js";

const SAMPLE_EVERY_GROUPS = 1000;
const MIB = 1024 * 1024;
const STRATEGIES: Record<string, PairSearch> = { all: allPairs, spatial: spatialHash };

const gc = (globalThis as { gc?: () => void }).gc;

interface Options {
  readonly searchName: string;
  readonly count: boolean;
  readonly list: boolean;
}

async function measure(path: string, options: Options) {
  const counters = { candidatePairs: 0, haversine: 0 };
  const strategy = STRATEGIES[options.searchName] as PairSearch;
  const search: PairSearch = options.count
    ? (records, visit) =>
        strategy(records, (a, b) => {
          counters.candidatePairs++;
          if (a.id !== b.id) counters.haversine++; // detectEncounters skips same-id pairs before the distance
          visit(a, b);
        })
    : strategy;

  gc?.();
  let peakHeap = process.memoryUsage().heapUsed;
  let peakRetainedHeap = 0;
  let records = 0;
  let groups = 0;
  let detectionMs = 0;
  const byType: Record<EncounterType, number> = { generico: 0, faccao: 0, protetiva: 0 };
  const found: Encounter[] = [];

  const start = performance.now();
  for await (const group of readDataset(path)) {
    groups++;
    records += group.records.length;

    const detectionStart = performance.now();
    const encounters = detectEncounters(group, search);
    detectionMs += performance.now() - detectionStart;

    for (const encounter of encounters) {
      byType[encounter.type]++;
      if (options.list) found.push(encounter);
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
    search: options.searchName,
    records,
    groups,
    encounters: byType.generico + byType.faccao + byType.protetiva,
    byType,
    ...(options.count ? counters : {}),
    totalSeconds: +(totalMs / 1000).toFixed(3),
    detectionSeconds: +(detectionMs / 1000).toFixed(3),
    readingAndOverheadSeconds: +((totalMs - detectionMs) / 1000).toFixed(3),
    peakHeapMiB: +(peakHeap / MIB).toFixed(1),
    ...(gc ? { peakRetainedHeapMiB: +(peakRetainedHeap / MIB).toFixed(1) } : {}),
    maxRssMiB: +((process.resourceUsage().maxRSS * 1024) / MIB).toFixed(1),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  for (const e of found) {
    process.stdout.write(`  ${e.timestamp} ${e.first.id}-${e.second.id} ${e.type} ${e.distanceMeters}\n`);
  }
}

function parseArgs(args: readonly string[]): { options: Options; paths: string[] } | undefined {
  let searchName = "all";
  let count = false;
  let list = false;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--count") count = true;
    else if (arg === "--list") list = true;
    else if (arg === "--search") {
      searchName = args[++i] ?? "";
      if (!(searchName in STRATEGIES)) return undefined;
    } else paths.push(arg);
  }
  return paths.length === 0 ? undefined : { options: { searchName, count, list }, paths };
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed === undefined) {
  process.stderr.write(
    "Usage: node dist/scripts/measure-encounters.js [--search all|spatial] [--count] [--list] <dataset> [...datasets]\n",
  );
  process.exitCode = 1;
} else {
  for (const path of parsed.paths) await measure(path, parsed.options);
}
