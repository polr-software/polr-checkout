import type { PolrContext } from "../core/context";
import type {
  CancelOrderInput,
  CancelOrderResult,
  CreateOrderInput,
  CreateOrderResult,
  GetOrderResult,
  ListOrdersInput,
  ListOrdersResult,
  ListRefundsInput,
  ListRefundsResult,
  RefundOrderInput,
  RefundOrderResult,
  ResolveShippingInput,
  ResolveShippingResult,
  SyncOrderInput,
  SyncOrderResult,
  SyncRefundInput,
} from "../order/order.service";
import type { StoredRefund } from "./models";
import type { PolrOptions } from "./options";

export interface PolrInstance<TOptions extends PolrOptions = PolrOptions> {
  options: TOptions;
  handler: (request: Request) => Promise<Response>;

  createOrder: (input: CreateOrderInput) => Promise<CreateOrderResult>;
  getOrder: (id: string) => Promise<GetOrderResult | null>;
  listOrders: (input?: ListOrdersInput) => Promise<ListOrdersResult>;
  /** Syncs a pending local order with the payment provider. May update order state. */
  syncOrder: (input: SyncOrderInput) => Promise<SyncOrderResult | null>;
  cancelOrder: (input: CancelOrderInput) => Promise<CancelOrderResult>;
  resolveShipping: (input: ResolveShippingInput) => Promise<ResolveShippingResult | null>;

  /** Initiates a refund (full or partial) for a paid order. */
  refundOrder: (input: RefundOrderInput) => Promise<RefundOrderResult>;
  getRefund: (id: string) => Promise<StoredRefund | null>;
  listRefunds: (input?: ListRefundsInput) => Promise<ListRefundsResult>;
  /** Reconciles a pending refund with the payment provider. */
  syncRefund: (input: SyncRefundInput) => Promise<StoredRefund | null>;

  $context: Promise<PolrContext>;
}
