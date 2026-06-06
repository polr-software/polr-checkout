import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PolrContext } from "../core/context";
import type { PolrInternalLogger } from "../core/logger";
import type {
  ListStoredRefundsInput,
  PolrStore,
  SetRefundStatusInput,
  SetRefundStatusResult,
} from "../database/store";
import { refundOrder } from "../order/order.service";
import type { PaymentProvider } from "../providers/provider";
import type { PolrEventHandlers, PolrHooks } from "../types/events";
import type { NewStoredOrder, NewStoredRefund, StoredOrder, StoredRefund } from "../types/models";

class FakeStore implements PolrStore {
  orders = new Map<string, StoredOrder>();
  refunds = new Map<string, StoredRefund>();

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

  async setOrderCancelled(): Promise<StoredOrder | null> {
    return null;
  }

  async setOrderFailed(): Promise<StoredOrder | null> {
    return null;
  }

  async setOrderPaid(): Promise<StoredOrder | null> {
    return null;
  }

  async createRefund(row: NewStoredRefund): Promise<StoredRefund> {
    const now = new Date();
    const stored = {
      createdAt: now,
      providerData: {},
      reason: null,
      status: "pending",
      updatedAt: now,
      ...row,
    } as StoredRefund;
    this.refunds.set(stored.id, stored);
    return stored;
  }

  async getRefund(id: string): Promise<StoredRefund | null> {
    return this.refunds.get(id) ?? null;
  }

  async listRefunds(input: ListStoredRefundsInput = {}) {
    let rows = Array.from(this.refunds.values());
    if (input.orderId) rows = rows.filter((r) => r.orderId === input.orderId);
    if (input.status) rows = rows.filter((r) => r.status === input.status);
    return { hasMore: false, refunds: rows };
  }

  async setRefundStatus(input: SetRefundStatusInput): Promise<SetRefundStatusResult | null> {
    const refund = this.refunds.get(input.id);
    if (!refund || refund.status !== "pending") return null;
    refund.status = input.status;
    refund.providerData = { ...refund.providerData, ...input.providerData };
    refund.updatedAt = new Date();
    const order = this.orders.get(refund.orderId);
    if (!order) throw new Error(`missing order ${refund.orderId}`);
    if (input.status === "completed") {
      order.refundedAmount += refund.amount;
      if (order.status === "paid" || order.status === "partially_refunded") {
        order.status = order.refundedAmount >= order.amount ? "refunded" : "partially_refunded";
      }
      order.updatedAt = new Date();
    }
    return { order, refund };
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
  return { debug: noop, error: noop, info: noop, trace, warn: noop };
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
    paidAt: now,
    providerData: {},
    providerId: "test",
    providerTransactionId: "987",
    refundedAmount: 0,
    returnUrl: null,
    shipping: null,
    status: "paid",
    subtotal: 1000,
    updatedAt: now,
    ...overrides,
  };
}

function createContext(input: {
  events?: PolrEventHandlers;
  onRefunded?: PolrHooks["orderRefunded"];
  refund?: PaymentProvider["refund"];
  store: FakeStore;
}): PolrContext {
  const provider: PaymentProvider = {
    createTransaction: vi.fn(),
    id: "test",
    name: "Test",
    parseNotification: vi.fn(),
    refund: input.refund,
  };

  return {
    basePath: "/polr",
    defaultCurrency: "PLN",
    logger: createLogger(),
    minOrderAmount: 0,
    options: {
      database: { store: input.store },
      events: input.events,
      hooks: input.onRefunded ? { orderRefunded: input.onRefunded } : undefined,
      provider: { createAdapter: () => provider, id: "test", name: "Test" },
    },
    provider,
    store: input.store,
  };
}

describe("refundOrder", () => {
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
    store.orders.set("order_1", createOrder());
  });

  it("rejects refunding an order that is not paid", async () => {
    store.orders.set("order_1", createOrder({ paidAt: null, status: "pending" }));
    const ctx = createContext({ refund: vi.fn(), store });

    await expect(refundOrder(ctx, { id: "order_1" })).rejects.toMatchObject({
      code: "ORDER_NOT_REFUNDABLE",
    });
  });

  it("throws when the provider does not support refunds", async () => {
    const ctx = createContext({ store });

    await expect(refundOrder(ctx, { id: "order_1" })).rejects.toThrow("does not support refunds");
  });

  it("rejects a refund amount above the remaining refundable balance", async () => {
    const refund = vi.fn();
    const ctx = createContext({ refund, store });

    await expect(refundOrder(ctx, { amount: 2000, id: "order_1" })).rejects.toMatchObject({
      code: "REFUND_AMOUNT_EXCEEDS",
    });
    expect(refund).not.toHaveBeenCalled();
  });

  it("creates a pending refund and emits refund.created for a full refund", async () => {
    const onCreated = vi.fn();
    const refund = vi.fn().mockResolvedValue({ refundId: "ignored", status: "pending" });
    const ctx = createContext({ events: { "refund.created": onCreated }, refund, store });

    const result = await refundOrder(ctx, { id: "order_1", reason: "oops" });

    expect(result).toMatchObject({ amount: 1000, status: "pending" });
    expect(refund).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1000,
        currency: "PLN",
        orderId: "order_1",
        providerTransactionId: "987",
        reason: "oops",
        refundId: result.refundId,
        statusUrl: "/polr/webhook/test",
      }),
    );
    expect(store.refunds.get(result.refundId)?.status).toBe("pending");
    expect(store.orders.get("order_1")?.status).toBe("paid");
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("transitions to partially_refunded when an immediate partial refund completes", async () => {
    const onCompleted = vi.fn();
    const refund = vi.fn().mockResolvedValue({ refundId: "ignored", status: "completed" });
    const ctx = createContext({ events: { "refund.completed": onCompleted }, refund, store });

    const result = await refundOrder(ctx, { amount: 400, id: "order_1" });

    expect(result.status).toBe("completed");
    expect(store.orders.get("order_1")?.status).toBe("partially_refunded");
    expect(store.orders.get("order_1")?.refundedAmount).toBe(400);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("marks the order refunded and runs the orderRefunded hook on a full completed refund", async () => {
    const onRefunded = vi.fn();
    const refund = vi.fn().mockResolvedValue({ refundId: "ignored", status: "completed" });
    const ctx = createContext({ onRefunded, refund, store });

    await refundOrder(ctx, { id: "order_1" });

    expect(store.orders.get("order_1")?.status).toBe("refunded");
    expect(onRefunded).toHaveBeenCalledTimes(1);
  });

  it("marks the refund rejected when the provider call fails", async () => {
    const refund = vi.fn().mockRejectedValue(new Error("Insufficient funds available"));
    const ctx = createContext({ refund, store });

    await expect(refundOrder(ctx, { id: "order_1" })).rejects.toThrow("Insufficient funds");
    const rejected = Array.from(store.refunds.values())[0];
    expect(rejected?.status).toBe("rejected");
    expect(store.orders.get("order_1")?.status).toBe("paid");
  });
});
