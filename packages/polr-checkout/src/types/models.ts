import type { order, refund, webhookEvent } from "../database/schema";

export type StoredOrder = typeof order.$inferSelect;
export type NewStoredOrder = typeof order.$inferInsert;
export type StoredRefund = typeof refund.$inferSelect;
export type NewStoredRefund = typeof refund.$inferInsert;
export type StoredWebhookEvent = typeof webhookEvent.$inferSelect;

export type OrderStatus =
  | "pending"
  | "paid"
  | "failed"
  | "expired"
  | "cancelled"
  | "partially_refunded"
  | "refunded";

export type RefundStatus = "pending" | "completed" | "rejected";

export interface OrderItem {
  id?: string;
  name: string;
  quantity: number;
  unitAmount: number;
  metadata?: Record<string, string>;
}

export interface OrderCustomer {
  email: string;
  name: string;
  phone?: string | null;
  address?: {
    line1: string;
    postalCode: string;
    city: string;
    country?: string;
  } | null;
}

export interface OrderShippingSnapshot {
  amount: number;
  label: string;
  zoneId?: string | number;
  address?: OrderCustomer["address"];
}
