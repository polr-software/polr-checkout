import {
  index,
  integer,
  jsonb,
  pgTableCreator,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { OrderCustomer, OrderItem, OrderShippingSnapshot, OrderStatus } from "../types/models";

const pgTable = pgTableCreator((name) => `polr_${name}`);

const createdAt = timestamp("created_at")
  .notNull()
  .$defaultFn(() => new Date());
const updatedAt = timestamp("updated_at")
  .notNull()
  .$defaultFn(() => new Date())
  .$onUpdateFn(() => new Date());

export const order = pgTable(
  "order",
  {
    id: text("id").primaryKey(),
    status: text("status").$type<OrderStatus>().notNull().default("pending"),

    amount: integer("amount").notNull(),
    subtotal: integer("subtotal").notNull(),
    currency: text("currency").notNull(),
    description: text("description").notNull(),

    items: jsonb("items").$type<readonly OrderItem[]>().notNull().default([]),

    shipping: jsonb("shipping").$type<OrderShippingSnapshot | null>(),

    customer: jsonb("customer").$type<OrderCustomer>().notNull(),

    providerId: text("provider_id").notNull(),
    providerTransactionId: text("provider_transaction_id"),
    providerData: jsonb("provider_data").$type<Record<string, unknown>>().notNull().default({}),

    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    returnUrl: text("return_url"),

    error: text("error"),
    paidAt: timestamp("paid_at"),
    expiresAt: timestamp("expires_at"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("polr_order_status_created_idx").on(table.status, table.createdAt),
    index("polr_order_provider_idx").on(table.providerId, table.providerTransactionId),
  ],
);

export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull(),
    error: text("error"),
    traceId: text("trace_id"),
    receivedAt: timestamp("received_at").notNull(),
    processedAt: timestamp("processed_at"),
  },
  (table) => [
    uniqueIndex("polr_webhook_event_provider_unique").on(table.providerId, table.providerEventId),
    index("polr_webhook_event_status_idx").on(table.providerId, table.status),
  ],
);
