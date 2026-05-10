import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

/**
 * Hashes a P24 sign payload. Order of keys matters: P24 expects an exact
 * sequence (e.g. `{sessionId, merchantId, amount, currency, crc}` for
 * registration), so callers MUST pass an object whose insertion order matches
 * the spec — `JSON.stringify` is order-preserving.
 */
export function sha384OfJson(value: object): string {
  return createHash("sha384").update(JSON.stringify(value), "utf8").digest("hex");
}

export interface RegistrationSignParams {
  sessionId: string;
  merchantId: number;
  amount: number;
  currency: string;
  crcKey: string;
}

export function registrationSign(params: RegistrationSignParams): string {
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

export function verificationSign(params: VerificationSignParams): string {
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

export function notificationSign(params: NotificationSignParams): string {
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
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  if (a.length !== b.length) return false;
  return nodeTimingSafeEqual(a, b);
}
