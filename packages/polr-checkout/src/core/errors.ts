import { APIError } from "better-call/error";

import { defineErrorCodes, type RawError } from "./error-codes";

export const POLR_ERROR_CODES = defineErrorCodes({
  PROVIDER_REQUIRED: "A provider is required",
  PROVIDER_INVALID_CONFIG: "Provider config is invalid",
  PROVIDER_SIGNATURE_INVALID: "Provider webhook signature is invalid",
  PROVIDER_SIGNATURE_MISSING: "Provider webhook signature is missing",
  PROVIDER_TRANSACTION_FAILED: "Provider transaction request failed",
  PROVIDER_VERIFY_FAILED: "Provider transaction verification failed",
  PROVIDER_WEBHOOK_INVALID: "Provider webhook payload is invalid",
  PROVIDER_MERCHANT_MISMATCH: "Provider webhook came from a different merchant",

  ORDER_NOT_FOUND: "Order not found",
  ORDER_AMOUNT_MISMATCH: "Provider notification amount does not match order",
  ORDER_CURRENCY_MISMATCH: "Provider notification currency does not match order",
  ORDER_ALREADY_PAID: "Order has already been marked paid",
  ORDER_INVALID_STATE: "Order is in a state that cannot be transitioned",

  AMOUNT_INVALID: "Order amount is invalid (must be a positive integer in minor units)",
  AMOUNT_BELOW_MINIMUM: "Order total is below the configured minimum",
  ITEMS_REQUIRED: "At least one item is required to create an order",
  ITEMS_INVALID: "Order items are invalid",
  CUSTOMER_REQUIRED: "Customer email and name are required",

  SHIPPING_ADDRESS_REQUIRED: "A delivery address is required to resolve shipping",
  SHIPPING_NOT_AVAILABLE: "Shipping is not available for the provided address",
  SHIPPING_RESOLVER_MISSING: "shipping resolver is not configured",

  BASEPATH_INVALID: "basePath must start with a leading slash",
  RETURN_URL_REQUIRED: "A returnUrl is required when this method is called without a request context",
});

export type PolrErrorCode = keyof typeof POLR_ERROR_CODES;

type APIErrorStatus = ConstructorParameters<typeof APIError>[0];

export class PolrError extends APIError {
  code: string;

  constructor(status: APIErrorStatus, error: RawError, message?: string) {
    super(status, {
      message: message ?? error.message,
      code: error.code,
    });
    this.code = error.code;
    this.name = "PolrError";
  }

  static from(status: APIErrorStatus, error: RawError, message?: string) {
    return new PolrError(status, error, message);
  }
}
