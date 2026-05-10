import { and, desc, eq, lt, sql } from "drizzle-orm";

import type { PolrContext } from "../core/context";
import { PolrError, POLR_ERROR_CODES } from "../core/errors";
import { generateOrderId } from "../core/utils";
import { order } from "../database/schema";
import type {
  NormalizedAddress,
  NormalizedCustomer,
  ProviderTransactionItem,
} from "../providers/provider";
import type { ShippingResult } from "../shipping/shipping";
import type { PolrEventName, PolrEventMap, PolrOrderEventPayload } from "../types/events";
import type {
  NewStoredOrder,
  OrderCustomer,
  OrderItem,
  OrderShippingSnapshot,
  OrderStatus,
  StoredOrder,
} from "../types/models";

export interface CreateOrderInput {
  description: string;
  currency?: string;
  items: ReadonlyArray<{
    id?: string;
    name: string;
    quantity: number;
    unitAmount: number;
    metadata?: Record<string, string>;
  }>;
  customer: {
    email: string;
    name: string;
    phone?: string | null;
    address?: NormalizedAddress | null;
  };
  shipping?: {
    mode: "delivery" | "pickup";
    address?: NormalizedAddress | null;
    coordinates?: { lat: number; lng: number } | null;
  };
  returnUrl: string;
  metadata?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
}

export interface CreateOrderResult {
  id: string;
  paymentUrl: string;
  amount: number;
  subtotal: number;
  currency: string;
  shipping: OrderShippingSnapshot | null;
}

export type GetOrderResult = StoredOrder;

export interface ListOrdersInput {
  status?: OrderStatus;
  limit?: number;
  before?: Date;
}

export interface ListOrdersResult {
  orders: StoredOrder[];
  hasMore: boolean;
}

export interface CancelOrderInput {
  id: string;
  reason?: string;
}

export interface CancelOrderResult {
  id: string;
  status: OrderStatus;
}

export interface ResolveShippingInput {
  address?: NormalizedAddress | null;
  coordinates?: { lat: number; lng: number } | null;
  cart?: ReadonlyArray<{ id?: string; quantity: number; unitAmount: number }>;
}

export type ResolveShippingResult = ShippingResult;

export async function createOrder(
  ctx: PolrContext,
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  return ctx.logger.trace.run("ord", async () => {
    if (!input.items || input.items.length === 0) {
      throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.ITEMS_REQUIRED);
    }
    const items = input.items.map(normalizeItem);
    const subtotal = items.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
    if (subtotal <= 0) {
      throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.AMOUNT_INVALID);
    }

    const customer = normalizeCustomer(input.customer);
    const currency = (input.currency ?? ctx.defaultCurrency).toUpperCase();
    const shipping = await resolveShippingForOrder(ctx, input);
    const amount = subtotal + (shipping?.amount ?? 0);

    if (amount < ctx.minOrderAmount) {
      throw PolrError.from(
        "BAD_REQUEST",
        POLR_ERROR_CODES.AMOUNT_BELOW_MINIMUM,
        `Order total ${amount} is below the minimum ${ctx.minOrderAmount}`,
      );
    }

    const id = generateOrderId();
    const returnUrl = applyOrderIdPlaceholder(input.returnUrl, id);
    const statusUrl = buildStatusUrl(ctx);
    const metadata = input.metadata ?? {};

    const transaction = await ctx.provider.createTransaction({
      orderId: id,
      amount,
      currency,
      description: input.description,
      customer,
      items: items as ProviderTransactionItem[],
      shipping: shipping ? { amount: shipping.amount, label: shipping.label } : null,
      returnUrl,
      statusUrl,
      metadata,
      providerOptions: input.providerOptions,
    });

    const orderRow: NewStoredOrder = {
      id,
      status: "pending",
      amount,
      subtotal,
      currency,
      description: input.description,
      items,
      shipping: shipping
        ? {
            amount: shipping.amount,
            label: shipping.label,
            zoneId: shipping.zoneId,
            address: input.shipping?.address ?? customer.address ?? null,
          }
        : null,
      customer,
      providerId: ctx.provider.id,
      providerTransactionId: transaction.providerTransactionId ?? null,
      providerData: {
        ...transaction.providerData,
        paymentUrl: transaction.paymentUrl,
      },
      metadata,
      returnUrl,
    };

    const [stored] = await ctx.database.insert(order).values(orderRow).returning();
    if (!stored) {
      throw new Error("Failed to insert order");
    }

    await emitEvent(ctx, "order.created", { order: toEventPayload(stored) });

    return {
      id: stored.id,
      paymentUrl: transaction.paymentUrl,
      amount: stored.amount,
      subtotal: stored.subtotal,
      currency: stored.currency,
      shipping: stored.shipping,
    };
  });
}

export async function getOrder(ctx: PolrContext, id: string): Promise<StoredOrder | null> {
  const row = await ctx.database.query.order.findFirst({ where: eq(order.id, id) });
  return row ?? null;
}

