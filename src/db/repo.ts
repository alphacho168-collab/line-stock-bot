import type { Actor, Draft, DraftPayload, DraftStep, Location, MovementType, Product } from '../types';
import { AppError, makeRef, norm } from '../lib/util';

/**
 * SQLite (ตัวที่ D1 ใช้) จำกัดความยาวรูปแบบ LIKE ไว้ที่ 50 ไบต์
 * เกินนี้จะได้ error "LIKE or GLOB pattern too complex" ทั้งคำขอ — ไม่ใช่แค่ไม่เจอผลลัพธ์
 * ภาษาไทย 1 ตัวอักษร = 3 ไบต์ จึงเหลือราว 14 ตัวอักษร (เผื่อ `%` สองข้างไว้ด้วย)
 * ตัดแล้วยังค้นเจอ เพราะรูปแบบมี % ครอบอยู่แล้ว เช่นค้นว่า "น้ำยาทำความสะอาดพื้น"
 * จะถูกตัดเป็น "น้ำยาทำความสะ" ซึ่งยังเป็นส่วนหนึ่งของชื่อสินค้าเดิม
 */
const LIKE_MAX_BYTES = 44;

/** ตัดข้อความไม่ให้เกินจำนวนไบต์ โดยตัดที่ขอบเขตอักขระ UTF-8 (อย่าให้ภาษาไทยขาดกลางคำ) */
function clipBytes(s: string, max = LIKE_MAX_BYTES): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  let out = '';
  for (const ch of s) {
    if (enc.encode(out + ch).length > max) break;
    out += ch;
  }
  return out;
}

/** สร้างรูปแบบ `%คำค้น%` ที่ยาวไม่เกินลิมิตของ SQLite */
function like(term: string): string {
  return `%${clipBytes(term)}%`;
}

/* ------------------------------------------------------------------ users */

