export function createIdempotencyKey(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes]
      .map((byte, index) => {
        const hex = byte.toString(16).padStart(2, '0');
        return [4, 6, 8, 10].includes(index) ? `-${hex}` : hex;
      })
      .join('');
  }

  return `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
