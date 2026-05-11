import type { PolrLogger, PolrLoggingOptions, PolrLogMethod } from "../types/options";

import { generateId } from "./utils";

const levels = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
} as const;

type LogLevel = keyof typeof levels;

export interface PolrInternalLogger extends Required<PolrLogger> {
  trace: PolrLogMethod & {
    run: <T>(prefix: string, fn: () => T | Promise<T>) => T | Promise<T>;
  };
}

export function getTraceId(): string | undefined {
  return undefined;
}

function isEnabled(current: LogLevel, target: LogLevel): boolean {
  return levels[current] >= levels[target] && current !== "silent";
}

function format(first: unknown, second?: string, rest: unknown[] = []): unknown[] {
  if (typeof second === "string") {
    return [second, first, ...rest];
  }
  return [first, ...rest].filter((entry) => entry !== undefined);
}

function createConsoleLogger(level: LogLevel): Required<PolrLogger> {
  return {
    debug: (...args) => {
      if (isEnabled(level, "debug"))
        console.debug(...format(args[0], args[1] as string, args.slice(2)));
    },
    error: (...args) => {
      if (isEnabled(level, "error"))
        console.error(...format(args[0], args[1] as string, args.slice(2)));
    },
    info: (...args) => {
      if (isEnabled(level, "info"))
        console.info(...format(args[0], args[1] as string, args.slice(2)));
    },
    trace: (...args) => {
      if (isEnabled(level, "trace"))
        console.debug(...format(args[0], args[1] as string, args.slice(2)));
    },
    warn: (...args) => {
      if (isEnabled(level, "warn"))
        console.warn(...format(args[0], args[1] as string, args.slice(2)));
    },
  };
}

function normalizeLogger(logger: PolrLogger | undefined, level: LogLevel): Required<PolrLogger> {
  const fallback = createConsoleLogger(level);
  return {
    debug: logger?.debug ?? fallback.debug,
    error: logger?.error ?? fallback.error,
    info: logger?.info ?? fallback.info,
    trace: logger?.trace ?? fallback.trace,
    warn: logger?.warn ?? fallback.warn,
  };
}

export function createPolrLogger(logging?: PolrLoggingOptions): PolrInternalLogger {
  const logger = normalizeLogger(logging?.logger, logging?.level ?? "info");
  const traceFn = ((...args: unknown[]) => logger.trace(...args)) as PolrInternalLogger["trace"];
  traceFn.run = <T>(prefix: string, fn: () => T | Promise<T>): T | Promise<T> => {
    logger.trace({ traceId: generateId(prefix, 12) }, "trace started");
    return fn();
  };

  return {
    ...logger,
    trace: traceFn,
  };
}