export async function ensureUser(
  db: D1Database,
  lineUserId: string,
  displayName?: string | null,
  pictureUrl?: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (line_user_id, display_name, picture_url)
       VALUES (?, ?, ?)
       ON CONFLICT(line_user_id) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, users.display_name),
         picture_url  = COALESCE(excluded.picture_url, users.picture_url),
         last_seen_at = datetime('now')`,
    )
    .bind(lineUserId, displayName ?? null, pictureUrl ?? null)
    .run();
}

/* -------------------------------------------------------------- locations */

export async function listLocations(db: D1Database, activeOnly = true): Promise<Location[]> {
  const sql = `SELECT * FROM locations ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY is_default DESC, code`;
  const { results } = await db.prepare(sql).all<Location>();
  return results ?? [];
}

export async function getLocation(db: D1Database, id: number): Promise<Location | null> {
  return db.prepare('SELECT * FROM locations WHERE id = ?').bind(id).first<Location>();
}

export async function defaultLocation(db: D1Database): Promise<Location | null> {
  return db
    .prepare('SELECT * FROM locations WHERE active = 1 ORDER BY is_default DESC, id LIMIT 1')
    .first<Location>();
}

/** หาคลังจากคำที่ผู้ใช้พิมพ์ เช่น "MAIN" หรือ "คลังกลาง" หรือ "หน้าร้าน" */
export async function findLocationByKeyword(db: D1Database, keyword: string): Promise<Location | null> {
  const k = norm(keyword);
  if (!k) return null;
  const all = await listLocations(db, true);
  return (
    all.find((l) => norm(l.code) === k || norm(l.name) === k) ??
    all.find((l) => norm(l.name).includes(k) || norm(l.code).includes(k)) ??
    null
  );
}

export async function createLocation(db: D1Database, code: string, name: string, isDefault = false): Promise<Location> {
  const row = await db
    .prepare('INSERT INTO locations (code, name, is_default) VALUES (?, ?, ?) RETURNING *')
    .bind(code.trim().toUpperCase(), name.trim(), isDefault ? 1 : 0)
    .first<Location>();
  if (isDefault) {
    await db.prepare('UPDATE locations SET is_default = 0 WHERE id != ?').bind(row!.id).run();
  }
  return row!;
}

export async function updateLocation(db: D1Database, id: number, patch: Partial<Location>): Promise<Location | null> {
  const current = await getLocation(db, id);
  if (!current) throw new AppError('ไม่พบคลังที่ต้องการแก้ไข', 404);
  const next = {
    code: (patch.code ?? current.code).trim().toUpperCase(),
    name: (patch.name ?? current.name).trim(),
    is_default: patch.is_default ?? current.is_default,
    active: patch.active ?? current.active,
  };
  await db
    .prepare('UPDATE locations SET code = ?, name = ?, is_default = ?, active = ? WHERE id = ?')
    .bind(next.code, next.name, next.is_default, next.active, id)
    .run();
  if (next.is_default) await db.prepare('UPDATE locations SET is_default = 0 WHERE id != ?').bind(id).run();
  return getLocation(db, id);
}

export async function deleteLocation(db: D1Database, id: number): Promise<void> {
  const used = await db
    .prepare('SELECT COUNT(*) AS c FROM stock_levels WHERE location_id = ? AND qty != 0')
    .bind(id)
    .first<{ c: number }>();
  if ((used?.c ?? 0) > 0) throw new AppError('คลังนี้ยังมีสินค้าคงเหลืออยู่ ย้ายสินค้าออกก่อนจึงจะลบได้');
  await db.prepare('UPDATE locations SET active = 0 WHERE id = ?').bind(id).run();
}

/* --------------------------------------------------------------- products */

/** สินค้าแบบไม่หิ้วรูป (รูปเป็น base64 ยาวมาก ไม่ควรส่งไปพร้อมรายการ) */
export interface ProductLite extends Omit<Product, 'photo'> {
  /** 1 = มีรูป, 0 = ไม่มี — ใช้ตัดสินใจว่าจะใส่รูปในการ์ดหรือไม่ */
  has_photo: number;
}

/** แถวผลลัพธ์ดิบจาก `SELECT p.*` — ยังมีรูปอยู่ จะถูกตัดทิ้งทีเดียวใน lite() */
type RowWithPhoto<T> = T & Pick<Product, 'photo'>;

/** ตัดรูปออกจากผลลัพธ์ เหลือไว้แค่ธงว่ามีรูปไหม ลดขนาดข้อมูลลงหลายสิบเท่า */
function lite<T>(rows: RowWithPhoto<T>[]): (Omit<T, 'photo'> & { has_photo: number })[] {
  return rows.map((row) => {
    const { photo, ...rest } = row;
    return { ...rest, has_photo: photo ? 1 : 0 };
  });
}

export interface ProductWithStock extends ProductLite {
  total_qty: number;
  location_count: number;
}

export async function searchProducts(db: D1Database, query: string, limit = 20): Promise<ProductWithStock[]> {
  const terms = norm(query).split(' ').filter(Boolean).slice(0, 5);
  const where: string[] = ['p.active = 1'];
  const binds: unknown[] = [];
  for (const t of terms) {
    const pat = like(t);
    where.push('(LOWER(p.name) LIKE ? OR LOWER(p."sku") LIKE ? OR LOWER(p.category) LIKE ? OR p.barcode = ?)');
    binds.push(pat, pat, pat, clipBytes(t));
  }
  const sql = `
    SELECT p.*,
           COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) AS total_qty,
           (SELECT COUNT(*) FROM stock_levels s WHERE s.product_id = p.id AND s.qty > 0) AS location_count
    FROM products p
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE WHEN LOWER(p.name) = ? THEN 0
           WHEN LOWER(p."sku")  = ? THEN 0
           WHEN p.barcode     = ? THEN 0
           WHEN LOWER(p.name) LIKE ? THEN 1
           ELSE 2 END,
      p.name
    LIMIT ?`;
  const q = clipBytes(norm(query));
  const { results } = await db
    .prepare(sql)
    .bind(...binds, q, q, q, `${q}%`, limit)
    .all<RowWithPhoto<ProductWithStock>>();
  return lite<ProductWithStock>(results ?? []) as ProductWithStock[];
}

export async function listProducts(
  db: D1Database,
  opts: { q?: string; locationId?: number; status?: 'all' | 'low' | 'out'; limit?: number } = {},
): Promise<ProductWithStock[]> {
  const limit = opts.limit ?? 200;
  const binds: unknown[] = [];
  const where: string[] = ['p.active = 1'];

  if (opts.q && opts.q.trim()) {
    where.push('(LOWER(p.name) LIKE ? OR LOWER(p."sku") LIKE ? OR LOWER(p.category) LIKE ? OR p.barcode LIKE ?)');
    const pat = like(norm(opts.q));
    binds.push(pat, pat, pat, pat);
  }

  const qtyExpr = opts.locationId
    ? 'COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id AND s.location_id = ?), 0)'
    : 'COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0)';
  const qtyBinds = opts.locationId ? [opts.locationId] : [];

  let having = '';
  if (opts.status === 'low') having = `HAVING total_qty > 0 AND total_qty <= p.min_qty`;
  else if (opts.status === 'out') having = `HAVING total_qty <= 0`;

  const sql = `
    SELECT p.*, ${qtyExpr} AS total_qty,
           (SELECT COUNT(*) FROM stock_levels s WHERE s.product_id = p.id AND s.qty > 0) AS location_count
    FROM products p
    WHERE ${where.join(' AND ')}
    GROUP BY p.id
    ${having}
    ORDER BY p.name
    LIMIT ?`;

  // ลำดับ bind: qtyExpr อยู่ใน SELECT จึงมาก่อน WHERE
  const { results } = await db.prepare(sql).bind(...qtyBinds, ...binds, limit).all<RowWithPhoto<ProductWithStock>>();
  return lite<ProductWithStock>(results ?? []) as ProductWithStock[];
}

export async function getProduct(db: D1Database, id: number): Promise<Product | null> {
  return db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<Product>();
}

/** ดึงสินค้าแบบไม่ดึงรูป — ใช้ในฝั่งแชท LINE ที่ไม่ต้องการ base64 */
export async function getProductLite(db: D1Database, id: number): Promise<ProductLite | null> {
  const rows = await db.prepare('SELECT * FROM products WHERE id = ?').bind(id).all<Product>();
  return (lite(rows.results ?? [])[0] as ProductLite | undefined) ?? null;
}

export async function getProductByBarcode(db: D1Database, barcode: string): Promise<Product | null> {
  return db
    .prepare('SELECT * FROM products WHERE (barcode = ? OR "sku" = ?) AND active = 1')
    .bind(barcode.trim(), barcode.trim())
    .first<Product>();
}

export async function createProduct(db: D1Database, input: Partial<Product>): Promise<Product> {
  if (!input.name?.trim()) throw new AppError('กรุณาระบุชื่อสินค้า');
  const sku = input.sku?.trim() || (await nextSku(db));
  const dup = await db.prepare('SELECT id FROM products WHERE "sku" = ?').bind(sku).first();
  if (dup) throw new AppError(`รหัสสินค้า ${sku} ถูกใช้ไปแล้ว`);
  if (input.barcode?.trim()) {
    const dupBc = await db.prepare('SELECT id FROM products WHERE barcode = ?').bind(input.barcode.trim()).first();
    if (dupBc) throw new AppError(`บาร์โค้ด ${input.barcode.trim()} ถูกใช้ไปแล้ว`);
  }
  const photo = typeof input.photo === 'string' ? input.photo.trim() || null : null;
  const newId = await db
    .prepare(
      `INSERT INTO products (sku, barcode, name, category, unit, min_qty, note, photo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      sku,
      input.barcode?.trim() || null,
      input.name.trim(),
      input.category?.trim() || null,
      input.unit?.trim() || 'ชิ้น',
      Number(input.min_qty ?? 0),
      input.note?.trim() || null,
      photo,
    )
    .first<{ id: number }>();

  if (!newId) throw new AppError('สร้างสินค้าไม่สำเร็จ');
  const product = await db.prepare('SELECT * FROM products WHERE id = ?').bind(newId.id).first<Product>();
  if (!product) throw new AppError('ไม่พบสินค้าที่สร้าง');
  return product;
}

