import * as z from "zod";

import { definePolrMethod } from "../api/define-route";
import { PolrError, POLR_ERROR_CODES } from "../core/errors";
import {
  cancelOrder as cancelOrderService,
  getOrder as getOrderService,
  getRefund as getRefundService,
  listRefunds as listRefundsService,
  refundOrder as refundOrderService,
  resolveShipping as resolveShippingService,
  syncRefund as syncRefundService,
} from "./order.service";

const idSchema = z.object({ id: z.string().min(1) });

export const getOrder = definePolrMethod(
  {
    input: idSchema,
    route: {
      method: "GET",
      path: "/orders/:id",
      resolveInput: (ctx) => ({ id: ctx.params?.id }),
    },
  },
  async (ctx) => {
    const order = await getOrderService(ctx.polr, ctx.input.id);
    if (!order) {
      throw PolrError.from("NOT_FOUND", POLR_ERROR_CODES.ORDER_NOT_FOUND);
    }
    return {
      id: order.id,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      paidAt: order.paidAt,
    };
  },
);

export const cancelOrder = definePolrMethod(
  {
    input: z.object({ id: z.string().min(1), reason: z.string().optional() }),
    route: {
      method: "POST",
      path: "/orders/:id/cancel",
      resolveInput: async (ctx) => ({
        id: ctx.params?.id,
        reason: ((await ctx.request?.json().catch(() => null)) as { reason?: string } | null)
          ?.reason,
      }),
    },
  },
  async (ctx) => cancelOrderService(ctx.polr, ctx.input),
);

export const refundOrder = definePolrMethod(
  {
    input: z.object({
      id: z.string().min(1),
      amount: z.number().int().positive().optional(),
      reason: z.string().optional(),
    }),
    route: {
      method: "POST",
      path: "/orders/:id/refund",
      resolveInput: async (ctx) => {
        const body = (await ctx.request?.json().catch(() => null)) as {
          amount?: number;
          reason?: string;
        } | null;
        return { id: ctx.params?.id, amount: body?.amount, reason: body?.reason };
      },
    },
  },
  async (ctx) => refundOrderService(ctx.polr, ctx.input),
);

export const listRefunds = definePolrMethod(
  {
    input: z.object({ orderId: z.string().optional() }),
    route: {
      method: "GET",
      path: "/orders/:id/refunds",
      resolveInput: (ctx) => ({ orderId: ctx.params?.id }),
    },
  },
  async (ctx) => listRefundsService(ctx.polr, ctx.input),
);

export const getRefund = definePolrMethod(
  {
    input: idSchema,
    route: {
      method: "GET",
      path: "/refunds/:id",
      resolveInput: (ctx) => ({ id: ctx.params?.id }),
    },
  },
  async (ctx) => {
    const refund = await getRefundService(ctx.polr, ctx.input.id);
    if (!refund) {
      throw PolrError.from("NOT_FOUND", POLR_ERROR_CODES.REFUND_NOT_FOUND);
    }
    return {
      id: refund.id,
      orderId: refund.orderId,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason,
      createdAt: refund.createdAt,
    };
  },
);

export const syncRefund = definePolrMethod(
  {
    route: {
      method: "POST",
      path: "/orders/:id/refunds/:refundId/sync",
      resolveInput: (ctx) => ({
        id: ctx.params?.id ?? "",
        refundId: ctx.params?.refundId ?? "",
      }),
    },
  },
  async (ctx) => syncRefundService(ctx.polr, ctx.input),
);

export const resolveShipping = definePolrMethod(
  {
    input: z.object({
      address: z
        .object({
          line1: z.string(),
          postalCode: z.string(),
          city: z.string(),
          country: z.string().optional(),
        })
        .nullish(),
      coordinates: z.object({ lat: z.number(), lng: z.number() }).nullish(),
      cart: z
        .array(
          z.object({
            id: z.string().optional(),
            quantity: z.number(),
            unitAmount: z.number(),
          }),
        )
        .optional(),
    }),
    route: {
      method: "POST",
      path: "/shipping/resolve",
    },
  },
  async (ctx) => resolveShippingService(ctx.polr, ctx.input),
);
