import { basename, extname, join } from "node:path";
import { parseArgs } from "node:util";

export const SEARCH_NAMES = ["spatial", "all"] as const;
export type SearchName = (typeof SEARCH_NAMES)[number];

export type CliArguments =
  | { readonly kind: "help" }
  | { readonly kind: "run"; readonly input: string; readonly output: string; readonly search: SearchName };

/** Invalid command line; the CLI reports it with the usage text and exit code 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function defaultOutputPath(input: string): string {
  return join("outputs", `encontros-${basename(input, extname(input))}.json`);
}

export function parseArguments(argv: readonly string[]): CliArguments {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        output: { type: "string", short: "o" },
        search: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const { values, positionals } = parsed;
  if (values.help) return { kind: "help" };
  if (positionals.length === 0) throw new UsageError("missing dataset path");
  if (positionals.length > 1) throw new UsageError(`expected one dataset path, found ${positionals.length}`);

  const input = positionals[0] as string;
  const search = values.search ?? "spatial";
  if (!isSearchName(search)) {
    throw new UsageError(`invalid --search ${JSON.stringify(search)}; expected one of: ${SEARCH_NAMES.join(", ")}`);
  }
  if (values.output === "") throw new UsageError("--output must not be empty");

  return { kind: "run", input, output: values.output ?? defaultOutputPath(input), search };
}

function isSearchName(value: string): value is SearchName {
  return (SEARCH_NAMES as readonly string[]).includes(value);
}
