import { stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { readDataset } from "./dataset/read-dataset.js";
import type { TimestampGroup } from "./dataset/types.js";
import { detectDatasetEncounters } from "./encounters/detect-stream.js";
import { latitudeSweep } from "./encounters/latitude-sweep.js";
import { type OutputEncounter, toOutputEncounter } from "./encounters/output.js";
import type { PairSearch } from "./encounters/pair-search.js";
import type { EncounterType } from "./encounters/types.js";
import { writeJsonArray } from "./output/json-writer.js";

export interface ProcessDatasetOptions {
  readonly input: string;
  readonly output: string;
  /** Pair search strategy; `latitudeSweep` by default. */
  readonly search?: PairSearch;
  /** Aborting stops the processing before the next timestamp group. */
  readonly signal?: AbortSignal;
}

export interface ProcessDatasetResult {
  readonly records: number;
  readonly timestamps: number;
  readonly encounters: number;
  readonly byType: Readonly<Record<EncounterType, number>>;
  readonly durationMs: number;
}

/**
 * Publishing the output replaces the file at `output`; when it is the input
 * itself (under any spelling of the path, or a link to it), the dataset would
 * be lost.
 */
async function assertOutputIsNotInput(input: string, output: string): Promise<void> {
  const [inputStats, outputStats] = await Promise.all(
    [input, output].map((path) => stat(path, { bigint: true }).catch(() => undefined)),
  );
  if (
    inputStats !== undefined &&
    outputStats !== undefined &&
    inputStats.dev === outputStats.dev &&
    inputStats.ino === outputStats.ino
  ) {
    throw new Error(`output ${output} is the input dataset ${input}; choose another output path`);
  }
}

/** Reads a dataset, detects its encounters and writes them as the output JSON file. */
export async function processDataset(options: ProcessDatasetOptions): Promise<ProcessDatasetResult> {
  const { input, output, search = latitudeSweep, signal } = options;
  const start = performance.now();
  await assertOutputIsNotInput(input, output);
  let records = 0;
  let timestamps = 0;
  const byType: Record<EncounterType, number> = { generico: 0, faccao: 0, protetiva: 0 };

  async function* countedGroups(): AsyncGenerator<TimestampGroup, void, undefined> {
    for await (const group of readDataset(input)) {
      signal?.throwIfAborted();
      timestamps++;
      records += group.records.length;
      yield group;
    }
  }

  async function* outputEncounters(): AsyncGenerator<OutputEncounter, void, undefined> {
    for await (const encounter of detectDatasetEncounters(countedGroups(), search)) {
      byType[encounter.type]++;
      yield toOutputEncounter(encounter);
    }
  }

  const encounters = await writeJsonArray(outputEncounters(), output);
  return { records, timestamps, encounters, byType, durationMs: performance.now() - start };
}
