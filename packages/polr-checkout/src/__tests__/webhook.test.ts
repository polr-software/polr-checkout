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
import type { NormalizedNotification, PaymentProvider } from "../providers/provider";
import type { PolrHooks } from "../types/events";
import type { NewStoredOrder, NewStoredRefund, StoredOrder, StoredRefund } from "../types/models";

function applyFakeRefundStatus(
  orders: Map<string, StoredOrder>,
  refunds: Map<string, StoredRefund>,
  input: SetRefundStatusInput,
): SetRefundStatusResult | null {
  const refund = refunds.get(input.id);
  if (!refund || refund.status !== "pending") return null;
  refund.status = input.status;
  refund.providerData = { ...refund.providerData, ...input.providerData };
  refund.updatedAt = new Date();
  const order = orders.get(refund.orderId);
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

function fakeRefundFrom(row: NewStoredRefund): StoredRefund {
  const now = new Date();
  return {
    createdAt: now,
    providerData: {},
    reason: null,
    status: "pending",
    updatedAt: now,
    ...row,
  } as StoredRefund;
}

type WebhookState = {
  error: string | null;
  providerEventId: string;
  providerId: string;
  status: "failed" | "processed" | "processing";
};

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

  async createRefund(row: NewStoredRefund): Promise<StoredRefund> {
    const stored = fakeRefundFrom(row);
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
    return applyFakeRefundStatus(this.orders, this.refunds, input);
  }

  async setOrderCancelled(input: { id: string; reason?: string }): Promise<StoredOrder | null> {
    const existing = this.orders.get(input.id);
    if (!existing) return null;
    existing.error = input.reason ?? null;
    existing.status = "cancelled";
    existing.updatedAt = new Date();
    return existing;
  }

  async setOrderFailed(input: { id: string; error: string }): Promise<StoredOrder | null> {
    const existing = this.orders.get(input.id);
    if (!existing) return null;
    existing.error = input.error;
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

  async beginWebhookEvent(input: {
    payload: Record<string, unknown>;
    providerEventId: string;
    providerId: string;
    type: string;
  }): Promise<boolean> {
    const key = `${input.providerId}:${input.providerEventId}`;
    const existing = this.webhookEvents.get(key);
    if (!existing) {
      this.webhookEvents.set(key, {
        error: null,
        providerEventId: input.providerEventId,
        providerId: input.providerId,
        status: "processing",
      });
      return true;
    }
    if (existing.status === "failed") {
      existing.error = null;
      existing.status = "processing";
      return true;
    }
    return false;
  }

  async finishWebhookEvent(input: {
    error?: string;
    providerEventId: string;
    providerId: string;
    status: "failed" | "processed";
  }): Promise<void> {
    const key = `${input.providerId}:${input.providerEventId}`;
    const existing = this.webhookEvents.get(key);
    if (!existing) return;
    existing.error = input.error ?? null;
    existing.status = input.status;
  }
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
    refundedAmount: 0,
    returnUrl: null,
    shipping: null,
    status: "pending",
    subtotal: 1000,
    updatedAt: now,
    ...overrides,
  };
}

function createNotification(
  overrides: Partial<NormalizedNotification> = {},
): NormalizedNotification {
  return {
    kind: "payment",
    amount: 1000,
    currency: "PLN",
    orderId: "order_1",
    providerEventId: "event_1",
    providerTransactionId: "tx_1",
    raw: { ok: true },
    ...overrides,
  } as NormalizedNotification;
}

function createContext(input: {
  notification?: NormalizedNotification;
  store: FakeStore;
  onPaid?: PolrHooks["orderPaid"];
  verifyTransaction?: PaymentProvider["verifyTransaction"];
}): PolrContext {
  const notification = input.notification ?? createNotification();
  async function parseNotification(): Promise<NormalizedNotification> {
    return notification;
  }

  const provider: PaymentProvider = {
    createTransaction: vi.fn(),
    id: "test",
    name: "Test",
    parseNotification,
    verifyTransaction: input.verifyTransaction,
  };

  return {
    basePath: "/polr",
    defaultCurrency: "PLN",
    logger: createLogger(),
    minOrderAmount: 0,
    options: {
      database: { store: input.store },
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

describe("handleWebhook", () => {
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
    store.orders.set("order_1", createOrder());
  });

  it("marks a pending order paid and runs the blocking paid hook", async () => {
    const onPaid = vi.fn();
    const verifyTransaction = vi.fn();
    const ctx = createContext({ onPaid, store, verifyTransaction });

    await expect(
      handleWebhook(ctx, { body: "{}", headers: {}, providerId: "test" }),
    ).resolves.toEqual({ received: true });

    expect(store.orders.get("order_1")?.status).toBe("paid");
    expect(store.webhookEvents.get("test:event_1")?.status).toBe("processed");
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(verifyTransaction).toHaveBeenCalledTimes(1);
  });

  it("keeps the order paid and marks the webhook failed when the paid hook fails", async () => {
    const onPaid = vi.fn().mockRejectedValue(new Error("fulfillment failed"));
    const ctx = createContext({ onPaid, store });

    await expect(
      handleWebhook(ctx, { body: "{}", headers: {}, providerId: "test" }),
    ).rejects.toThrow("fulfillment failed");

    expect(store.orders.get("order_1")?.status).toBe("paid");
    expect(store.webhookEvents.get("test:event_1")?.status).toBe("failed");
  });

  it("retries the paid hook for a failed webhook event when the order is already paid", async () => {
    store.orders.set("order_1", createOrder({ status: "paid" }));
    store.webhookEvents.set("test:event_1", {
      error: "previous failure",
      providerEventId: "event_1",
      providerId: "test",
      status: "failed",
    });
    const onPaid = vi.fn();
    const ctx = createContext({ onPaid, store });

    await handleWebhook(ctx, { body: "{}", headers: {}, providerId: "test" });

    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(store.webhookEvents.get("test:event_1")?.status).toBe("processed");
  });

  it("does not run the paid hook again for a processed duplicate webhook", async () => {
    store.orders.set("order_1", createOrder({ status: "paid" }));
    store.webhookEvents.set("test:event_1", {
      error: null,
      providerEventId: "event_1",
      providerId: "test",
      status: "processed",
    });
    const onPaid = vi.fn();
    const ctx = createContext({ onPaid, store });

    await handleWebhook(ctx, { body: "{}", headers: {}, providerId: "test" });

    expect(onPaid).not.toHaveBeenCalled();
  });

  it("marks a pending order failed for amount mismatch", async () => {
    const ctx = createContext({
      notification: createNotification({ amount: 2000 }),
      store,
    });

    await expect(
      handleWebhook(ctx, { body: "{}", headers: {}, providerId: "test" }),
    ).rejects.toThrow("does not match");

    expect(store.orders.get("order_1")?.status).toBe("failed");
    expect(store.webhookEvents.get("test:event_1")?.status).toBe("failed");
  });

  it("rejects webhooks for a different provider route", async () => {
    const onPaid = vi.fn();
    const ctx = createContext({ onPaid, store });

    await expect(
      handleWebhook(ctx, { body: "{}", headers: {}, providerId: "other" }),
    ).rejects.toThrow("does not match");

    expect(onPaid).not.toHaveBeenCalled();
    expect(store.webhookEvents.size).toBe(0);
  });
});
