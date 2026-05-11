export { createCheckout, isPolrInstance } from "./core/create-checkout";
export { PolrError, POLR_ERROR_CODES } from "./core/errors";
export type { PolrErrorCode } from "./core/errors";
export { defineErrorCodes } from "./core/error-codes";
export type { RawError } from "./core/error-codes";
export { generateId } from "./core/utils";

export { definePolrMethod, createPolrEndpoint } from "./api/define-route";

export type { PolrInstance } from "./types/instance";
export type { PolrLoggingOptions, PolrOptions } from "./types/options";
export type {
  PolrEventHandlers,
  PolrEventMap,
  PolrEventName,
  PolrHooks,
  PolrOrderEventPayload,
} from "./types/events";
export type {
  NewStoredOrder,
  OrderCustomer,
  OrderItem,
  OrderShippingSnapshot,
  OrderStatus,
  StoredOrder,
  StoredWebhookEvent,
} from "./types/models";

export type {
  CancelOrderInput,
  CancelOrderResult,
  CreateOrderInput,
  CreateOrderResult,
  GetOrderResult,
  ListOrdersInput,
  ListOrdersResult,
  ResolveShippingInput,
  ResolveShippingResult,
  SyncOrderInput,
  SyncOrderResult,
} from "./order/order.service";

export type {
  NormalizedAddress,
  NormalizedCustomer,
  NormalizedNotification,
  PaymentProvider,
  PolrProviderConfig,
  ProviderCheckResult,
  ProviderRefundInput,
  ProviderRefundResult,
  ProviderSyncTransactionInput,
  ProviderSyncTransactionResult,
  ProviderTransactionInput,
  ProviderTransactionItem,
  ProviderTransactionResult,
  ProviderVerifyInput,
} from "./providers/provider";

export type { ShippingInput, ShippingResolver, ShippingResult } from "./shipping/shipping";
export { fixedShipping } from "./shipping/fixed-shipping";
export type { FixedShippingOptions } from "./shipping/fixed-shipping";
export { customShipping } from "./shipping/custom-shipping";
export type { CustomShippingOptions } from "./shipping/custom-shipping";
export { zoneShipping, isPointInPolygon } from "./shipping/zone-shipping/index";
export type {
  ZoneGeometry,
  ZoneShippingOptions,
  ZoneShippingZone,
} from "./shipping/zone-shipping/index";
export { geoapify } from "./shipping/zone-shipping/geocoders/geoapify";
export type { Geocoder, GeoapifyOptions } from "./shipping/zone-shipping/geocoders/geoapify";

export { drizzleDatabase } from "./database/index";
export type { PolrDatabase, PolrDatabaseAdapter, PolrStore } from "./database/index";
