import {
  POLR_ERROR_CODES,
  PolrError,
  type NormalizedNotification,
  type NormalizedPaymentNotification,
  type NormalizedRefundNotification,
  type PaymentProvider,
  type PolrProviderConfig,
  type ProviderCheckResult,
  type ProviderRefundInput,
  type ProviderRefundResult,
  type ProviderSyncRefundInput,
  type ProviderSyncRefundResult,
  type ProviderSyncTransactionInput,
  type ProviderSyncTransactionResult,
  type ProviderTransactionInput,
  type ProviderTransactionResult,
  type ProviderVerifyInput,
} from "@polr-software/checkout";

import {
  createPrzelewy24Client,
  type Przelewy24Client,
  type Przelewy24Mode,
} from "./przelewy24-client";
import {
  notificationSign,
  refundNotificationSign,
  registrationSign,
  timingSafeEqualHex,
  verificationSign,
} from "./sign";

/** All credentials live with the constructor; nothing is read from env. */
export interface Przelewy24Options {
  merchantId: number;
  /** Defaults to `merchantId` when omitted. */
  posId?: number;
  crcKey: string;
  apiKey: string;
  /** Selects the sandbox or live API. Defaults to `live`. */
  mode?: Przelewy24Mode;
  /** Override the provider id (multiple Przelewy24 accounts in one app). */
  providerId?: string;
  /** Override the API base URL (tests). */
  apiUrl?: string;
  /** Defaults applied to every register call; overridable per order. */
  defaults?: Przelewy24Defaults;
}

export interface Przelewy24Defaults {
  channel?: number;
  timeLimit?: number;
  language?: string;
  country?: string;
  encoding?: string;
  waitForResult?: boolean;
  regulationAccept?: boolean;
}

const DEFAULT_DEFAULTS: Required<Przelewy24Defaults> = {
  channel: 16,
  timeLimit: 15,
  language: "pl",
  country: "PL",
  encoding: "UTF-8",
  waitForResult: true,
  regulationAccept: false,
};

const FIELD_LIMITS = {
  description: 1024,
  email: 50,
  client: 40,
  address: 80,
  zip: 10,
  city: 50,
  country: 2,
  phone: 12,
} as const;

interface RegisterResponse {
  data: { token: string };
  responseCode: 0;
}

interface VerifyResponse {
  data: { status: "success" };
  responseCode: 0;
}

type Przelewy24TransactionStatus = 0 | 1 | 2 | 3;

interface TransactionBySessionIdResponse {
  data: {
    amount: number;
    currency: string;
    orderId: number;
    paymentMethod?: number;
    sessionId: string;
    status: Przelewy24TransactionStatus;
  } & Record<string, unknown>;
  responseCode: 0;
}

interface RawNotification {
  merchantId: number;
  posId: number;
  sessionId: string;
  amount: number;
  originAmount: number;
  currency: string;
  orderId: number;
  methodId: number;
  statement: string;
  sign: string;
}

interface RawRefundNotification {
  merchantId: number;
  orderId: number;
  sessionId: string;
  refundsUuid: string;
  requestId?: string;
  amount: number;
  currency: string;
  timestamp?: number;
  status: number;
  sign: string;
}

interface RefundResponseItem {
  orderId: number;
  sessionId: string;
  amount: number;
  description?: string;
  status: boolean;
  message?: string;
}

interface RefundResponse {
  data: RefundResponseItem[];
  responseCode: 0;
}

interface RefundInfoItem {
  batchId?: number;
  requestId?: string;
  date?: string;
  login?: string;
  description?: string;
  status: number;
  amount: number;
}

interface RefundInfoResponse {
  data: {
    orderId: number;
    sessionId: string;
    amount: number;
    currency: string;
    refunds: RefundInfoItem[];
  };
  responseCode: 0;
}

