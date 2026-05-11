function getSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API is not available in this runtime");
  }
  return subtle;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Hashes a P24 sign payload. Order of keys matters: P24 expects an exact
 * sequence (e.g. `{sessionId, merchantId, amount, currency, crc}` for
 * registration), so callers MUST pass an object whose insertion order matches
 * the spec - `JSON.stringify` is order-preserving.
 */
export async function sha384OfJson(value: object): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await getSubtleCrypto().digest("SHA-384", bytes);
  return toHex(digest);
}

export interface RegistrationSignParams {
  sessionId: string;
  merchantId: number;
  amount: number;
  currency: string;
  crcKey: string;
}

export function registrationSign(params: RegistrationSignParams): Promise<string> {
  return sha384OfJson({
    sessionId: params.sessionId,
    merchantId: params.merchantId,
    amount: params.amount,
    currency: params.currency,
    crc: params.crcKey,
  });
}

export interface VerificationSignParams {
  sessionId: string;
  orderId: number;
  amount: number;
  currency: string;
  crcKey: string;
}

export function verificationSign(params: VerificationSignParams): Promise<string> {
  return sha384OfJson({
    sessionId: params.sessionId,
    orderId: params.orderId,
    amount: params.amount,
    currency: params.currency,
    crc: params.crcKey,
  });
}

export interface NotificationSignParams {
  merchantId: number;
  posId: number;
  sessionId: string;
  amount: number;
  originAmount: number;
  currency: string;
  orderId: number;
  methodId: number;
  statement: string;
  crcKey: string;
}

export function notificationSign(params: NotificationSignParams): Promise<string> {
  return sha384OfJson({
    merchantId: params.merchantId,
    posId: params.posId,
    sessionId: params.sessionId,
    amount: params.amount,
    originAmount: params.originAmount,
    currency: params.currency,
    orderId: params.orderId,
    methodId: params.methodId,
    statement: params.statement,
    crc: params.crcKey,
  });
}

export function timingSafeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  if (left.length !== right.length) return false;

  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  let diff = 0;
  for (let i = 0; i < normalizedLeft.length; i += 1) {
    diff |= normalizedLeft.charCodeAt(i) ^ normalizedRight.charCodeAt(i);
  }
  return diff === 0;
}