async function nextSku(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT COUNT(*) AS c FROM products").first<{ c: number }>();
  return `SKU-${String((row?.c ?? 0) + 1).padStart(4, '0')}`;
}

export async function updateProduct(db: D1Database, id: number, patch: Partial<Product>): Promise<Product | null> {
  const current = await getProduct(db, id);
  if (!current) throw new AppError('ไม่พบสินค้า', 404);
  const barcode = patch.barcode !== undefined ? patch.barcode?.trim() || null : current.barcode;
  if (barcode && barcode !== current.barcode) {
    const dup = await db.prepare('SELECT id FROM products WHERE barcode = ? AND id != ?').bind(barcode, id).first();
    if (dup) throw new AppError(`บาร์โค้ด ${barcode} ถูกใช้ไปแล้ว`);
  }
  const photo = patch.photo !== undefined
    ? typeof patch.photo === 'string' ? patch.photo.trim() || null : current.photo
    : current.photo;
  await db
    .prepare(
      `UPDATE products SET "sku" = ?, barcode = ?, name = ?, category = ?, unit = ?, min_qty = ?, note = ?, photo = ?, active = ?,
         updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(
      (patch.sku ?? current.sku).trim(),
      barcode,
      (patch.name ?? current.name).trim(),
      patch.category !== undefined ? patch.category?.trim() || null : current.category,
      (patch.unit ?? current.unit).trim(),
      Number(patch.min_qty ?? current.min_qty),
      patch.note !== undefined ? patch.note?.trim() || null : current.note,
      photo,
      patch.active ?? current.active,
      id,
    )
    .run();
  return getProduct(db, id);
}

export async function archiveProduct(db: D1Database, id: number): Promise<void> {
  await db.prepare("UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?").bind(id).run();
}

/* ----------------------------------------------------------------- stock */

export interface LevelRow {
  location_id: number;
  code: string;
  name: string;
  qty: number;
}

export async function getLevels(db: D1Database, productId: number): Promise<LevelRow[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id AS location_id, l.code, l.name, COALESCE(s.qty, 0) AS qty
       FROM locations l
       LEFT JOIN stock_levels s ON s.location_id = l.id AND s.product_id = ?
       WHERE l.active = 1
       ORDER BY l.is_default DESC, l.code`,
    )
    .bind(productId)
    .all<LevelRow>();
  return results ?? [];
}

