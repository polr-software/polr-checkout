import type { PolrContext } from "../core/context";
import { PolrError, POLR_ERROR_CODES } from "../core/errors";
import { generateId } from "../core/utils";
import {
  emitEvent,
  markOrderFailed,
  markOrderPaid,
  runOrderPaidHook,
  toEventPayload,
} from "../order/order.service";
import type { NormalizedNotification } from "../providers/provider";
import type { StoredOrder } from "../types/models";

export interface HandleWebhookInput {
  body: string;
  headers: Record<string, string>;
  providerId: string;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

async function processPaidOrderHook(ctx: PolrContext, order: StoredOrder): Promise<void> {
  await runOrderPaidHook(ctx, { order: toEventPayload(order) });
}

async function processNotification(
  ctx: PolrContext,
  notification: NormalizedNotification,
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
    await processPaidOrderHook(ctx, existing);
    return;
  }

  if (existing.status !== "pending") {
    throw PolrError.from(
      "CONFLICT",
      POLR_ERROR_CODES.ORDER_INVALID_STATE,
      `Order ${existing.id} is ${existing.status}`,
    );
  }

  if (ctx.provider.verifyTransaction) {
    await ctx.provider.verifyTransaction({
      amount: notification.amount,
      currency: notification.currency,
      orderId: notification.orderId,
      providerTransactionId: notification.providerTransactionId,
    });
  }

  const updated = await markOrderPaid(ctx, {
    id: notification.orderId,
    providerData: {
      lastNotification: notification.raw,
      providerMethodId: notification.providerMethodId ?? null,
    },
    providerTransactionId: notification.providerTransactionId,
  });

  const paidOrder = updated ?? (await ctx.store.getOrder(notification.orderId));

  if (!paidOrder || paidOrder.status !== "paid") {
    throw PolrError.from("CONFLICT", POLR_ERROR_CODES.ORDER_INVALID_STATE);
  }

  if (updated) {
    await emitEvent(ctx, "order.paid", { order: toEventPayload(updated) });
  }

  await processPaidOrderHook(ctx, paidOrder);
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
      await failWebhookOrder(ctx, { error, orderId: notification.orderId });
      throw error;
    }

    return { received: true };
  });
}
