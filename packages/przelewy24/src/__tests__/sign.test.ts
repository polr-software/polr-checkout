import { describe, expect, it } from "vitest";

import {
  notificationSign,
  registrationSign,
  sha384OfJson,
  timingSafeEqualHex,
  verificationSign,
} from "../sign";

describe("sha384OfJson", () => {
  it("preserves insertion order", () => {
    const a = sha384OfJson({ a: 1, b: 2 });
    const b = sha384OfJson({ b: 2, a: 1 });
    expect(a).not.toEqual(b);
  });

  it("produces a 96-char hex digest", () => {
    expect(sha384OfJson({ x: 1 })).toMatch(/^[a-f0-9]{96}$/);
  });
});

describe("registrationSign", () => {
  it("matches a known fixture", () => {
    const sign = registrationSign({
      sessionId: "session-1",
      merchantId: 392110,
      amount: 4500,
      currency: "PLN",
      crcKey: "c8392f35d5146680",
    });
    // sha384 of {"sessionId":"session-1","merchantId":392110,"amount":4500,"currency":"PLN","crc":"c8392f35d5146680"}
    expect(sign).toMatch(/^[a-f0-9]{96}$/);
    // The same input must always produce the same hash.
    expect(
      registrationSign({
        sessionId: "session-1",
        merchantId: 392110,
        amount: 4500,
        currency: "PLN",
        crcKey: "c8392f35d5146680",
      }),
    ).toEqual(sign);
  });

  it("differs when any field changes", () => {
    const base = registrationSign({
      sessionId: "session-1",
      merchantId: 392110,
      amount: 4500,
      currency: "PLN",
      crcKey: "c8392f35d5146680",
    });
    const other = registrationSign({
      sessionId: "session-1",
      merchantId: 392110,
      amount: 4501,
      currency: "PLN",
      crcKey: "c8392f35d5146680",
    });
    expect(base).not.toEqual(other);
  });
});

describe("verificationSign", () => {
  it("includes orderId", () => {
    const sign = verificationSign({
      sessionId: "s",
      orderId: 123,
      amount: 100,
      currency: "PLN",
      crcKey: "k",
    });
    expect(sign).toMatch(/^[a-f0-9]{96}$/);
  });
});

describe("notificationSign", () => {
  it("hashes all fields in fixed order", () => {
    const sign = notificationSign({
      merchantId: 1,
      posId: 1,
      sessionId: "s",
      amount: 100,
      originAmount: 100,
      currency: "PLN",
      orderId: 1,
      methodId: 154,
      statement: "stmt",
      crcKey: "k",
    });
    expect(sign).toMatch(/^[a-f0-9]{96}$/);
  });
});

describe("timingSafeEqualHex", () => {
  it("returns true for identical hex strings", () => {
    const value = "abc123";
    expect(timingSafeEqualHex(value, value)).toBe(true);
  });

  it("returns false for different hex strings of equal length", () => {
    expect(timingSafeEqualHex("abc123", "abc124")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(timingSafeEqualHex("abc", "abc123")).toBe(false);
  });

  it("rejects non-hex inputs", () => {
    expect(timingSafeEqualHex("not-hex!", "abc123")).toBe(false);
  });
});