export async function getQty(db: D1Database, productId: number, locationId: number): Promise<number> {
  const row = await db
    .prepare('SELECT qty FROM stock_levels WHERE product_id = ? AND location_id = ?')
    .bind(productId, locationId)
    .first<{ qty: number }>();
  return row?.qty ?? 0;
}

export async function totalQty(db: D1Database, productId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(qty), 0) AS q FROM stock_levels WHERE product_id = ?')
    .bind(productId)
    .first<{ q: number }>();
  return row?.q ?? 0;
}

/** บวก/ลบสต๊อกแบบกันติดลบ (atomic ที่ระดับ statement) */
async function addStock(db: D1Database, productId: number, locationId: number, delta: number): Promise<number> {
  await db
    .prepare('INSERT OR IGNORE INTO stock_levels (product_id, location_id, qty) VALUES (?, ?, 0)')
    .bind(productId, locationId)
    .run();
  const row = await db
    .prepare(
      `UPDATE stock_levels SET qty = qty + ?, updated_at = datetime('now')
       WHERE product_id = ? AND location_id = ? AND qty + ? >= 0
       RETURNING qty`,
    )
    .bind(delta, productId, locationId, delta)
    .first<{ qty: number }>();
  if (!row) {
    const have = await getQty(db, productId, locationId);
    throw new AppError(`สต๊อกไม่พอ (คงเหลือ ${have})`);
  }
  return row.qty;
}

