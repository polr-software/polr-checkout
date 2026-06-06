import type { PolrContext } from "../core/context";
import { PolrError, POLR_ERROR_CODES } from "../core/errors";
import { generateId } from "../core/utils";
import {
  applyRefundResolution,
  emitEvent,
  markOrderFailed,
  processProviderPaidOrder,
  toEventPayload,
} from "../order/order.service";
import type {
  NormalizedNotification,
  NormalizedPaymentNotification,
  NormalizedRefundNotification,
} from "../providers/provider";

export interface HandleWebhookInput {
  body: string;
  headers: Record<string, string>;
  providerId: string;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

async function processNotification(
  ctx: PolrContext,
  notification: NormalizedNotification,
): Promise<void> {
  if (notification.kind === "refund") {
    return processRefundNotification(ctx, notification);
  }
  return processPaymentNotification(ctx, notification);
}

async function processPaymentNotification(
  ctx: PolrContext,
  notification: NormalizedPaymentNotification,
): Promise<void> {
  const existing = await ctx.store.getOrder(notification.orderId);
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
    ctx.logger.info({ orderId: existing.id }, "order already paid, retrying fulfillment hook");
    await processProviderPaidOrder(ctx, {
      amount: notification.amount,
      currency: notification.currency,
      id: notification.orderId,
      providerTransactionId: notification.providerTransactionId,
    });
    return;
  }

  if (existing.status !== "pending") {
    throw PolrError.from(
      "CONFLICT",
      POLR_ERROR_CODES.ORDER_INVALID_STATE,
      `Order ${existing.id} is ${existing.status}`,
    );
  }

  await processProviderPaidOrder(ctx, {
    amount: notification.amount,
    currency: notification.currency,
    id: notification.orderId,
    providerData: {
      lastNotification: notification.raw,
      providerMethodId: notification.providerMethodId ?? null,
    },
    providerTransactionId: notification.providerTransactionId,
  });
}

async function processRefundNotification(
  ctx: PolrContext,
  notification: NormalizedRefundNotification,
): Promise<void> {
  const order = await ctx.store.getOrder(notification.orderId);
  if (!order) {
    throw PolrError.from("NOT_FOUND", POLR_ERROR_CODES.ORDER_NOT_FOUND);
  }
  if (order.currency.toUpperCase() !== notification.currency.toUpperCase()) {
    throw PolrError.from(
      "CONFLICT",
      POLR_ERROR_CODES.ORDER_CURRENCY_MISMATCH,
      `Refund currency ${notification.currency} does not match order currency ${order.currency}`,
    );
  }

  const existing = await ctx.store.getRefund(notification.refundId);
  if (!existing) {
    // Refund initiated outside polr (e.g. the Przelewy24 panel) — reconcile it.
    await ctx.store.createRefund({
      id: notification.refundId,
      orderId: order.id,
      providerId: ctx.provider.id,
      amount: notification.amount,
      currency: notification.currency,
      reason: null,
      status: "pending",
    });
  }

  await applyRefundResolution(ctx, {
    refundId: notification.refundId,
    status: notification.status,
    providerData: { lastRefundNotification: notification.raw },
  });
}

async function failWebhookOrder(
  ctx: PolrContext,
  input: { error: unknown; orderId: string },
): Promise<void> {
  const existing = await ctx.store.getOrder(input.orderId);
  if (!existing || existing.status === "paid") return;

  const failed = await markOrderFailed(ctx, {
    error: errorDetail(input.error),
    id: input.orderId,
  });

  if (failed) {
    await emitEvent(ctx, "order.failed", {
      error: errorDetail(input.error),
      order: toEventPayload(failed),
    });
  }
}

export async function handleWebhook(
  ctx: PolrContext,
  input: HandleWebhookInput,
): Promise<{ received: true }> {
  if (input.providerId !== ctx.provider.id) {
    throw PolrError.from(
      "BAD_REQUEST",
      POLR_ERROR_CODES.PROVIDER_ID_MISMATCH,
      `Webhook provider "${input.providerId}" does not match "${ctx.provider.id}"`,
    );
  }

  return ctx.logger.trace.run("wh", async () => {
    const traceId = generateId("wh", 12);
    const startTime = Date.now();
    const notification = await ctx.provider.parseNotification({
      body: input.body,
      headers: input.headers,
    });
    ctx.logger.info(
      { orderId: notification.orderId, providerEventId: notification.providerEventId, traceId },
      "webhook received",
    );

    const shouldProcess = await ctx.store.beginWebhookEvent({
      payload: notification.raw,
      providerEventId: notification.providerEventId,
      providerId: ctx.provider.id,
      traceId,
      type: `${ctx.provider.id}.notification`,
    });
    if (!shouldProcess) {
      ctx.logger.info(
        { providerEventId: notification.providerEventId, traceId },
        "webhook skipped (duplicate)",
      );
      return { received: true };
    }

    try {
      await processNotification(ctx, notification);
      await ctx.store.finishWebhookEvent({
        providerEventId: notification.providerEventId,
        providerId: ctx.provider.id,
        status: "processed",
      });
      ctx.logger.info(
        { duration: Date.now() - startTime, orderId: notification.orderId, traceId },
        "webhook processed",
      );
    } catch (error) {
      ctx.logger.error({ err: error, orderId: notification.orderId, traceId }, "webhook failed");
      await ctx.store.finishWebhookEvent({
        error: errorDetail(error),
        providerEventId: notification.providerEventId,
        providerId: ctx.provider.id,
        status: "failed",
      });
      if (notification.kind === "payment") {
        await failWebhookOrder(ctx, { error, orderId: notification.orderId });
      }
      throw error;
    }

    return { received: true };
  });
}
