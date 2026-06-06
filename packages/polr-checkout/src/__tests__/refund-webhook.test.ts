import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PolrContext } from "../core/context";
import type { PolrInternalLogger } from "../core/logger";
import type {
  ListStoredRefundsInput,
  PolrStore,
  SetRefundStatusInput,
  SetRefundStatusResult,
} from "../database/store";
import { handleWebhook } from "../webhook/webhook.service";
import type {
  NormalizedNotification,
  NormalizedRefundNotification,
  PaymentProvider,
} from "../providers/provider";
import type { PolrHooks } from "../types/events";
import type { NewStoredOrder, NewStoredRefund, StoredOrder, StoredRefund } from "../types/models";

type WebhookState = { providerEventId: string; status: "failed" | "processed" | "processing" };

class FakeStore implements PolrStore {
  orders = new Map<string, StoredOrder>();
  refunds = new Map<string, StoredRefund>();
  webhookEvents = new Map<string, WebhookState>();

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

  async setOrderFailed(input: { id: string; error: string }): Promise<StoredOrder | null> {
    const existing = this.orders.get(input.id);
    if (!existing) return null;
    existing.error = input.error;
    existing.status = "failed";
    return existing;
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
    const order = this.orders.get(refund.orderId);
    if (!order) throw new Error(`missing order ${refund.orderId}`);
    if (input.status === "completed") {
      order.refundedAmount += refund.amount;
      if (order.status === "paid" || order.status === "partially_refunded") {
        order.status = order.refundedAmount >= order.amount ? "refunded" : "partially_refunded";
      }
    }
    return { order, refund };
  }

  async beginWebhookEvent(input: { providerEventId: string }): Promise<boolean> {
    const existing = this.webhookEvents.get(input.providerEventId);
    if (!existing) {
      this.webhookEvents.set(input.providerEventId, {
        providerEventId: input.providerEventId,
        status: "processing",
      });
      return true;
    }
    if (existing.status === "failed") {
      existing.status = "processing";
      return true;
    }
    return false;
  }

  async finishWebhookEvent(input: {
    providerEventId: string;
    status: "failed" | "processed";
  }): Promise<void> {
    const existing = this.webhookEvents.get(input.providerEventId);
    if (existing) existing.status = input.status;
  }
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

function refundNotification(
  overrides: Partial<NormalizedRefundNotification> = {},
): NormalizedRefundNotification {
  return {
    amount: 1000,
    currency: "PLN",
    kind: "refund",
    orderId: "order_1",
    providerEventId: "refund:rfn_1:0",
    providerTransactionId: "987",
    raw: { ok: true },
    refundId: "rfn_1",
    status: "completed",
    ...overrides,
  };
}

function createContext(input: {
  notification: NormalizedNotification;
  onRefunded?: PolrHooks["orderRefunded"];
  store: FakeStore;
}): PolrContext {
  const provider: PaymentProvider = {
    createTransaction: vi.fn(),
    id: "test",
    name: "Test",
    parseNotification: async () => input.notification,
  };

  return {
    basePath: "/polr",
    defaultCurrency: "PLN",
    logger: createLogger(),
    minOrderAmount: 0,
    options: {
      database: { store: input.store },
      hooks: input.onRefunded ? { orderRefunded: input.onRefunded } : undefined,
      provider: { createAdapter: () => provider, id: "test", name: "Test" },
    },
    provider,
    store: input.store,
  };
}

describe("handleWebhook (refund notifications)", () => {
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
    store.orders.set("order_1", createOrder());
  });

  it("applies a completed refund and runs the orderRefunded hook", async () => {
    store.refunds.set("rfn_1", {
      amount: 1000,
      createdAt: new Date(),
      currency: "PLN",
      id: "rfn_1",
      orderId: "order_1",
      providerData: {},
      providerId: "test",
      reason: null,
      status: "pending",
      updatedAt: new Date(),
    });
    const onRefunded = vi.fn();
    const ctx = createContext({ notification: refundNotification(), onRefunded, store });

    await handleWebhook(ctx, { body: "{}", headers: {}, providerId: "test" });

    expect(store.refunds.get("rfn_1")?.status).toBe("completed");
    expect(store.orders.get("order_1")?.status).toBe("refunded");
    expect(onRefunded).toHaveBeenCalledTimes(1);
  });

  it("reconciles a refund initiated outside polr by creating the row", async () => {
    const ctx = createContext({ notification: refundNotification(), store });

    await handleWebhook(ctx, { body: "{}", headers: {}, providerId: "test" });

    expect(store.refunds.get("rfn_1")?.status).toBe("completed");
    expect(store.orders.get("order_1")?.status).toBe("refunded");
  });

  it("does not mark the order failed when refund processing throws", async () => {
    const ctx = createContext({
      notification: refundNotification({ currency: "EUR" }),
      store,
    });

    await expect(
      handleWebhook(ctx, { body: "{}", headers: {}, providerId: "test" }),
    ).rejects.toThrow("does not match");

    expect(store.orders.get("order_1")?.status).toBe("paid");
    expect(store.webhookEvents.get("refund:rfn_1:0")?.status).toBe("failed");
  });

  it("ignores a duplicate refund notification", async () => {
    const onRefunded = vi.fn();
    const ctx = createContext({ notification: refundNotification(), onRefunded, store });

    await handleWebhook(ctx, { body: "{}", headers: {}, providerId: "test" });
    await handleWebhook(ctx, { body: "{}", headers: {}, providerId: "test" });

    expect(onRefunded).toHaveBeenCalledTimes(1);
  });
});
