import { describe, expect, it, vi } from "vitest";

import type { PolrContext } from "../core/context";
import type { PolrInternalLogger } from "../core/logger";
import type { PolrStore, SetRefundStatusResult } from "../database/store";
import { createOrder } from "../order/order.service";
import type { PaymentProvider } from "../providers/provider";
import type { NewStoredOrder, StoredOrder, StoredRefund } from "../types/models";

class FakeStore implements PolrStore {
  orders = new Map<string, StoredOrder>();

  async createOrder(row: NewStoredOrder): Promise<StoredOrder> {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const stored: StoredOrder = {
      ...row,
      createdAt: now,
      error: null,
      expiresAt: null,
      items: row.items ?? [],
      metadata: row.metadata ?? {},
      paidAt: null,
      providerData: row.providerData ?? {},
      providerTransactionId: row.providerTransactionId ?? null,
      refundedAmount: row.refundedAmount ?? 0,
      returnUrl: row.returnUrl ?? null,
      shipping: row.shipping ?? null,
      status: row.status ?? "pending",
      updatedAt: now,
    };
    this.orders.set(stored.id, stored);
    return stored;
  }

  async getOrder(id: string): Promise<StoredOrder | null> {
    return this.orders.get(id) ?? null;
  }

  async listOrders() {
    return { hasMore: false, orders: Array.from(this.orders.values()) };
  }

  async createRefund(): Promise<StoredRefund> {
    throw new Error("not implemented");
  }

  async getRefund(): Promise<StoredRefund | null> {
    return null;
  }

  async listRefunds() {
    return { hasMore: false, refunds: [] };
  }

  async setRefundStatus(): Promise<SetRefundStatusResult | null> {
    return null;
  }

  async setOrderCancelled(): Promise<StoredOrder | null> {
    return null;
  }

  async setOrderFailed(): Promise<StoredOrder | null> {
    return null;
  }

  async setOrderPaid(): Promise<StoredOrder | null> {
    return null;
  }

  async beginWebhookEvent(): Promise<boolean> {
    return true;
  }

  async finishWebhookEvent(): Promise<void> {}
}

function createLogger(): PolrInternalLogger {
  const noop = () => {};
  const trace = Object.assign(noop, {
    run: <T>(_prefix: string, fn: () => T | Promise<T>) => fn(),
  });
  return {
    debug: noop,
    error: noop,
    info: noop,
    trace,
    warn: noop,
  };
}

function createContext(input: {
  appUrl?: string;
  createTransaction: PaymentProvider["createTransaction"];
  returnUrl?: string;
  store: FakeStore;
}): PolrContext {
  const provider: PaymentProvider = {
    createTransaction: input.createTransaction,
    id: "test",
    name: "Test",
    parseNotification: vi.fn(),
  };

  return {
    appUrl: input.appUrl,
    basePath: "/polr",
    defaultCurrency: "PLN",
    logger: createLogger(),
    minOrderAmount: 0,
    options: {
      appUrl: input.appUrl,
      database: { store: input.store },
      provider: {
        createAdapter: () => provider,
        id: "test",
        name: "Test",
      },
      returnUrl: input.returnUrl,
    },
    provider,
    store: input.store,
  };
}

function orderInput() {
  return {
    customer: { email: "ada@example.com", name: "Ada" },
    description: "Order",
    items: [{ name: "Pizza", quantity: 1, unitAmount: 1000 }],
  };
}

describe("createOrder public URLs", () => {
  it("resolves relative returnUrl and statusUrl against appUrl", async () => {
    const store = new FakeStore();
    const createTransaction = vi.fn<PaymentProvider["createTransaction"]>(async () => ({
      paymentUrl: "https://payments.example.com/pay",
      providerData: { token: "token_1" },
      providerTransactionId: "tx_1",
    }));
    const ctx = createContext({
      appUrl: "https://shop.example.com/",
      createTransaction,
      returnUrl: "/checkout/success?token={ORDER_ID}",
      store,
    });

    const result = await createOrder(ctx, orderInput());
    const providerInput = createTransaction.mock.calls[0]?.[0];

    expect(providerInput?.returnUrl).toBe(
      `https://shop.example.com/checkout/success?token=${result.id}`,
    );
    expect(providerInput?.statusUrl).toBe("https://shop.example.com/polr/webhook/test");
    expect(store.orders.get(result.id)?.returnUrl).toBe(providerInput?.returnUrl);
  });

  it("rejects a relative returnUrl when appUrl is missing", async () => {
    const store = new FakeStore();
    const createTransaction = vi.fn();
    const ctx = createContext({
      createTransaction,
      returnUrl: "/checkout/success?token={ORDER_ID}",
      store,
    });

    await expect(createOrder(ctx, orderInput())).rejects.toThrow("Relative returnUrl");
    expect(createTransaction).not.toHaveBeenCalled();
  });
});
