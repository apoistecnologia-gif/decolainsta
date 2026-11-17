import crypto from 'node:crypto';

const VERSION = 'v2';

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('ENCRYPTION_KEY não configurada: defina uma chave aleatória com pelo menos 32 caracteres.');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

/** Authenticated encryption for OAuth tokens; never expose the value to browser clients. */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decrypt(value: string): string {
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Formato antigo de credencial não é aceito; reconecte o Instagram por OAuth.');
  }
  const [, iv64, tag64, ciphertext64] = parts;
  const iv = Buffer.from(iv64, 'base64url');
  const tag = Buffer.from(tag64, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Token criptografado inválido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ciphertext64, 'base64url')), decipher.final()]).toString('utf8');
}
