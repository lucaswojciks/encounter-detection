#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { parseArguments, type SearchName, UsageError } from "./cli/arguments.js";
import { allPairs, type PairSearch } from "./encounters/pair-search.js";
import { spatialHash } from "./encounters/spatial-hash.js";
import { processDataset, type ProcessDatasetResult } from "./process-dataset.js";

const USAGE = `Usage: encounter-detection <dataset> [--output <file.json>] [--search spatial|all]

Detects encounters between monitored individuals in a dataset file and writes
them as a JSON array.

Options:
  -o, --output <file>   Output JSON file (default: outputs/encontros-<dataset>.json)
      --search <name>   Pair search: "spatial" (spatial hashing, default) or
                        "all" (brute force over every pair, for validation)
  -h, --help            Show this help

Exit codes: 0 success, 1 input/processing/output error, 2 invalid arguments,
130 interrupted.`;

const STRATEGIES: Record<SearchName, { readonly name: string; readonly search: PairSearch }> = {
  spatial: { name: "spatialHash", search: spatialHash },
  all: { name: "allPairs", search: allPairs },
};

const MIB = 1024 * 1024;

function summary(input: string, output: string, strategy: string, result: ProcessDatasetResult): string {
  const { generico, faccao, protetiva } = result.byType;
  const maxRssMiB = (process.resourceUsage().maxRSS * 1024) / MIB;
  return [
    `Dataset:    ${input}`,
    `Output:     ${output}`,
    `Search:     ${strategy}`,
    `Records:    ${result.records}`,
    `Timestamps: ${result.timestamps}`,
    `Encounters: ${result.encounters} (generico ${generico}, faccao ${faccao}, protetiva ${protetiva})`,
    `Duration:   ${(result.durationMs / 1000).toFixed(3)} s`,
    `Max RSS:    ${maxRssMiB.toFixed(1)} MiB`,
  ].join("\n");
}

async function main(argv: readonly string[]): Promise<number> {
  let args;
  try {
    args = parseArguments(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`error: ${error.message}\n\n${USAGE}\n`);
    return 2;
  }
  if (args.kind === "help") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const strategy = STRATEGIES[args.search];
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  try {
    await mkdir(dirname(args.output), { recursive: true });
    const result = await processDataset({
      input: args.input,
      output: args.output,
      search: strategy.search,
      signal: controller.signal,
    });
    process.stdout.write(`${summary(args.input, args.output, strategy.name, result)}\n`);
    return 0;
  } catch (error) {
    if (controller.signal.aborted) {
      process.stderr.write(`error: interrupted; ${args.output} was not written\n`);
      return 130;
    }
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write(`${args.output} was not written\n`);
    return 1;
  } finally {
    process.off("SIGINT", interrupt);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`error: unexpected failure: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  },
);
