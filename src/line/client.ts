import type { Env } from '../types';

const API = 'https://api.line.me/v2/bot';

export interface LineMessage {
  type: string;
  [k: string]: unknown;
}

async function call(env: Env, path: string, body: unknown): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = `${res.status} ${await res.text()}`;
    console.error('LINE API error', path, detail);
    return { ok: false, detail };
  }
  return { ok: true, detail: '' };
}

/**
 * ถ้า LINE ปฏิเสธข้อความ (เช่น การ์ด Flex ผิดสเปก) ผู้ใช้จะไม่เห็นอะไรเลย
 * และเราจะไม่รู้ว่าเกิดอะไรขึ้น — ตรงนี้จะลองส่งใหม่เป็นข้อความธรรมดาแทน
 */
async function send(
  env: Env,
  path: string,
  envelope: Record<string, unknown>,
  messages: LineMessage[],
): Promise<void> {
  const clipped = messages.slice(0, 5);
  const first = await call(env, path, { ...envelope, messages: clipped });
  if (first.ok) return;

  const flat = clipped.map((m) => m.altText).filter(Boolean).join('\n');
  const text = flat || 'ขออภัยครับ ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้งนะครับ';
  const retry = clipped.some((m) => m.type !== 'text')
    ? await call(env, path, { ...envelope, messages: [{ type: 'text', text: text.slice(0, 5000) }] })
    : null;
  if (retry && !retry.ok) console.error('fallback text also failed', retry.detail);
}

export function reply(env: Env, replyToken: string, messages: LineMessage[]): Promise<void> {
  return send(env, '/message/reply', { replyToken }, messages);
}

export function push(env: Env, to: string, messages: LineMessage[]): Promise<void> {
  return send(env, '/message/push', { to }, messages);
}

export async function getProfile(
  env: Env,
  userId: string,
): Promise<{ displayName?: string; pictureUrl?: string } | null> {
  try {
    const res = await fetch(`${API}/profile/${userId}`, {
      headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as { displayName?: string; pictureUrl?: string };
  } catch {
    return null;
  }
}

/** ตรวจลายเซ็น x-line-signature (HMAC-SHA256 ของ raw body, base64) */
export async function verifySignature(secret: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
