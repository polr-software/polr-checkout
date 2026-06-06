export interface NormalizedCustomer {
  email: string;
  name: string;
  phone?: string | null;
  address?: NormalizedAddress | null;
}

export interface NormalizedAddress {
  line1: string;
  postalCode: string;
  city: string;
  country?: string;
}

export interface ProviderTransactionItem {
  id?: string;
  name: string;
  quantity: number;
  unitAmount: number;
}

export interface ProviderTransactionInput {
  orderId: string;
  amount: number;
  currency: string;
  description: string;
  customer: NormalizedCustomer;
  items: readonly ProviderTransactionItem[];
  shipping: { amount: number; label: string } | null;
  returnUrl: string;
  statusUrl: string;
  metadata?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
}

export interface ProviderTransactionResult {
  paymentUrl: string;
  providerTransactionId?: string | null;
  providerData?: Record<string, unknown>;
}

export interface NormalizedPaymentNotification {
  kind: "payment";
  /**
   * Stable identifier of this provider event. Used for idempotency in the
   * `polr_webhook_event` table. If the provider doesn't supply one, the
   * provider adapter should synthesise a deterministic value (e.g.
   * `${orderId}:${providerTransactionId}`).
   */
  providerEventId: string;
  orderId: string;
  providerTransactionId: string;
  amount: number;
  currency: string;
  providerMethodId?: string | number | null;
  raw: Record<string, unknown>;
}

export interface NormalizedRefundNotification {
  kind: "refund";
  /** Stable identifier of this refund event. Used for webhook idempotency. */
  providerEventId: string;
  orderId: string;
  providerTransactionId: string;
  /** The polr refund id (provider `refundsUuid`). */
  refundId: string;
  amount: number;
  currency: string;
  status: "completed" | "rejected";
  raw: Record<string, unknown>;
}

/** A provider notification, discriminated by `kind`. */
export type NormalizedNotification = NormalizedPaymentNotification | NormalizedRefundNotification;

export interface ProviderVerifyInput {
  orderId: string;
  providerTransactionId: string;
  amount: number;
  currency: string;
}

export interface ProviderSyncTransactionInput {
  orderId: string;
  amount: number;
  currency: string;
  providerTransactionId?: string | null;
  providerData?: Record<string, unknown>;
  closeIfUnpaid?: boolean;
}

export interface ProviderSyncTransactionResult {
  status: "pending" | "paid" | "failed";
  amount?: number;
  currency?: string;
  providerTransactionId?: string | null;
  providerData?: Record<string, unknown>;
  error?: string | null;
}

export interface ProviderRefundInput {
  orderId: string;
  providerTransactionId: string;
  /** polr-generated id, sent to the provider for idempotency (P24 `refundsUuid`). */
  refundId: string;
  amount: number;
  currency: string;
  reason?: string;
  /** URL the provider should call with the async refund notification. */
  statusUrl?: string;
}

export interface ProviderRefundResult {
  refundId: string;
  status: "pending" | "completed" | "rejected";
  providerData?: Record<string, unknown>;
}

export interface ProviderSyncRefundInput {
  orderId: string;
  providerTransactionId: string;
  refundId: string;
}

export interface ProviderSyncRefundResult {
  status: "pending" | "completed" | "rejected" | "unknown";
  amount?: number;
  providerData?: Record<string, unknown>;
}

export interface ProviderCheckResult {
  ok: boolean;
  mode: string;
  displayName?: string;
  error?: string;
}

export interface PaymentProvider {
  readonly id: string;
  readonly name: string;

  createTransaction(input: ProviderTransactionInput): Promise<ProviderTransactionResult>;

  parseNotification(input: {
    body: string;
    headers: Record<string, string>;
  }): Promise<NormalizedNotification>;

  /** Second-step verification (e.g. Przelewy24 PUT /transaction/verify). */
  verifyTransaction?(input: ProviderVerifyInput): Promise<void>;

  /** Syncs local order state from provider state when no webhook is available yet. */
  syncTransaction?(input: ProviderSyncTransactionInput): Promise<ProviderSyncTransactionResult>;

  /** Initiates a refund (e.g. Przelewy24 POST /transaction/refund). */
  refund?(input: ProviderRefundInput): Promise<ProviderRefundResult>;

  /** Reconciles refund state from the provider when no notification arrived. */
  syncRefund?(input: ProviderSyncRefundInput): Promise<ProviderSyncRefundResult>;

  check?(): Promise<ProviderCheckResult>;
}

export interface PolrProviderConfig {
  id: string;
  name: string;
  createAdapter(): PaymentProvider;
}
