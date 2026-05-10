import type { OrderCustomer, OrderItem, OrderShippingSnapshot, OrderStatus } from "./models";

export interface PolrOrderEventPayload {
  id: string;
  status: OrderStatus;
  amount: number;
  subtotal: number;
  currency: string;
  description: string;
  customer: OrderCustomer;
  items: readonly OrderItem[];
  shipping: OrderShippingSnapshot | null;
  metadata: Record<string, string>;
  providerId: string;
  providerTransactionId: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface PolrEventMap {
  "order.created": { order: PolrOrderEventPayload };
  "order.paid": { order: PolrOrderEventPayload };
  "order.failed": { order: PolrOrderEventPayload; error: string | null };
}

export type PolrEventName = keyof PolrEventMap;

export type PolrEventHandlers = {
  [TName in PolrEventName]?: (event: {
    name: TName;
    payload: PolrEventMap[TName];
  }) => Promise<void> | void;
} & {
  "*"?: (input: {
    event: { name: PolrEventName; payload: PolrEventMap[PolrEventName] };
  }) => Promise<void> | void;
};