function trim(value: string | null | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, max);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonObject(body: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.PROVIDER_WEBHOOK_INVALID, "Invalid JSON");
  }
  if (!isObject(parsed)) {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.PROVIDER_WEBHOOK_INVALID);
  }
  return parsed;
}

function assertRequiredFields(parsed: Record<string, unknown>, required: readonly string[]): void {
  for (const key of required) {
    if (parsed[key] === undefined) {
      throw PolrError.from(
        "BAD_REQUEST",
        POLR_ERROR_CODES.PROVIDER_WEBHOOK_INVALID,
        `Missing field "${key}"`,
      );
    }
  }
}

function isRefundNotificationPayload(parsed: Record<string, unknown>): boolean {
  return parsed.refundsUuid !== undefined || parsed.requestId !== undefined;
}

function parsePaymentNotificationPayload(parsed: Record<string, unknown>): RawNotification {
  assertRequiredFields(parsed, [
    "merchantId",
    "posId",
    "sessionId",
    "amount",
    "originAmount",
    "currency",
    "orderId",
    "methodId",
    "statement",
    "sign",
  ]);

  return {
    merchantId: Number(parsed.merchantId),
    posId: Number(parsed.posId),
    sessionId: String(parsed.sessionId),
    amount: Number(parsed.amount),
    originAmount: Number(parsed.originAmount),
    currency: String(parsed.currency),
    orderId: Number(parsed.orderId),
    methodId: Number(parsed.methodId),
    statement: String(parsed.statement),
    sign: String(parsed.sign),
  };
}

function parseRefundNotificationPayload(parsed: Record<string, unknown>): RawRefundNotification {
  assertRequiredFields(parsed, [
    "merchantId",
    "orderId",
    "sessionId",
    "refundsUuid",
    "amount",
    "currency",
    "status",
    "sign",
  ]);

  return {
    merchantId: Number(parsed.merchantId),
    orderId: Number(parsed.orderId),
    sessionId: String(parsed.sessionId),
    refundsUuid: String(parsed.refundsUuid),
    requestId: parsed.requestId !== undefined ? String(parsed.requestId) : undefined,
    amount: Number(parsed.amount),
    currency: String(parsed.currency),
    timestamp: parsed.timestamp !== undefined ? Number(parsed.timestamp) : undefined,
    status: Number(parsed.status),
    sign: String(parsed.sign),
  };
}

async function buildRegisterBody(
  options: Required<Pick<Przelewy24Options, "merchantId" | "crcKey">> & { posId: number },
  defaults: Required<Przelewy24Defaults>,
  input: ProviderTransactionInput,
): Promise<Record<string, unknown>> {
  const overrides = (input.providerOptions ?? {}) as Partial<Przelewy24Defaults> & {
    method?: number;
    transferLabel?: string;
  };
  const channel = overrides.channel ?? defaults.channel;
  const timeLimit = overrides.timeLimit ?? defaults.timeLimit;
  const language = overrides.language ?? defaults.language;
  const country = overrides.country ?? defaults.country;
  const encoding = overrides.encoding ?? defaults.encoding;
  const waitForResult = overrides.waitForResult ?? defaults.waitForResult;
  const regulationAccept = overrides.regulationAccept ?? defaults.regulationAccept;

  const cart = buildCart(input);

  const customer = input.customer;
  const address = customer.address;

  return omitUndefined({
    merchantId: options.merchantId,
    posId: options.posId,
    sessionId: input.orderId,
    amount: input.amount,
    currency: input.currency,
    description: trim(input.description, FIELD_LIMITS.description),
    email: trim(customer.email, FIELD_LIMITS.email),
    client: trim(customer.name, FIELD_LIMITS.client),
    address: trim(address?.line1, FIELD_LIMITS.address),
    zip: trim(address?.postalCode, FIELD_LIMITS.zip),
    city: trim(address?.city, FIELD_LIMITS.city),
    country: trim(address?.country ?? country, FIELD_LIMITS.country),
    phone: trim(customer.phone ?? undefined, FIELD_LIMITS.phone),
    language,
    method: overrides.method,
    urlReturn: input.returnUrl,
    urlStatus: input.statusUrl,
    timeLimit,
    channel,
    waitForResult,
    regulationAccept,
    shipping: input.shipping?.amount ?? undefined,
    transferLabel: overrides.transferLabel,
    encoding,
    cart,
    sign: await registrationSign({
      sessionId: input.orderId,
      merchantId: options.merchantId,
      amount: input.amount,
      currency: input.currency,
      crcKey: options.crcKey,
    }),
  });
}

