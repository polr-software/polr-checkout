import type { PolrContext } from "../core/context";
import type {
  CancelOrderInput,
  CancelOrderResult,
  CreateOrderInput,
  CreateOrderResult,
  GetOrderResult,
  ListOrdersInput,
  ListOrdersResult,
  ResolveShippingInput,
  ResolveShippingResult,
} from "../order/order.service";
import type { PolrOptions } from "./options";

export interface PolrInstance<TOptions extends PolrOptions = PolrOptions> {
  options: TOptions;
  handler: (request: Request) => Promise<Response>;

  createOrder: (input: CreateOrderInput) => Promise<CreateOrderResult>;
  getOrder: (id: string) => Promise<GetOrderResult | null>;
  listOrders: (input?: ListOrdersInput) => Promise<ListOrdersResult>;
  cancelOrder: (input: CancelOrderInput) => Promise<CancelOrderResult>;
  resolveShipping: (input: ResolveShippingInput) => Promise<ResolveShippingResult | null>;

  $context: Promise<PolrContext>;
}
