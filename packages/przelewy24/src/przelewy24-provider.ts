import {
  POLR_ERROR_CODES,
  PolrError,
  type NormalizedNotification,
  type PaymentProvider,
  type PolrProviderConfig,
  type ProviderCheckResult,
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
  mode: Przelewy24Mode;
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

function trim(value: string | null | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, max);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseNotificationPayload(body: string): RawNotification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.PROVIDER_WEBHOOK_INVALID, "Invalid JSON");
  }
  if (!isObject(parsed)) {
    throw PolrError.from("BAD_REQUEST", POLR_ERROR_CODES.PROVIDER_WEBHOOK_INVALID);
  }

  const required = [
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
  ] as const;
  for (const key of required) {
    if (parsed[key] === undefined) {
      throw PolrError.from(
        "BAD_REQUEST",
        POLR_ERROR_CODES.PROVIDER_WEBHOOK_INVALID,
        `Missing field "${key}"`,
      );
    }
  }

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

function buildRegisterBody(
  options: Required<Pick<Przelewy24Options, "merchantId" | "crcKey">> & { posId: number },
  defaults: Required<Przelewy24Defaults>,
  input: ProviderTransactionInput,
): Record<string, unknown> {
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
    sign: registrationSign({
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

export function createPrzelewy24Provider(
  options: Przelewy24Options,
  client: Przelewy24Client,
): PaymentProvider {
  const merchantId = options.merchantId;
  const posId = options.posId ?? options.merchantId;
  const crcKey = options.crcKey;
  const defaults = { ...DEFAULT_DEFAULTS, ...options.defaults };
  const id = options.providerId ?? "przelewy24";

  return {
    id,
    name: "Przelewy24",

    async createTransaction(input): Promise<ProviderTransactionResult> {
      const body = buildRegisterBody({ merchantId, posId, crcKey }, defaults, input);
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
      const notification = parseNotificationPayload(body);

      if (notification.merchantId !== merchantId || notification.posId !== posId) {
        throw PolrError.from("UNAUTHORIZED", POLR_ERROR_CODES.PROVIDER_MERCHANT_MISMATCH);
      }

      const expected = notificationSign({
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
        providerEventId: `${notification.sessionId}:${notification.orderId}`,
        orderId: notification.sessionId,
        providerTransactionId: String(notification.orderId),
        amount: notification.amount,
        currency: notification.currency,
        providerMethodId: notification.methodId,
        raw: notification as unknown as Record<string, unknown>,
      };
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
            sign: verificationSign({
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

    async check(): Promise<ProviderCheckResult> {
      const mode = getEnvironment(options.mode);
      try {
        await client.fetch("/testAccess");
        return { ok: true, mode };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, mode, error: message };
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
