import { createDatabase, type PolrStore } from "../database/index";
import type { PaymentProvider } from "../providers/provider";
import type { PolrOptions } from "../types/options";
import { createPolrLogger, type PolrInternalLogger } from "./logger";
import { assertValidPolrOptions } from "./validate-options";

export interface PolrContext {
  options: PolrOptions;
  basePath: string;
  store: PolrStore;
  provider: PaymentProvider;
  defaultCurrency: string;
  minOrderAmount: number;
  logger: PolrInternalLogger;
}

export async function createContext(options: PolrOptions): Promise<PolrContext> {
  assertValidPolrOptions(options);

  const store = createDatabase(options.database);
  const provider = options.provider.createAdapter();
  const basePath = options.basePath ?? "/polr";
  const defaultCurrency = options.currency ?? "PLN";
  const minOrderAmount = options.minOrderAmount ?? 0;

  return {
    options,
    basePath,
    store,
    provider,
    defaultCurrency,
    minOrderAmount,
    logger: createPolrLogger(options.logging),
  };
}
