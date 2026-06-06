import type { PgDatabase } from "drizzle-orm/pg-core";

import type * as schema from "./schema";
import type {
  NewStoredOrder,
  NewStoredRefund,
  OrderStatus,
  RefundStatus,
  StoredOrder,
  StoredRefund,
} from "../types/models";

export type PolrDatabase = PgDatabase<any, typeof schema>;

export interface PolrDatabaseAdapter {
  store: PolrStore;
}

export interface ListStoredOrdersInput {
  status?: OrderStatus;
  limit?: number;
  before?: Date;
}

export interface ListStoredOrdersResult {
  orders: StoredOrder[];
  hasMore: boolean;
}

export interface ListStoredRefundsInput {
  orderId?: string;
  status?: RefundStatus;
  limit?: number;
  before?: Date;
}

export interface ListStoredRefundsResult {
  refunds: StoredRefund[];
  hasMore: boolean;
}

export interface SetRefundStatusInput {
  id: string;
  status: "completed" | "rejected";
  providerData?: Record<string, unknown>;
}

export interface SetRefundStatusResult {
  refund: StoredRefund;
  order: StoredOrder;
}

export interface BeginWebhookEventInput {
  payload: Record<string, unknown>;
  providerEventId: string;
  providerId: string;
  traceId?: string;
  type: string;
}

export interface FinishWebhookEventInput {
  error?: string;
  providerEventId: string;
  providerId: string;
  status: "failed" | "processed";
}

export interface PolrStore {
  createOrder(row: NewStoredOrder): Promise<StoredOrder>;
  getOrder(id: string): Promise<StoredOrder | null>;
  listOrders(input?: ListStoredOrdersInput): Promise<ListStoredOrdersResult>;
  setOrderCancelled(input: { id: string; reason?: string }): Promise<StoredOrder | null>;
  setOrderFailed(input: {
    id: string;
    error: string;
    providerData?: Record<string, unknown>;
    providerTransactionId?: string | null;
  }): Promise<StoredOrder | null>;
  setOrderPaid(input: {
    id: string;
    providerData?: Record<string, unknown>;
    providerTransactionId: string;
  }): Promise<StoredOrder | null>;
  createRefund(row: NewStoredRefund): Promise<StoredRefund>;
  getRefund(id: string): Promise<StoredRefund | null>;
  listRefunds(input?: ListStoredRefundsInput): Promise<ListStoredRefundsResult>;
  /**
   * Transitions a pending refund to `completed`/`rejected`. On `completed`,
   * increments the order's `refundedAmount` and recomputes its status. Returns
   * `null` when the refund was not pending (idempotent no-op).
   */
  setRefundStatus(input: SetRefundStatusInput): Promise<SetRefundStatusResult | null>;
  beginWebhookEvent(input: BeginWebhookEventInput): Promise<boolean>;
  finishWebhookEvent(input: FinishWebhookEventInput): Promise<void>;
}

export function createDatabase(adapter: PolrDatabaseAdapter): PolrStore {
  return adapter.store;
}
