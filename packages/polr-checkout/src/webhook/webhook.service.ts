import { and, eq, sql } from "drizzle-orm";

import type { PolrContext } from "../core/context";
import { PolrError, POLR_ERROR_CODES } from "../core/errors";
import { getTraceId } from "../core/logger";
import { generateId } from "../core/utils";
import { order, webhookEvent } from "../database/schema";
import {
  emitEvent,
  markOrderFailed,
  markOrderPaid,
  toEventPayload,
} from "../order/order.service";
import type { NormalizedNotification } from "../providers/provider";

export interface HandleWebhookInput {
  body: string;
  headers: Record<string, string>;
}

async function beginWebhookEvent(
  ctx: PolrContext,
  input: {
    payload: Record<string, unknown>;
    providerEventId: string;
    type: string;
  },
): Promise<boolean> {
  try {
    await ctx.database.insert(webhookEvent).values({
      error: null,
      id: generateId("evt"),
      payload: input.payload,
      processedAt: null,
      providerEventId: input.providerEventId,
      providerId: ctx.provider.id,
      receivedAt: new Date(),
      status: "processing",
      traceId: getTraceId(),
      type: input.type,
    });
    return true;
  } catch (error: unknown) {
    const code =
      (error as { code?: string; cause?: { code?: string } }).code ??
      (error as { cause?: { code?: string } }).cause?.code;
    if (code !== "23505") throw error;

    const retried = await ctx.database
      .update(webhookEvent)
      .set({ error: null, processedAt: null, status: "processing" })
      .where(
        and(
          eq(webhookEvent.providerId, ctx.provider.id),
          eq(webhookEvent.providerEventId, input.providerEventId),
          sql`(${webhookEvent.status} = 'failed' OR (${webhookEvent.status} = 'processing' AND ${webhookEvent.receivedAt} < now() - interval '5 minutes'))`,
        ),
      )
      .returning({ id: webhookEvent.id });

    return retried.length > 0;
  }
}

async function finishWebhookEvent(
  ctx: PolrContext,
  input: {
    error?: string;
    providerEventId: string;
    status: "failed" | "processed";
  },
): Promise<void> {
  await ctx.database
    .update(webhookEvent)
    .set({
      error: input.error ?? null,
      processedAt: new Date(),
      status: input.status,
    })
    .where(
      and(
        eq(webhookEvent.providerId, ctx.provider.id),
        eq(webhookEvent.providerEventId, input.providerEventId),
      ),
    );
}

async function processNotification(
  ctx: PolrContext,
  notification: NormalizedNotification,
): Promise<void> {
  const existing = await ctx.database.query.order.findFirst({
    where: eq(order.id, notification.orderId),
  });
  if (!existing) {
    throw PolrError.from("NOT_FOUND", POLR_ERROR_CODES.ORDER_NOT_FOUND);
  }

  if (existing.amount !== notification.amount) {
    throw PolrError.from(
      "CONFLICT",
      POLR_ERROR_CODES.ORDER_AMOUNT_MISMATCH,
      `Notification amount ${notification.amount} does not match order amount ${existing.amount}`,
    );
  }
  if (existing.currency.toUpperCase() !== notification.currency.toUpperCase()) {
    throw PolrError.from(
      "CONFLICT",
      POLR_ERROR_CODES.ORDER_CURRENCY_MISMATCH,
      `Notification currency ${notification.currency} does not match order currency ${existing.currency}`,
    );
  }

  if (existing.status === "paid") {
    ctx.logger.info({ orderId: existing.id }, "order already paid, skipping");
    return;
  }

  if (ctx.provider.verifyTransaction) {
    await ctx.provider.verifyTransaction({
      orderId: notification.orderId,
      providerTransactionId: notification.providerTransactionId,
      amount: notification.amount,
      currency: notification.currency,
    });
  }

  const updated = await markOrderPaid(ctx, {
    id: notification.orderId,
    providerTransactionId: notification.providerTransactionId,
    providerData: {
      lastNotification: notification.raw,
      providerMethodId: notification.providerMethodId ?? null,
    },
  });

  if (updated) {
    await emitEvent(ctx, "order.paid", { order: toEventPayload(updated) });
  }
}

export async function handleWebhook(
  ctx: PolrContext,
  input: HandleWebhookInput,
): Promise<{ received: true }> {
  return ctx.logger.trace.run("wh", async () => {
    const startTime = Date.now();
    const notification = await ctx.provider.parseNotification({
      body: input.body,
      headers: input.headers,
    });
    ctx.logger.info(
      { orderId: notification.orderId, providerEventId: notification.providerEventId },
      "webhook received",
    );

    const shouldProcess = await beginWebhookEvent(ctx, {
      payload: notification.raw,
      providerEventId: notification.providerEventId,
      type: `${ctx.provider.id}.notification`,
    });
    if (!shouldProcess) {
      ctx.logger.info(
        { providerEventId: notification.providerEventId },
        "webhook skipped (duplicate)",
      );
      return { received: true };
    }

    try {
      await processNotification(ctx, notification);
      await finishWebhookEvent(ctx, {
        providerEventId: notification.providerEventId,
        status: "processed",
      });
      ctx.logger.info(
        { orderId: notification.orderId, duration: Date.now() - startTime },
        "webhook processed",
      );
    } catch (error) {
      const errorDetail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      ctx.logger.error({ err: error, orderId: notification.orderId }, "webhook failed");
      await finishWebhookEvent(ctx, {
        error: errorDetail,
        providerEventId: notification.providerEventId,
        status: "failed",
      });

      const failed = await markOrderFailed(ctx, {
        id: notification.orderId,
        error: errorDetail,
      });
      if (failed) {
        await emitEvent(ctx, "order.failed", {
          order: toEventPayload(failed),
          error: errorDetail,
        });
      }
      throw error;
    }

    return { received: true };
  });
}
