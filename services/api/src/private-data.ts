import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function encryptionKey(): Buffer {
  const configured = process.env.DOMAIN_ENCRYPTION_KEY;
  if (configured) {
    if (!/^[a-fA-F0-9]{64}$/.test(configured)) throw new Error('DOMAIN_ENCRYPTION_KEY must be a 32-byte hex key');
    return Buffer.from(configured, 'hex');
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Production requires DOMAIN_ENCRYPTION_KEY');
  const path = resolve('../../.runtime/domain-encryption.key');
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error('Invalid local domain encryption key');
  return key;
}

export function encryptPrivate(value: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('hex')}:${body.toString('base64')}:${cipher.getAuthTag().toString('hex')}`;
}

export function decryptPrivate(value: string): string {
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^[a-f0-9]{24}$/.test(parts[1]!) || !/^[a-f0-9]{32}$/.test(parts[3]!)) throw new Error('Invalid encrypted personal data');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(parts[1]!, 'hex'));
  decipher.setAuthTag(Buffer.from(parts[3]!, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(parts[2]!, 'base64')), decipher.final()]).toString('utf8');
}

export function phoneLookup(phone: string): string {
  return createHmac('sha256', encryptionKey()).update('academy.phone:' + phone).digest('hex');
}

export function maskedPhone(user: { phone: string | null; phoneCipher?: string | null }): string | null {
  const phone = user.phoneCipher ? decryptPrivate(user.phoneCipher) : user.phone;
  return phone ? phone.slice(0, 3) + '****' + phone.slice(-4) : null;
}

type AddressData = { recipient: string; phone: string; detail: string; recipientCipher: string; phoneCipher: string; detailCipher: string };
export function personalAddress<T extends AddressData>(row: T) {
  const { recipientCipher, phoneCipher, detailCipher, ...safe } = row;
  return { ...safe, recipient: recipientCipher ? decryptPrivate(recipientCipher) : row.recipient, phone: phoneCipher ? decryptPrivate(phoneCipher) : row.phone, detail: detailCipher ? decryptPrivate(detailCipher) : row.detail };
}

export function orderAddress(value: unknown) {
  const row = value as Record<string, unknown>;
  return typeof row?.cipher === 'string' ? JSON.parse(decryptPrivate(row.cipher)) : value;
}
