/**
 * Simple logger utility that wraps console methods
 * Avoids direct console usage which can interfere with MCP stdio
 */
const safeStringify = (value: unknown): string => {
  if (value instanceof Error) {
    return value.stack ?? value.message ?? String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const writeArgs = (prefix: string, args: unknown[]): void => {
  if (args.length === 0) {
    return;
  }

  process.stderr.write(`${prefix}${safeStringify(args)}\n`);
};

export const logger = {
  info(message: string, ...args: unknown[]): void {
    process.stderr.write(`[INFO] ${message}\n`);
    writeArgs('[INFO] extra: ', args);
  },

  error(message: string, error?: unknown): void {
    process.stderr.write(`[ERROR] ${message}\n`);
    if (error !== undefined) {
      process.stderr.write(`${safeStringify(error)}\n`);
    }
  },

  debug(message: string, ...args: unknown[]): void {
    process.stderr.write(`[DEBUG] ${message}\n`);
    writeArgs('[DEBUG] extra: ', args);
  },

  warn(message: string, ...args: unknown[]): void {
    process.stderr.write(`[WARN] ${message}\n`);
    writeArgs('[WARN] extra: ', args);
  },
};
