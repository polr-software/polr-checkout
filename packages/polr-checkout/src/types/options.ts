import type { Pool } from "pg";
import type { LevelWithSilent, Logger } from "pino";

import type { PolrProviderConfig } from "../providers/provider";
import type { ShippingResolver } from "../shipping/shipping";
import type { PolrEventHandlers } from "./events";

export interface PolrLoggingOptions {
  level?: LevelWithSilent;
  logger?: Logger;
}

export interface PolrOptions {
  database: Pool | string;
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

  on?: PolrEventHandlers;

  logging?: PolrLoggingOptions;
}

export type ExactOptions<TOptions extends PolrOptions> = TOptions &
  Record<Exclude<keyof TOptions, keyof PolrOptions>, never>;
