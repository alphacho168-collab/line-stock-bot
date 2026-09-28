import { Hono } from 'hono';
import type { Env } from './types';
import { api } from './api/routes';
import { verifySignature } from './line/client';
import { handleEvent, simulate } from './line/handler';
import * as repo from './db/repo';
import { AppError } from './lib/util';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.json({ ok: true, service: 'line-stock' }));

/* ------------------------------------------------------------ รูปสินค้า */

/**
 * เสิร์ฟรูปสินค้าเป็นลิงก์ https สำหรับให้ LINE แสดงในการ์ด
 * LINE ไม่ยอมรับ base64 ใน Flex Message — ต้องเป็น URL เท่านั้น
 * เปิดสาธารณะ (LINE โหลดรูปโดยไม่ส่ง token มาด้วย) แต่รูปสินค้าไม่ใช่ข้อมูลลับ
 */
app.get('/photo/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.text('ไม่พบรูป', 404);
  const row = await c.env.DB
    .prepare('SELECT photo FROM products WHERE id = ? AND active = 1')
    .bind(id)
    .first<{ photo: string | null }>();
  const m = row?.photo ? /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(row.photo) : null;
  if (!m) return c.text('ไม่พบรูป', 404);
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: {
      'content-type': m[1],
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    },
  });
});

/* ------------------------------------------------------- LINE webhook */

app.post('/line/webhook', async (c) => {
  const raw = await c.req.text();
  const signature = c.req.header('x-line-signature') ?? null;

  const valid = await verifySignature(c.env.LINE_CHANNEL_SECRET, raw, signature);
  if (!valid) {
    console.warn('ลายเซ็น webhook ไม่ถูกต้อง');
    return c.text('invalid signature', 401);
  }

  const body = JSON.parse(raw || '{}') as { events?: any[] };
  const events = body.events ?? [];

  // ตอบ 200 ทันทีตามที่ LINE ต้องการ แล้วประมวลผลต่อเบื้องหลัง
  const origin = new URL(c.req.url).origin;
  c.executionCtx.waitUntil(
    (async () => {
      for (const event of events) {
        try {
          if (event.webhookEventId && (await repo.isDuplicateEvent(c.env.DB, event.webhookEventId))) continue;
          await handleEvent(c.env, event, origin);
        } catch (err) {
          console.error('handleEvent error', err);
        }
      }
      if (Math.random() < 0.05) await repo.purgeOldEvents(c.env.DB).catch(() => {});
    })(),
  );

  return c.text('OK');
});

/* จำลองบทสนทนาไว้ทดสอบตอนพัฒนา — ปิดสนิทบน production */
app.post('/line/simulate', async (c) => {
  if (c.env.ENVIRONMENT !== 'dev') return c.json({ error: 'ไม่พบเส้นทางนี้' }, 404);
  const body = await c.req.json<{ user?: string; text?: string; postback?: string }>();
  const messages = await simulate(c.env, body.user ?? 'Utest0000000000000000000000000001', body, new URL(c.req.url).origin);
  return c.json({ messages });
});

/* ------------------------------------------------------------ REST API */

app.route('/api', api);

app.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: err.message }, err.status as 400);
  console.error('unhandled error', err);
  return c.json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }, 500);
});

/* หน้า LIFF (ไฟล์ static ถูกเสิร์ฟโดย assets binding อยู่แล้ว) */
app.notFound(async (c) => {
  if (c.req.path.startsWith('/api') || c.req.path.startsWith('/line')) {
    return c.json({ error: 'ไม่พบเส้นทางนี้' }, 404);
  }
  const url = new URL(c.req.url);
  url.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
});

export default app;

/* ------------------------------------------------------- Backup cron */

export async function scheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext
) {
  const date = new Date().toISOString();
  console.log(`[Scheduled Backup] ${date} - Starting D1 backup check`);

  try {
    const tables = [
      { name: 'products', query: 'SELECT COUNT(*) AS c FROM products' },
      { name: 'locations', query: 'SELECT COUNT(*) AS c FROM locations' },
      { name: 'stock_levels', query: 'SELECT COUNT(*) AS c FROM stock_levels' },
      { name: 'movements', query: 'SELECT COUNT(*) AS c FROM movements' },
    ];

    const results: Record<string, number> = {};
    for (const t of tables) {
      const res = await env.DB.prepare(t.query).all<{ c: number }>();
      results[t.name] = res.results?.[0]?.c || 0;
    }

    console.log(`[Backup OK] ${date}:`, JSON.stringify(results));
  } catch (err) {
    console.error(`[Backup FAILED] ${date}:`, err);
  }
}
