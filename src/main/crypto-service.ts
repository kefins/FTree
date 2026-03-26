import crypto from 'crypto';
import { CRYPTO } from '../shared/constants';

/**
 * 使用 PBKDF2 从密码派生加密密钥
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(
    password,
    salt,
    CRYPTO.PBKDF2_ITERATIONS,
    CRYPTO.KEY_LENGTH,
    CRYPTO.DIGEST
  );
}

/**
 * AES-256-GCM 加密
 */
export function encrypt(
  data: string,
  key: Buffer
): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(CRYPTO.IV_LENGTH);
  const cipher = crypto.createCipheriv(CRYPTO.ALGORITHM, key, iv, {
    authTagLength: CRYPTO.TAG_LENGTH,
  });

  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * AES-256-GCM 解密
 */
export function decrypt(
  encrypted: string,
  iv: string,
  tag: string,
  key: Buffer
): string {
  const decipher = crypto.createDecipheriv(
    CRYPTO.ALGORITHM,
    key,
    Buffer.from(iv, 'hex'),
    { authTagLength: CRYPTO.TAG_LENGTH }
  );
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * 密码哈希（使用 PBKDF2 + 随机盐）
 */
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(CRYPTO.SALT_LENGTH);
  const hash = crypto.pbkdf2Sync(
    password,
    salt,
    CRYPTO.PBKDF2_ITERATIONS,
    CRYPTO.KEY_LENGTH,
    CRYPTO.DIGEST
  );
  return {
    hash: hash.toString('hex'),
    salt: salt.toString('hex'),
  };
}

/**
 * 验证密码
 */
export function verifyPassword(
  password: string,
  hash: string,
  salt: string
): boolean {
  const derived = crypto.pbkdf2Sync(
    password,
    Buffer.from(salt, 'hex'),
    CRYPTO.PBKDF2_ITERATIONS,
    CRYPTO.KEY_LENGTH,
    CRYPTO.DIGEST
  );
  return crypto.timingSafeEqual(derived, Buffer.from(hash, 'hex'));
}
