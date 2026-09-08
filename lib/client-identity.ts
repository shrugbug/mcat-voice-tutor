import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

// Rate-limit identity only, NOT authorization. Invalidated by process restart.
const secret = randomBytes(32);
const lifetime = 24 * 60 * 60 * 1000;
const sign = (value: string) => createHmac('sha256', secret).update(value).digest('hex');

export function clientIp(request: Request): string {
  // Web Request exposes no socket peer. Enable only with a network-enforced,
  // single trusted nginx hop which overwrites XFF or appends the actual peer.
  if (process.env.TRUST_PROXY !== 'true') return 'unknown';
  const ip = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return ip && isIP(ip) ? ip : 'unknown';
}

export function sessionIdentity(request: Request): string | undefined {
  const token = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith('mcat_session='))?.slice(13);
  if (!token || token.length > 160) return;
  const parts = token.split('.');
  if (parts.length !== 3) return;
  const [id, expiry, signature] = parts;
  if (!/^[a-f0-9-]{36}$/.test(id) || !/^\d{13}$/.test(expiry) || !/^[a-f0-9]{64}$/.test(signature)) return;
  if (Number(expiry) <= Date.now()) return;
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(`${id}.${expiry}`), 'hex'))) return;
  return token;
}

export function sessionCookie(request: Request): string {
  const value = `${randomUUID()}.${Date.now() + lifetime}`;
  const token = sessionIdentity(request) ?? `${value}.${sign(value)}`;
  return `mcat_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export function toolClient(request: Request): string {
  return sessionIdentity(request) ? `session:${sessionIdentity(request)}` : `ip:${clientIp(request)}`;
}
