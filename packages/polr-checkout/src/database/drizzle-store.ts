import { and, desc, eq, lt, sql } from "drizzle-orm";

import { generateId } from "../core/utils";
import { order, refund, webhookEvent } from "./schema";
import type {
  BeginWebhookEventInput,
  PolrDatabase,
  PolrDatabaseAdapter,
  PolrStore,
  SetRefundStatusInput,
  SetRefundStatusResult,
} from "./store";

export function drizzleDatabase(db: PolrDatabase): PolrDatabaseAdapter {
  return { store: createDrizzleStore(db) };
}

export function createDrizzleStore(db: PolrDatabase): PolrStore {
  return {
    async createOrder(row) {
      const [stored] = await db.insert(order).values(row).returning();
      if (!stored) {
        throw new Error("Failed to insert order");
      }
      return stored;
    },

    async getOrder(id) {
      const row = await db.query.order.findFirst({ where: eq(order.id, id) });
      return row ?? null;
    },

    async listOrders(input = {}) {
      const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
      const conditions = [];
      if (input.status) conditions.push(eq(order.status, input.status));
      if (input.before) conditions.push(lt(order.createdAt, input.before));

      const rows = await db
        .select()
        .from(order)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(order.createdAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      return { orders: hasMore ? rows.slice(0, limit) : rows, hasMore };
    },

    async setOrderCancelled(input) {
      const [updated] = await db
        .update(order)
        .set({
          error: input.reason ?? null,
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(eq(order.id, input.id))
        .returning();
      return updated ?? null;
    },

    async setOrderFailed(input) {
      const [updated] = await db
        .update(order)
        .set({
          error: input.error,
          ...(input.providerData
            ? {
                providerData: sql`${order.providerData} || ${JSON.stringify(input.providerData)}::jsonb`,
              }
            : {}),
          ...(input.providerTransactionId !== undefined
            ? { providerTransactionId: input.providerTransactionId }
            : {}),
          status: "failed",
          updatedAt: new Date(),
        })
        .where(eq(order.id, input.id))
        .returning();
      return updated ?? null;
    },

    async setOrderPaid(input) {
      const now = new Date();
      const [updated] = await db
        .update(order)
        .set({
          error: null,
          paidAt: now,
          providerData: sql`${order.providerData} || ${JSON.stringify(input.providerData ?? {})}::jsonb`,
          providerTransactionId: input.providerTransactionId,
          status: "paid",
          updatedAt: now,
        })
        .where(and(eq(order.id, input.id), eq(order.status, "pending")))
        .returning();
      return updated ?? null;
    },

    async createRefund(row) {
      const [stored] = await db.insert(refund).values(row).returning();
      if (!stored) {
        throw new Error("Failed to insert refund");
      }
      return stored;
    },

    async getRefund(id) {
      const row = await db.query.refund.findFirst({ where: eq(refund.id, id) });
      return row ?? null;
    },

    async listRefunds(input = {}) {
      const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
      const conditions = [];
      if (input.orderId) conditions.push(eq(refund.orderId, input.orderId));
      if (input.status) conditions.push(eq(refund.status, input.status));
      if (input.before) conditions.push(lt(refund.createdAt, input.before));

      const rows = await db
        .select()
        .from(refund)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(refund.createdAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      return { refunds: hasMore ? rows.slice(0, limit) : rows, hasMore };
    },

    async setRefundStatus(input) {
      return setRefundStatus(db, input);
    },

    async beginWebhookEvent(input) {
      return beginWebhookEvent(db, input);
    },

    async finishWebhookEvent(input) {
      await db
        .update(webhookEvent)
        .set({
          error: input.error ?? null,
          processedAt: new Date(),
          status: input.status,
        })
        .where(
          and(
            eq(webhookEvent.providerId, input.providerId),
            eq(webhookEvent.providerEventId, input.providerEventId),
          ),
        );
    },
  };
}

async function setRefundStatus(
  db: PolrDatabase,
  input: SetRefundStatusInput,
): Promise<SetRefundStatusResult | null> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [updatedRefund] = await tx
      .update(refund)
      .set({
        status: input.status,
        ...(input.providerData
          ? {
              providerData: sql`${refund.providerData} || ${JSON.stringify(input.providerData)}::jsonb`,
            }
          : {}),
        updatedAt: now,
      })
      .where(and(eq(refund.id, input.id), eq(refund.status, "pending")))
      .returning();

    if (!updatedRefund) return null;

    const existingOrder = await tx.query.order.findFirst({
      where: eq(order.id, updatedRefund.orderId),
    });
    if (!existingOrder) {
      throw new Error(
        `Refund ${updatedRefund.id} references missing order ${updatedRefund.orderId}`,
      );
    }

    if (input.status === "rejected") {
      return { order: existingOrder, refund: updatedRefund };
    }

    const refundedAmount = existingOrder.refundedAmount + updatedRefund.amount;
    const canTransition =
      existingOrder.status === "paid" || existingOrder.status === "partially_refunded";
    const nextStatus = !canTransition
      ? existingOrder.status
      : refundedAmount >= existingOrder.amount
        ? "refunded"
        : "partially_refunded";

    const [updatedOrder] = await tx
      .update(order)
      .set({ refundedAmount, status: nextStatus, updatedAt: now })
      .where(eq(order.id, existingOrder.id))
      .returning();

    return { order: updatedOrder ?? existingOrder, refund: updatedRefund };
  });
}

async function beginWebhookEvent(
  db: PolrDatabase,
  input: BeginWebhookEventInput,
): Promise<boolean> {
  try {
    await db.insert(webhookEvent).values({
      error: null,
      id: generateId("evt"),
      payload: input.payload,
      processedAt: null,
      providerEventId: input.providerEventId,
      providerId: input.providerId,
      receivedAt: new Date(),
      status: "processing",
      traceId: input.traceId,
      type: input.type,
    });
    return true;
  } catch (error: unknown) {
    const code =
      (error as { code?: string; cause?: { code?: string } }).code ??
      (error as { cause?: { code?: string } }).cause?.code;
    if (code !== "23505") throw error;

    const retried = await db
      .update(webhookEvent)
      .set({
        error: null,
        processedAt: null,
        receivedAt: new Date(),
        status: "processing",
        traceId: input.traceId,
      })
      .where(
        and(
          eq(webhookEvent.providerId, input.providerId),
          eq(webhookEvent.providerEventId, input.providerEventId),
          sql`(${webhookEvent.status} = 'failed' OR (${webhookEvent.status} = 'processing' AND ${webhookEvent.receivedAt} < now() - interval '5 minutes'))`,
        ),
      )
      .returning({ id: webhookEvent.id });

    return retried.length > 0;
  }
}