function buildCart(input: ProviderTransactionInput): Array<Record<string, unknown>> {
  const items = input.items.map((item) => ({
    sellerId: item.id ?? "default",
    sellerCategory: "general",
    name: item.name,
    quantity: item.quantity,
    price: item.unitAmount,
  }));
  if (input.shipping) {
    items.push({
      sellerId: "shipping",
      sellerCategory: "shipping",
      name: input.shipping.label,
      quantity: 1,
      price: input.shipping.amount,
    });
  }
  return items;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function getEnvironment(mode: Przelewy24Mode): string {
  return mode === "sandbox" ? "sandbox" : "live";
}

function buildSyncProviderData(
  transaction: TransactionBySessionIdResponse["data"],
): Record<string, unknown> {
  return {
    lastStatusCheck: transaction,
    providerMethodId: transaction.paymentMethod ?? null,
  };
}

function mapTransactionStatus(
  input: ProviderSyncTransactionInput,
  transaction: TransactionBySessionIdResponse["data"] | null,
): ProviderSyncTransactionResult {
  if (!transaction) {
    return { status: "pending" };
  }

  const providerData = buildSyncProviderData(transaction);

  if (transaction.status === 2) {
    return {
      amount: transaction.amount,
      currency: transaction.currency,
      providerData,
      providerTransactionId: String(transaction.orderId),
      status: "paid",
    };
  }

  if (transaction.status === 3) {
    return {
      providerData,
      providerTransactionId: String(transaction.orderId),
      error: "Przelewy24 reported returned payment",
      status: "failed",
    };
  }

  if (transaction.status === 0 && input.closeIfUnpaid) {
    return {
      providerData,
      providerTransactionId: Number.isFinite(transaction.orderId)
        ? String(transaction.orderId)
        : input.providerTransactionId,
      error: "Przelewy24 reported no payment",
      status: "failed",
    };
  }

  return { providerData, status: "pending" };
}

export function createPrzelewy24Provider(
  options: Przelewy24Options,
  client: Przelewy24Client,
): PaymentProvider {
  const merchantId = options.merchantId;
  const posId = options.posId ?? options.merchantId;
  const crcKey = options.crcKey;
  const mode = options.mode ?? "live";
  const defaults = { ...DEFAULT_DEFAULTS, ...options.defaults };
  const id = options.providerId ?? "przelewy24";

  async function parsePaymentNotification(
    notification: RawNotification,
  ): Promise<NormalizedPaymentNotification> {
    if (notification.merchantId !== merchantId || notification.posId !== posId) {
      throw PolrError.from("UNAUTHORIZED", POLR_ERROR_CODES.PROVIDER_MERCHANT_MISMATCH);
    }

    const expected = await notificationSign({
      merchantId: notification.merchantId,
      posId: notification.posId,
      sessionId: notification.sessionId,
      amount: notification.amount,
      originAmount: notification.originAmount,
      currency: notification.currency,
      orderId: notification.orderId,
      methodId: notification.methodId,
      statement: notification.statement,
      crcKey,
    });
    if (!timingSafeEqualHex(notification.sign, expected)) {
      throw PolrError.from("UNAUTHORIZED", POLR_ERROR_CODES.PROVIDER_SIGNATURE_INVALID);
    }

    return {
      kind: "payment",
      providerEventId: `${notification.sessionId}:${notification.orderId}`,
      orderId: notification.sessionId,
      providerTransactionId: String(notification.orderId),
      amount: notification.amount,
      currency: notification.currency,
      providerMethodId: notification.methodId,
      raw: notification as unknown as Record<string, unknown>,
    };
  }

  async function parseRefundNotification(
    notification: RawRefundNotification,
  ): Promise<NormalizedRefundNotification> {
    if (notification.merchantId !== merchantId) {
      throw PolrError.from("UNAUTHORIZED", POLR_ERROR_CODES.PROVIDER_MERCHANT_MISMATCH);
    }

    const expected = await refundNotificationSign({
      orderId: notification.orderId,
      sessionId: notification.sessionId,
      refundsUuid: notification.refundsUuid,
      merchantId: notification.merchantId,
      amount: notification.amount,
      currency: notification.currency,
      status: notification.status,
      crcKey,
    });
    if (!timingSafeEqualHex(notification.sign, expected)) {
      throw PolrError.from("UNAUTHORIZED", POLR_ERROR_CODES.PROVIDER_SIGNATURE_INVALID);
    }

    return {
      kind: "refund",
      providerEventId: `refund:${notification.refundsUuid}:${notification.status}`,
      orderId: notification.sessionId,
      providerTransactionId: String(notification.orderId),
      refundId: notification.refundsUuid,
      amount: notification.amount,
      currency: notification.currency,
      status: notification.status === 0 ? "completed" : "rejected",
      raw: notification as unknown as Record<string, unknown>,
    };
  }

  return {
    id,
    name: "Przelewy24",

    async createTransaction(input): Promise<ProviderTransactionResult> {
      const body = await buildRegisterBody({ merchantId, posId, crcKey }, defaults, input);
      const result = await client.fetch<RegisterResponse>("/transaction/register", {
        method: "POST",
        body,
      });
      const token = result.data?.token;
      if (!token) {
        throw PolrError.from("BAD_GATEWAY", POLR_ERROR_CODES.PROVIDER_TRANSACTION_FAILED);
      }
      return {
        paymentUrl: client.trnRequestUrl(token),
        providerData: { token },
      };
    },

    async parseNotification({ body }): Promise<NormalizedNotification> {
      const parsed = parseJsonObject(body);
      if (isRefundNotificationPayload(parsed)) {
        return parseRefundNotification(parseRefundNotificationPayload(parsed));
      }
      return parsePaymentNotification(parsePaymentNotificationPayload(parsed));
    },

    async refund(input: ProviderRefundInput): Promise<ProviderRefundResult> {
      const orderIdNumber = Number(input.providerTransactionId);
      if (!Number.isFinite(orderIdNumber)) {
        throw PolrError.from(
          "BAD_REQUEST",
          POLR_ERROR_CODES.PROVIDER_REFUND_FAILED,
          `providerTransactionId is not numeric: ${input.providerTransactionId}`,
        );
      }

      const body = omitUndefined({
        requestId: input.refundId,
        refundsUuid: input.refundId,
        urlStatus: input.statusUrl,
        refunds: [
          omitUndefined({
            orderId: orderIdNumber,
            sessionId: input.orderId,
            amount: input.amount,
            description: trim(input.reason, 35),
          }),
        ],
      });

      let result: RefundResponse;
      try {
        result = await client.fetch<RefundResponse>("/transaction/refund", {
          method: "POST",
          body,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw PolrError.from("BAD_GATEWAY", POLR_ERROR_CODES.PROVIDER_REFUND_FAILED, message);
      }

      const item = result.data?.[0];
      if (!item || item.status !== true) {
        throw PolrError.from(
          "BAD_GATEWAY",
          POLR_ERROR_CODES.PROVIDER_REFUND_FAILED,
          item?.message ?? "Przelewy24 refund was not accepted",
        );
      }

      return {
        refundId: input.refundId,
        status: "pending",
        providerData: { refundResponse: result.data },
      };
    },

    async syncRefund(input: ProviderSyncRefundInput): Promise<ProviderSyncRefundResult> {
      const result = await client.fetch<RefundInfoResponse | null>(
        `/refund/by/orderId/${encodeURIComponent(input.providerTransactionId)}`,
        { notFoundOk: true },
      );

      const match = result?.data?.refunds?.find((entry) => entry.requestId === input.refundId);
      if (!match) {
        return { status: "unknown" };
      }

      const providerData = { lastRefundCheck: match };
      if (match.status === 1) {
        return { amount: match.amount, providerData, status: "completed" };
      }
      if (match.status === 4) {
        return { providerData, status: "rejected" };
      }
      return { providerData, status: "pending" };
    },

    async verifyTransaction(input: ProviderVerifyInput): Promise<void> {
      const orderIdNumber = Number(input.providerTransactionId);
      if (!Number.isFinite(orderIdNumber)) {
        throw PolrError.from(
          "BAD_REQUEST",
          POLR_ERROR_CODES.PROVIDER_VERIFY_FAILED,
          `providerTransactionId is not numeric: ${input.providerTransactionId}`,
        );
      }
      try {
        await client.fetch<VerifyResponse>("/transaction/verify", {
          method: "PUT",
          body: {
            merchantId,
            posId,
            sessionId: input.orderId,
            amount: input.amount,
            currency: input.currency,
            orderId: orderIdNumber,
            sign: await verificationSign({
              sessionId: input.orderId,
              orderId: orderIdNumber,
              amount: input.amount,
              currency: input.currency,
              crcKey,
            }),
          },
        });
      } catch (error) {
        if (error instanceof PolrError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw PolrError.from("BAD_GATEWAY", POLR_ERROR_CODES.PROVIDER_VERIFY_FAILED, message);
      }
    },

    async syncTransaction(
      input: ProviderSyncTransactionInput,
    ): Promise<ProviderSyncTransactionResult> {
      const result = await client.fetch<TransactionBySessionIdResponse | null>(
        `/transaction/by/sessionId/${encodeURIComponent(input.orderId)}`,
        {
          notFoundOk: true,
        },
      );

      return mapTransactionStatus(input, result?.data ?? null);
    },

    async check(): Promise<ProviderCheckResult> {
      const environment = getEnvironment(mode);
      try {
        // `/testAccess` returns `{data: true}` and has no `responseCode` field.
        const result = await client.fetch<{ data?: boolean }>("/testAccess", {
          skipResponseCode: true,
        });
        if (result?.data === true) {
          return { ok: true, mode: environment };
        }
        return {
          ok: false,
          mode: environment,
          error: `Unexpected /testAccess response: ${JSON.stringify(result)}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, mode: environment, error: message };
      }
    },
  };
}

export function przelewy24(options: Przelewy24Options): PolrProviderConfig {
  if (!Number.isInteger(options.merchantId) || options.merchantId <= 0) {
    throw PolrError.from(
      "BAD_REQUEST",
      POLR_ERROR_CODES.PROVIDER_INVALID_CONFIG,
      `przelewy24: merchantId must be a positive integer, got ${options.merchantId}`,
    );
  }
  if (!options.crcKey || !options.apiKey) {
    throw PolrError.from(
      "BAD_REQUEST",
      POLR_ERROR_CODES.PROVIDER_INVALID_CONFIG,
      "przelewy24: crcKey and apiKey are required",
    );
  }

  const id = options.providerId ?? "przelewy24";
  return {
    id,
    name: "Przelewy24",
    createAdapter() {
      const client = createPrzelewy24Client({
        posId: options.posId ?? options.merchantId,
        apiKey: options.apiKey,
        mode: options.mode,
        apiUrl: options.apiUrl,
      });
      return createPrzelewy24Provider(options, client);
    },
  };
}
