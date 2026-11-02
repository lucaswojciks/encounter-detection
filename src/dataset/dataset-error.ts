export interface DatasetErrorLocation {
  readonly source?: string | undefined;
  readonly lineNumber?: number | undefined;
  readonly field?: string | undefined;
}

/**
 * Input error with the file, line and field where it was found.
 * The message follows `<source>:<line>: field "<field>": <reason>`, omitting
 * the parts that are not known.
 */
export class DatasetError extends Error {
  readonly source: string | undefined;
  readonly lineNumber: number | undefined;
  readonly field: string | undefined;
  readonly reason: string;

  constructor(reason: string, location: DatasetErrorLocation = {}, options?: ErrorOptions) {
    super(formatMessage(reason, location), options);
    this.name = "DatasetError";
    this.source = location.source;
    this.lineNumber = location.lineNumber;
    this.field = location.field;
    this.reason = reason;
  }
}

function formatMessage(reason: string, { source, lineNumber, field }: DatasetErrorLocation): string {
  let prefix = source ?? "";
  if (lineNumber !== undefined) {
    prefix += `${prefix === "" ? "line " : ":"}${lineNumber}`;
  }
  const parts: string[] = [];
  if (prefix !== "") parts.push(prefix);
  if (field !== undefined) parts.push(`field "${field}"`);
  parts.push(reason);
  return parts.join(": ");
}
