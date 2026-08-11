import { z } from 'zod';
import type { DB } from './db';

export class ToolError extends Error {
  constructor(
    public readonly type: string,
    public readonly path?: string[],
    message?: string
  ) {
    super(message ?? type);
  }
}

/**
 * Key names only -- never values. Tool args carry question stems and studentReasoning, and pm2
 * logs are plaintext on the VPS.
 */
export function argKeys(args: unknown): string {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return '';
  return Object.keys(args as Record<string, unknown>).join(',');
}

/**
 * Best-effort persistence of a tool dispatch failure. Never throws: a logging failure must not
 * turn a handled tool error into an unhandled request error.
 */
export function recordToolError(db: DB, tool: string, message: string, args: unknown): void {
  try {
    db.prepare('INSERT INTO tool_errors (tool, message, arg_keys) VALUES (?, ?, ?)').run(
      tool,
      message,
      argKeys(args)
    );
  } catch {
    // Table absent on an older db, or the db is read-only. Nothing to do.
  }
}

export interface SanitizedToolError {
  logMessage: string;
  responseMessage: string;
}

/**
 * Sanitizes an error before it reaches logs, the tool_errors table, or the caller.
 *
 * - ZodValidation: only path and code, never the received value.
 * - ToolError: the classified type and optional path.
 * - Plain Error messages are redacted if they contain any top-level arg value.
 *
 * The detailed message is returned to the caller only when it cannot contain arg values.
 */
export function sanitizeToolError(error: unknown, tool: string, args: unknown): SanitizedToolError {
  if (error instanceof z.ZodError) {
    const issues = error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}:${issue.code}`)
      .join(', ');
    return {
      logMessage: `ZodValidation: ${issues}`,
      responseMessage: `Invalid arguments for ${tool}`,
    };
  }

  if (error instanceof ToolError) {
    const log = error.path ? `${error.type}: ${error.path.join('.')}` : error.type;
    return {
      logMessage: log,
      responseMessage: `Invalid arguments for ${tool}`,
    };
  }

  if (error instanceof SyntaxError) {
    return {
      logMessage: 'MalformedRequest: invalid JSON',
      responseMessage: 'Invalid request',
    };
  }

  if (error instanceof Error) {
    if (error.message.startsWith('Unknown categoryId:')) {
      return {
        logMessage: 'UnknownCategory: categoryId',
        responseMessage: `Invalid arguments for ${tool}`,
      };
    }
    if (error.message.startsWith('Unknown tool:')) {
      return {
        logMessage: error.message,
        responseMessage: error.message,
      };
    }
    if (containsArgValue(error.message, args)) {
      return {
        logMessage: `${error.name}: message redacted because it contained an argument value`,
        responseMessage: `An error occurred in ${tool}`,
      };
    }
    return {
      logMessage: `${error.name}: ${error.message}`,
      responseMessage: error.message,
    };
  }

  return {
    logMessage: 'UnknownError',
    responseMessage: 'An unexpected error occurred',
  };
}

function containsArgValue(message: string, args: unknown): boolean {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return false;
  for (const value of Object.values(args as Record<string, unknown>)) {
    if (typeof value === 'string' && value && message.includes(value)) return true;
    if (typeof value === 'number' && message.includes(String(value))) return true;
    if (typeof value === 'boolean' && message.includes(String(value))) return true;
    if (typeof value === 'object' && value !== null) {
      const nested = JSON.stringify(value);
      if (nested && message.includes(nested)) return true;
    }
  }
  return false;
}
