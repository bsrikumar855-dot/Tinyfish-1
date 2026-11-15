export type ErrorCode = "SITE_STRUCTURE_CHANGED" | "NOT_FOUND" | "RATE_LIMITED" | "TINYFISH_FAILED";

export class NptelError extends Error {
  constructor(public code: ErrorCode, message: string, public tool?: string, public field?: string) {
    super(message);
    this.name = "NptelError";
  }
  toJSON() {
    return { code: this.code, message: this.message, tool: this.tool ?? null, field: this.field ?? null };
  }
}

export function structureChanged(tool: string, field: string, detail: string): NptelError {
  return new NptelError(
    "SITE_STRUCTURE_CHANGED",
    `[${tool}] TinyFish result no longer matches the expected shape at field "${field}": ${detail}`,
    tool,
    field,
  );
}
