import type { Env } from '../types';

const API = 'https://api.line.me/v2/bot';

export interface LineMessage {
  type: string;
  [k: string]: unknown;
}

async function call(env: Env, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('LINE API error', path, res.status, await res.text());
  }
}

export function reply(env: Env, replyToken: string, messages: LineMessage[]): Promise<void> {
  return call(env, '/message/reply', { replyToken, messages: messages.slice(0, 5) });
}

export function push(env: Env, to: string, messages: LineMessage[]): Promise<void> {
  return call(env, '/message/push', { to, messages: messages.slice(0, 5) });
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
