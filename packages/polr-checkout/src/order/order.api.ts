import * as z from "zod";

import { definePolrMethod } from "../api/define-route";
import { PolrError, POLR_ERROR_CODES } from "../core/errors";
import {
  cancelOrder as cancelOrderService,
  getOrder as getOrderService,
  resolveShipping as resolveShippingService,
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
    }),
    route: {
      method: "POST",
      path: "/shipping/resolve",
    },
  },
  async (ctx) => resolveShippingService(ctx.polr, ctx.input),
);