export async function listOrders(
  ctx: PolrContext,
  input: ListOrdersInput = {},
): Promise<ListOrdersResult> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const conditions = [];
  if (input.status) conditions.push(eq(order.status, input.status));
  if (input.before) conditions.push(lt(order.createdAt, input.before));

  const rows = await ctx.database
    .select()
    .from(order)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(order.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  return { orders: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

export async function cancelOrder(
  ctx: PolrContext,
  input: CancelOrderInput,
): Promise<CancelOrderResult> {
  const existing = await getOrder(ctx, input.id);
  if (!existing) {
    throw PolrError.from("NOT_FOUND", POLR_ERROR_CODES.ORDER_NOT_FOUND);
  }
  if (existing.status === "paid" || existing.status === "refunded") {
    throw PolrError.from("CONFLICT", POLR_ERROR_CODES.ORDER_INVALID_STATE);
  }
  const [updated] = await ctx.database
    .update(order)
    .set({
      status: "cancelled",
      error: input.reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(order.id, input.id))
    .returning();
  return { id: updated!.id, status: updated!.status };
}

export async function resolveShipping(
  ctx: PolrContext,
  input: ResolveShippingInput,
): Promise<ShippingResult | null> {
  if (!ctx.options.shipping) {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.SHIPPING_RESOLVER_MISSING);
  }
  return ctx.options.shipping.resolve(input);
}

export async function markOrderPaid(
  ctx: PolrContext,
  input: { id: string; providerTransactionId: string; providerData?: Record<string, unknown> },
): Promise<StoredOrder | null> {
  const now = new Date();
  const [updated] = await ctx.database
    .update(order)
    .set({
      status: "paid",
      providerTransactionId: input.providerTransactionId,
      providerData: sql`${order.providerData} || ${JSON.stringify(input.providerData ?? {})}::jsonb`,
      paidAt: now,
      updatedAt: now,
      error: null,
    })
    .where(and(eq(order.id, input.id), eq(order.status, "pending")))
    .returning();
  return updated ?? null;
}

export async function markOrderFailed(
  ctx: PolrContext,
  input: { id: string; error: string },
): Promise<StoredOrder | null> {
  const [updated] = await ctx.database
    .update(order)
    .set({ status: "failed", error: input.error, updatedAt: new Date() })
    .where(eq(order.id, input.id))
    .returning();
  return updated ?? null;
}

export function toEventPayload(row: StoredOrder): PolrOrderEventPayload {
  return {
    id: row.id,
    status: row.status,
    amount: row.amount,
    subtotal: row.subtotal,
    currency: row.currency,
    description: row.description,
    customer: row.customer,
    items: row.items,
    shipping: row.shipping,
    metadata: row.metadata,
    providerId: row.providerId,
    providerTransactionId: row.providerTransactionId,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  };
}

export async function emitEvent<TName extends PolrEventName>(
  ctx: PolrContext,
  name: TName,
  payload: PolrEventMap[TName],
): Promise<void> {
  const handlers = ctx.options.on;
  if (!handlers) return;

  const event = { name, payload } as { name: TName; payload: PolrEventMap[TName] };

  try {
    const direct = handlers[name];
    if (direct) await direct(event as never);
  } catch (error) {
    ctx.logger.error({ err: error, event: name }, "event handler failed");
  }

  try {
    const wildcard = handlers["*"];
    if (wildcard) {
      await wildcard({
        event: event as { name: PolrEventName; payload: PolrEventMap[PolrEventName] },
      });
    }
  } catch (error) {
    ctx.logger.error({ err: error, event: name }, "wildcard event handler failed");
  }
}

async function resolveShippingForOrder(
  ctx: PolrContext,
  input: CreateOrderInput,
): Promise<ShippingResult | null> {
  if (!input.shipping || input.shipping.mode === "pickup") return null;
  if (!ctx.options.shipping) {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.SHIPPING_RESOLVER_MISSING);
  }
  if (!input.shipping.address && !input.shipping.coordinates) {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.SHIPPING_ADDRESS_REQUIRED);
  }

  const result = await ctx.options.shipping.resolve({
    address: input.shipping.address ?? null,
    coordinates: input.shipping.coordinates ?? null,
    cart: input.items,
  });
  if (!result || !result.deliverable) {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.SHIPPING_NOT_AVAILABLE);
  }
  return result;
}

function normalizeItem(item: CreateOrderInput["items"][number]): OrderItem {
  if (!item.name || item.quantity <= 0 || !Number.isInteger(item.quantity)) {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.ITEMS_INVALID);
  }
  if (!Number.isInteger(item.unitAmount) || item.unitAmount < 0) {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.ITEMS_INVALID);
  }
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unitAmount: item.unitAmount,
    metadata: item.metadata,
  };
}

function normalizeCustomer(customer: CreateOrderInput["customer"]): OrderCustomer {
  if (!customer || !customer.email || !customer.name) {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.CUSTOMER_REQUIRED);
  }
  return {
    email: customer.email.trim(),
    name: customer.name.trim(),
    phone: customer.phone ?? null,
    address: customer.address ?? null,
  };
}

function buildStatusUrl(ctx: PolrContext): string {
  return `${ctx.basePath}/webhook/${ctx.provider.id}`;
}

function applyOrderIdPlaceholder(value: string, id: string): string {
  return value.replaceAll("{ORDER_ID}", id);
}

export { resolveShippingForOrder as _resolveShippingForOrder };
