import { createPolrRouter } from "../api/methods";
import {
  cancelOrder as cancelOrderService,
  createOrder as createOrderService,
  getOrder as getOrderService,
  listOrders as listOrdersService,
  resolveShipping as resolveShippingService,
  syncOrder as syncOrderService,
} from "../order/order.service";
import type { PolrInstance } from "../types/instance";
import type { ExactOptions, PolrOptions } from "../types/options";
import { createContext, type PolrContext } from "./context";

const polrInstanceSymbol = Symbol.for("polr.instance");

export function isPolrInstance(value: unknown): value is PolrInstance {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<PropertyKey, unknown>)[polrInstanceSymbol] === true
  );
}

async function initContext(options: PolrOptions): Promise<PolrContext> {
  return createContext(options);
}

export function createCheckout<const TOptions extends PolrOptions>(
  options: ExactOptions<TOptions>,
): PolrInstance<TOptions> {
  let contextPromise: Promise<PolrContext> | undefined;
  const getContext = () => {
    contextPromise ??= initContext(options);
    return contextPromise;
  };

  const checkout: PolrInstance<TOptions> = {
    options,

    async handler(request: Request) {
      const ctx = await getContext();
      const router = createPolrRouter(ctx);
      return router.handler(request);
    },

    async createOrder(input) {
      const ctx = await getContext();
      return createOrderService(ctx, input);
    },

    async getOrder(id) {
      const ctx = await getContext();
      return getOrderService(ctx, id);
    },

    async listOrders(input) {
      const ctx = await getContext();
      return listOrdersService(ctx, input);
    },

    async syncOrder(input) {
      const ctx = await getContext();
      return syncOrderService(ctx, input);
    },

    async cancelOrder(input) {
      const ctx = await getContext();
      return cancelOrderService(ctx, input);
    },

    async resolveShipping(input) {
      const ctx = await getContext();
      return resolveShippingService(ctx, input);
    },

    get $context() {
      return getContext();
    },
  };

  Object.defineProperty(checkout, polrInstanceSymbol, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return checkout;
}
