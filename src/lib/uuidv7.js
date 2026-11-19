// Client-generated UUIDv7, preserving the product's offline-first identity convention.
export function uuidv7(now = Date.now(), randomBytes = null) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new RangeError('UUIDv7 timestamp must fit in 48 bits.');
  }

  const bytes = randomBytes ? new Uint8Array(randomBytes) : new Uint8Array(16);
  if (!randomBytes) {
    if (!globalThis.crypto?.getRandomValues) throw new Error('Secure random generator is unavailable.');
    globalThis.crypto.getRandomValues(bytes);
  }
  if (bytes.length !== 16) throw new RangeError('UUIDv7 requires exactly 16 random bytes.');

  bytes[0] = Math.floor(now / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(now / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(now / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(now / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