async function logMovement(
  db: D1Database,
  args: {
    ref: string;
    type: MovementType;
    productId: number;
    locationId: number;
    qty: number;
    delta: number;
    balanceAfter: number;
    note?: string | null;
    actor: Actor;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO movements (ref, type, product_id, location_id, qty, delta, balance_after, note, actor_line_id, actor_name, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      args.ref,
      args.type,
      args.productId,
      args.locationId,
      Math.abs(args.qty),
      args.delta,
      args.balanceAfter,
      args.note ?? null,
      args.actor.lineUserId,
      args.actor.name,
      args.actor.source,
    )
    .run();
}

export interface MovementResult {
  ref: string;
  balanceAfter: number;
  balanceAfterTo?: number;
  total: number;
}

/** เบิกออก */
export async function issue(
  db: D1Database,
  productId: number,
  locationId: number,
  qty: number,
  note: string | null,
  actor: Actor,
): Promise<MovementResult> {
  if (qty <= 0) throw new AppError('จำนวนต้องมากกว่า 0');
  const ref = makeRef('OUT');
  const balance = await addStock(db, productId, locationId, -qty);
  await logMovement(db, {
    ref, type: 'issue', productId, locationId, qty, delta: -qty, balanceAfter: balance, note, actor,
  });
  return { ref, balanceAfter: balance, total: await totalQty(db, productId) };
}

/** รับเข้า */
export async function receive(
  db: D1Database,
  productId: number,
  locationId: number,
  qty: number,
  note: string | null,
  actor: Actor,
): Promise<MovementResult> {
  if (qty <= 0) throw new AppError('จำนวนต้องมากกว่า 0');
  const ref = makeRef('IN');
  const balance = await addStock(db, productId, locationId, qty);
  await logMovement(db, {
    ref, type: 'receive', productId, locationId, qty, delta: qty, balanceAfter: balance, note, actor,
  });
  return { ref, balanceAfter: balance, total: await totalQty(db, productId) };
}

/** ปรับยอดให้เท่ากับจำนวนที่นับได้จริง */
export async function adjust(
  db: D1Database,
  productId: number,
  locationId: number,
  targetQty: number,
  note: string | null,
  actor: Actor,
): Promise<MovementResult> {
  if (targetQty < 0) throw new AppError('จำนวนคงเหลือติดลบไม่ได้');
  const ref = makeRef('ADJ');
  await db
    .prepare('INSERT OR IGNORE INTO stock_levels (product_id, location_id, qty) VALUES (?, ?, 0)')
    .bind(productId, locationId)
    .run();

  let delta = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await getQty(db, productId, locationId);
    delta = targetQty - current;
    const row = await db
      .prepare(
        `UPDATE stock_levels SET qty = ?, updated_at = datetime('now')
         WHERE product_id = ? AND location_id = ? AND qty = ? RETURNING qty`,
      )
      .bind(targetQty, productId, locationId, current)
      .first<{ qty: number }>();
    if (row) {
      await logMovement(db, {
        ref, type: 'adjust', productId, locationId, qty: Math.abs(delta), delta,
        balanceAfter: row.qty, note, actor,
      });
      return { ref, balanceAfter: row.qty, total: await totalQty(db, productId) };
    }
  }
  throw new AppError('ปรับยอดไม่สำเร็จ มีการแก้ไขสต๊อกพร้อมกัน กรุณาลองใหม่');
}

/** ย้ายระหว่างคลัง */
export async function transfer(
  db: D1Database,
  productId: number,
  fromId: number,
  toId: number,
  qty: number,
  note: string | null,
  actor: Actor,
): Promise<MovementResult> {
  if (qty <= 0) throw new AppError('จำนวนต้องมากกว่า 0');
  if (fromId === toId) throw new AppError('คลังต้นทางและปลายทางต้องต่างกัน');
  const ref = makeRef('TRF');
  const fromBalance = await addStock(db, productId, fromId, -qty);
  let toBalance: number;
  try {
    toBalance = await addStock(db, productId, toId, qty);
  } catch (err) {
    await addStock(db, productId, fromId, qty); // คืนค่าเมื่อขาปลายทางล้มเหลว
    throw err;
  }
  await logMovement(db, {
    ref, type: 'transfer_out', productId, locationId: fromId, qty, delta: -qty, balanceAfter: fromBalance, note, actor,
  });
  await logMovement(db, {
    ref, type: 'transfer_in', productId, locationId: toId, qty, delta: qty, balanceAfter: toBalance, note, actor,
  });
  return { ref, balanceAfter: fromBalance, balanceAfterTo: toBalance, total: await totalQty(db, productId) };
}

/* ------------------------------------------------------------- movements */

export interface MovementRow {
  id: number;
  ref: string;
  type: MovementType;
  qty: number;
  delta: number;
  balance_after: number;
  note: string | null;
  actor_name: string | null;
  source: string;
  created_at: string;
  product_name: string;
  sku: string;
  unit: string;
  location_name: string;
  location_code: string;
}

export async function listMovements(
  db: D1Database,
  opts: { productId?: number; locationId?: number; limit?: number } = {},
): Promise<MovementRow[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.productId) { where.push('m.product_id = ?'); binds.push(opts.productId); }
  if (opts.locationId) { where.push('m.location_id = ?'); binds.push(opts.locationId); }
  const sql = `
    SELECT m.id, m.ref, m.type, m.qty, m.delta, m.balance_after, m.note, m.actor_name, m.source, m.created_at,
           p.name AS product_name, p."sku" AS sku, p.unit, l.name AS location_name, l.code AS location_code
    FROM movements m
    JOIN products p ON p.id = m.product_id
    JOIN locations l ON l.id = m.location_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY m.id DESC LIMIT ?`;
  const { results } = await db.prepare(sql).bind(...binds, opts.limit ?? 50).all<MovementRow>();
  return results ?? [];
}

