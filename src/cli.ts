#!/usr/bin/env node

const USAGE = "Usage: encounter-detection [--help]";

function main(args: readonly string[]): number {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  process.stderr.write(`${USAGE}\n`);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
