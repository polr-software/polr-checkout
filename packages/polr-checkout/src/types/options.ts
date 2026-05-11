import type { PolrDatabaseAdapter } from "../database/store";
import type { PolrProviderConfig } from "../providers/provider";
import type { ShippingResolver } from "../shipping/shipping";
import type { PolrEventHandlers, PolrHooks } from "./events";

export type PolrLogMethod = (first?: unknown, second?: string, ...rest: unknown[]) => void;

export interface PolrLogger {
  debug?: PolrLogMethod;
  error?: PolrLogMethod;
  info?: PolrLogMethod;
  trace?: PolrLogMethod;
  warn?: PolrLogMethod;
}

export interface PolrLoggingOptions {
  level?: "debug" | "error" | "info" | "silent" | "trace" | "warn";
  logger?: PolrLogger;
}

export interface PolrOptions {
  database: PolrDatabaseAdapter;
  provider: PolrProviderConfig;

  /**
   * Mount path for the polr handler, e.g. `/polr` or `/checkout`.
   * Webhook lands at `${basePath}/webhook` and HTTP API methods at
   * `${basePath}/api/...`.
   * @default "/polr"
   */
  basePath?: string;

  /** Default currency for new orders. Defaults to `PLN`. */
  currency?: string;

  /** Minimum total (in minor units) accepted by `createOrder`. */
  minOrderAmount?: number;

  /** Resolver used to attach shipping cost to orders with `mode: "delivery"`. */
  shipping?: ShippingResolver;

  /** Blocking hooks used for application fulfillment. Hook errors fail/retry the webhook. */
  hooks?: PolrHooks;

  /** Best-effort observers used for logging, analytics, or audit side effects. */
  events?: PolrEventHandlers;

  logging?: PolrLoggingOptions;
}

export type ExactOptions<TOptions extends PolrOptions> = TOptions &
  Record<Exclude<keyof TOptions, keyof PolrOptions>, never>;