/* --------------------------------------------------------------- reports */

export async function lowStockProducts(db: D1Database, limit = 50): Promise<ProductWithStock[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) AS total_qty,
              (SELECT COUNT(*) FROM stock_levels s WHERE s.product_id = p.id AND s.qty > 0) AS location_count
       FROM products p
       WHERE p.active = 1 AND p.min_qty > 0
         AND COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) <= p.min_qty
       ORDER BY (COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) - p.min_qty), p.name
       LIMIT ?`,
    )
    .bind(limit)
    .all<RowWithPhoto<ProductWithStock>>();
  return lite<ProductWithStock>(results ?? []) as ProductWithStock[];
}

export interface Summary {
  productCount: number;
  locationCount: number;
  totalUnits: number;
  lowCount: number;
  outCount: number;
  todayIssue: number;
  todayReceive: number;
  todayMovements: number;
}

export async function getSummary(db: D1Database): Promise<Summary> {
  const row = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM products WHERE active = 1) AS productCount,
        (SELECT COUNT(*) FROM locations WHERE active = 1) AS locationCount,
        (SELECT COALESCE(SUM(s.qty), 0) FROM stock_levels s JOIN products p ON p.id = s.product_id WHERE p.active = 1) AS totalUnits,
        (SELECT COUNT(*) FROM products p WHERE p.active = 1 AND p.min_qty > 0
           AND COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) <= p.min_qty
           AND COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) > 0) AS lowCount,
        (SELECT COUNT(*) FROM products p WHERE p.active = 1
           AND COALESCE((SELECT SUM(qty) FROM stock_levels s WHERE s.product_id = p.id), 0) <= 0) AS outCount,
        (SELECT COALESCE(SUM(qty), 0) FROM movements WHERE type = 'issue' AND date(created_at, '+7 hours') = date('now', '+7 hours')) AS todayIssue,
        (SELECT COALESCE(SUM(qty), 0) FROM movements WHERE type = 'receive' AND date(created_at, '+7 hours') = date('now', '+7 hours')) AS todayReceive,
        (SELECT COUNT(*) FROM movements WHERE date(created_at, '+7 hours') = date('now', '+7 hours')) AS todayMovements`,
    )
    .first<Summary>();
  return (
    row ?? {
      productCount: 0, locationCount: 0, totalUnits: 0, lowCount: 0,
      outCount: 0, todayIssue: 0, todayReceive: 0, todayMovements: 0,
    }
  );
}

/* ---------------------------------------------------------------- drafts */

const DRAFT_TTL_MS = 10 * 60 * 1000;

export async function saveDraft(db: D1Database, draft: Draft): Promise<void> {
  await db
    .prepare(
      `INSERT INTO drafts (line_user_id, token, step, payload, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(line_user_id) DO UPDATE SET
         token = excluded.token, step = excluded.step,
         payload = excluded.payload, expires_at = excluded.expires_at`,
    )
    .bind(draft.lineUserId, draft.token, draft.step, JSON.stringify(draft.payload), Date.now() + DRAFT_TTL_MS)
    .run();
}

export async function getDraft(db: D1Database, lineUserId: string, token?: string): Promise<Draft | null> {
  const row = await db
    .prepare('SELECT * FROM drafts WHERE line_user_id = ?')
    .bind(lineUserId)
    .first<{ line_user_id: string; token: string; step: string; payload: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await clearDraft(db, lineUserId);
    return null;
  }
  if (token && row.token !== token) return null;
  return {
    lineUserId: row.line_user_id,
    token: row.token,
    step: row.step as DraftStep,
    payload: JSON.parse(row.payload) as DraftPayload,
  };
}

export async function clearDraft(db: D1Database, lineUserId: string): Promise<void> {
  await db.prepare('DELETE FROM drafts WHERE line_user_id = ?').bind(lineUserId).run();
}

/** กัน webhook ซ้ำ — คืน true ถ้าเคยประมวลผลแล้ว */
export async function isDuplicateEvent(db: D1Database, eventId: string): Promise<boolean> {
  try {
    await db
      .prepare('INSERT INTO processed_events (event_id, created_at) VALUES (?, ?)')
      .bind(eventId, Date.now())
      .run();
    return false;
  } catch {
    return true;
  }
}

export async function purgeOldEvents(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM processed_events WHERE created_at < ?').bind(Date.now() - 86_400_000).run();
}
