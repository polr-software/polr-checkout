const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MAX_RANDOM_BYTE = 256 - (256 % ID_ALPHABET.length);

function getCrypto(): Crypto {
  const crypto = globalThis.crypto;
  if (!crypto) {
    throw new Error("Web Crypto API is not available in this runtime");
  }
  return crypto;
}

function generateRandomString(length: number): string {
  let result = "";
  const bufferSize = length + 16;

  while (result.length < length) {
    const bytes = getCrypto().getRandomValues(new Uint8Array(bufferSize));
    for (const byte of bytes) {
      if (byte < MAX_RANDOM_BYTE) {
        result += ID_ALPHABET[byte % ID_ALPHABET.length]!;
        if (result.length === length) return result;
      }
    }
  }

  return result;
}

export function generateId(prefix: string, length: number = 24): string {
  return `${prefix}_${generateRandomString(length)}`;
}

export function generateOrderId(): string {
  return getCrypto().randomUUID();
}
