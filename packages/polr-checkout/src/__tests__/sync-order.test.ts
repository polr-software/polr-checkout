import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PolrContext } from "../core/context";
import type { PolrInternalLogger } from "../core/logger";
import type { PolrStore } from "../database/store";
import { syncOrder } from "../order/order.service";
import type { PaymentProvider } from "../providers/provider";
import type { PolrEventHandlers, PolrHooks } from "../types/events";
import type { NewStoredOrder, StoredOrder } from "../types/models";

class FakeStore implements PolrStore {
  orders = new Map<string, StoredOrder>();

  async createOrder(row: NewStoredOrder): Promise<StoredOrder> {
    const stored = row as StoredOrder;
    this.orders.set(stored.id, stored);
    return stored;
  }

  async getOrder(id: string): Promise<StoredOrder | null> {
    return this.orders.get(id) ?? null;
  }

  async listOrders() {
    return { hasMore: false, orders: Array.from(this.orders.values()) };
  }

  async setOrderCancelled(input: { id: string; reason?: string }): Promise<StoredOrder | null> {
    const existing = this.orders.get(input.id);
    if (!existing) return null;
    existing.error = input.reason ?? null;
    existing.status = "cancelled";
    existing.updatedAt = new Date();
    return existing;
  }

  async setOrderFailed(input: {
    id: string;
    error: string;
    providerData?: Record<string, unknown>;
    providerTransactionId?: string | null;
  }): Promise<StoredOrder | null> {
    const existing = this.orders.get(input.id);
    if (!existing) return null;
    existing.error = input.error;
    existing.providerData = { ...existing.providerData, ...input.providerData };
    if (input.providerTransactionId !== undefined) {
      existing.providerTransactionId = input.providerTransactionId;
    }
    existing.status = "failed";
    existing.updatedAt = new Date();
    return existing;
  }

  async setOrderPaid(input: {
    id: string;
    providerData?: Record<string, unknown>;
    providerTransactionId: string;
  }): Promise<StoredOrder | null> {
    const existing = this.orders.get(input.id);
    if (!existing || existing.status !== "pending") return null;
    existing.error = null;
    existing.paidAt = new Date();
    existing.providerData = { ...existing.providerData, ...input.providerData };
    existing.providerTransactionId = input.providerTransactionId;
    existing.status = "paid";
    existing.updatedAt = new Date();
    return existing;
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

function createOrder(overrides: Partial<StoredOrder> = {}): StoredOrder {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    amount: 1000,
    createdAt: now,
    currency: "PLN",
    customer: { email: "a@example.com", name: "Ada" },
    description: "Order",
    error: null,
    expiresAt: null,
    id: "order_1",
    items: [{ name: "Pizza", quantity: 1, unitAmount: 1000 }],
    metadata: {},
    paidAt: null,
    providerData: {},
    providerId: "test",
    providerTransactionId: null,
    returnUrl: null,
    shipping: null,
    status: "pending",
    subtotal: 1000,
    updatedAt: now,
    ...overrides,
  };
}

function createContext(input: {
  events?: PolrEventHandlers;
  onPaid?: PolrHooks["orderPaid"];
  store: FakeStore;
  syncTransaction?: PaymentProvider["syncTransaction"];
  verifyTransaction?: PaymentProvider["verifyTransaction"];
}): PolrContext {
  const provider: PaymentProvider = {
    createTransaction: vi.fn(),
    id: "test",
    name: "Test",
    parseNotification: vi.fn(),
    syncTransaction: input.syncTransaction,
    verifyTransaction: input.verifyTransaction,
  };

  return {
    basePath: "/polr",
    defaultCurrency: "PLN",
    logger: createLogger(),
    minOrderAmount: 0,
    options: {
      database: { store: input.store },
      events: input.events,
      hooks: input.onPaid ? { orderPaid: input.onPaid } : undefined,
      provider: {
        createAdapter: () => provider,
        id: "test",
        name: "Test",
      },
    },
    provider,
    store: input.store,
  };
}

describe("syncOrder", () => {
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
    store.orders.set("order_1", createOrder());
  });

  it("marks a pending order paid and runs verification and paid hook", async () => {
    const onPaid = vi.fn();
    const verifyTransaction = vi.fn();
    const syncTransaction = vi.fn().mockResolvedValue({
      amount: 1000,
      currency: "PLN",
      providerData: { lastStatusCheck: { status: 2 } },
      providerTransactionId: "tx_1",
      status: "paid",
    });
    const ctx = createContext({ onPaid, store, syncTransaction, verifyTransaction });

    const result = await syncOrder(ctx, { id: "order_1" });

    expect(result?.status).toBe("paid");
    expect(store.orders.get("order_1")?.providerTransactionId).toBe("tx_1");
    expect(store.orders.get("order_1")?.providerData).toEqual({
      lastStatusCheck: { status: 2 },
    });
    expect(syncTransaction).toHaveBeenCalledWith({
      amount: 1000,
      closeIfUnpaid: undefined,
      currency: "PLN",
      orderId: "order_1",
      providerData: {},
      providerTransactionId: null,
    });
    expect(verifyTransaction).toHaveBeenCalledTimes(1);
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it("keeps the order pending when provider state is pending", async () => {
    const onPaid = vi.fn();
    const syncTransaction = vi.fn().mockResolvedValue({ status: "pending" });
    const ctx = createContext({ onPaid, store, syncTransaction });

    const result = await syncOrder(ctx, { id: "order_1" });

    expect(result?.status).toBe("pending");
    expect(store.orders.get("order_1")?.status).toBe("pending");
    expect(onPaid).not.toHaveBeenCalled();
  });

  it("marks the order failed when provider reports a failed payment", async () => {
    const onFailed = vi.fn();
    const syncTransaction = vi.fn().mockResolvedValue({
      error: "payment failed",
      providerData: { lastStatusCheck: { status: 0 } },
      providerTransactionId: "123",
      status: "failed",
    });
    const ctx = createContext({
      events: { "order.failed": onFailed },
      store,
      syncTransaction,
    });

    const result = await syncOrder(ctx, { closeIfUnpaid: true, id: "order_1" });

    expect(result?.status).toBe("failed");
    expect(result?.error).toBe("payment failed");
    expect(result?.providerTransactionId).toBe("123");
    expect(result?.providerData).toEqual({ lastStatusCheck: { status: 0 } });
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("rejects paid sync when provider amount does not match the order", async () => {
    const syncTransaction = vi.fn().mockResolvedValue({
      amount: 2000,
      currency: "PLN",
      providerTransactionId: "tx_1",
      status: "paid",
    });
    const ctx = createContext({ store, syncTransaction });

    await expect(syncOrder(ctx, { id: "order_1" })).rejects.toThrow("does not match");

    expect(store.orders.get("order_1")?.status).toBe("pending");
  });

  it("returns the local order when provider does not support sync", async () => {
    const ctx = createContext({ store });

    const result = await syncOrder(ctx, { id: "order_1" });

    expect(result?.status).toBe("pending");
  });
});
