/* ============================================================
   LINE Stock — LIFF dashboard
   ============================================================ */

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  config: null,
  idToken: null,
  me: null,
  tab: 'overview',
  products: [],
  locations: [],
  filters: { q: '', status: 'all', locationId: '' },
  historyType: 'all',
  report: { period: 'week', offset: 0, sort: 'issued', kind: 'issued', data: null },
  summary: null,
};

const ACTIONS = {
  issue:    { label: 'เบิกออก', icon: '📤', cls: 'issue',    verb: 'เบิก' },
  receive:  { label: 'รับเข้า', icon: '📥', cls: 'receive',  verb: 'รับเข้า' },
  adjust:   { label: 'ปรับยอด', icon: '⚖️', cls: 'adjust',   verb: 'ปรับเป็น' },
  transfer: { label: 'ย้ายคลัง', icon: '🔁', cls: 'transfer', verb: 'ย้าย' },
};

const MOVE_META = {
  issue:        { label: 'เบิกออก', icon: '📤', cls: 'issue' },
  receive:      { label: 'รับเข้า', icon: '📥', cls: 'receive' },
  adjust:       { label: 'ปรับยอด', icon: '⚖️', cls: 'adjust' },
  transfer_out: { label: 'ย้ายออก', icon: '🔁', cls: 'transfer' },
  transfer_in:  { label: 'ย้ายเข้า', icon: '🔁', cls: 'transfer' },
};

/* ------------------------------------------------------------ helpers */

const fmt = (n) => {
  const v = Math.round((Number(n) || 0) * 1000) / 1000;
  return v.toLocaleString('th-TH', { maximumFractionDigits: 3 });
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function stockClass(qty, min) {
  if (qty <= 0) return 'out';
  if (min > 0 && qty <= min) return 'low';
  return 'ok';
}

function relTime(sqlUtc) {
  const d = new Date(String(sqlUtc).replace(' ', 'T') + 'Z');
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'เมื่อครู่';
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชั่วโมงที่แล้ว`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} วันที่แล้ว`;
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' });
}

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind ? 'toast--' + kind : ''}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (state.idToken) headers.authorization = `Bearer ${state.idToken}`;
  const res = await fetch(`/api${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `เกิดข้อผิดพลาด (${res.status})`);
  return data;
}

/* --------------------------------------------------------- bootstrap */

async function boot() {
  try {
    state.config = await fetch('/api/config').then((r) => r.json());
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const useLiff = state.config.liffId && !(local && state.config.dev);

    if (useLiff) {
      await liff.init({ liffId: state.config.liffId });
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return;
      }
      state.idToken = liff.getIDToken();
      if (!state.idToken) throw new Error('ไม่ได้รับ ID token — ตรวจสอบว่าเปิด scope "openid" ใน LINE Login แล้ว');
    }

    state.me = await api('/me');
    paintUser();
    await refreshAll();

    $('#boot').hidden = true;
    $('#app').hidden = false;
    applyDeepLink();
  } catch (err) {
    $('#boot').innerHTML = `
      <div class="boot__logo">⚠️</div>
      <div class="boot__text" style="max-width:280px;text-align:center">${esc(err.message)}</div>
      <button class="btn btn--ghost" onclick="location.reload()">ลองใหม่</button>`;
  }
}

function applyDeepLink() {
  const p = new URLSearchParams(location.search);
  if (p.get('status')) {
    state.filters.status = p.get('status');
    $$('#statusChips .chip').forEach((c) => c.classList.toggle('is-active', c.dataset.status === state.filters.status));
  }
  if (p.get('tab')) switchTab(p.get('tab'));
  if (p.get('p')) openProduct(Number(p.get('p')));
}

function paintUser() {
  const name = state.me?.name || 'ผู้ใช้';
  $('#userInitial').textContent = name.trim().charAt(0).toUpperCase();
  if (state.me?.picture) {
    const img = $('#userAvatar');
    img.src = state.me.picture;
    img.hidden = false;
    $('#userInitial').hidden = true;
  }
  $('#meName').textContent = name;
  $('#meId').textContent = state.me?.lineUserId ?? '-';
}

async function refreshAll() {
  const [data, products] = await Promise.all([api('/summary'), loadProducts()]);
  state.summary = data.summary;
  state.locations = data.locations;
  renderOverview(data);
  renderLocationFilter();
  renderProducts(products);
  renderSettingsLocations(data.byLocation);
}

async function loadProducts() {
  const p = new URLSearchParams();
  if (state.filters.q) p.set('q', state.filters.q);
  if (state.filters.status !== 'all') p.set('status', state.filters.status);
  if (state.filters.locationId) p.set('locationId', state.filters.locationId);
  state.products = await api(`/products?${p}`);
  return state.products;
}

/* ------------------------------------------------------------ ภาพรวม */

function renderOverview(data) {
  const s = data.summary;
  $('#statGrid').innerHTML = `
    ${statTile('รายการสินค้า', fmt(s.productCount), `${s.locationCount} คลัง`, '')}
    ${statTile('หน่วยคงเหลือรวม', fmt(s.totalUnits), 'ทุกคลังรวมกัน', '')}
    ${statTile('ใกล้หมด', fmt(s.lowCount), 'ต่ำกว่าจุดสั่งซื้อ', 'warn')}
    ${statTile('หมดสต๊อก', fmt(s.outCount), 'ต้องสั่งซื้อด่วน', 'danger')}
    <div class="stat" style="grid-column:1/-1">
      <div class="stat__label">ความเคลื่อนไหววันนี้</div>
      <div style="display:flex;gap:22px;margin-top:8px">
        <div><div class="stat__value" style="color:var(--issue);font-size:22px">${fmt(s.todayIssue)}</div><div class="stat__hint">เบิกออก</div></div>
        <div><div class="stat__value" style="color:var(--receive);font-size:22px">${fmt(s.todayReceive)}</div><div class="stat__hint">รับเข้า</div></div>
        <div><div class="stat__value" style="font-size:22px">${fmt(s.todayMovements)}</div><div class="stat__hint">รายการ</div></div>
      </div>
    </div>`;

  const max = Math.max(1, ...data.byLocation.map((l) => Number(l.units) || 0));
  $('#locationBars').innerHTML = data.byLocation.length
    ? data.byLocation
        .map(
          (l) => `
      <div class="loc-bar">
        <div class="loc-bar__top">
          <span class="loc-bar__name">${esc(l.name)}</span>
          <span class="loc-bar__value">${fmt(l.units)} หน่วย · ${l.items} รายการ</span>
        </div>
        <div class="loc-bar__track"><div class="loc-bar__fill" style="width:${((Number(l.units) || 0) / max) * 100}%"></div></div>
      </div>`,
        )
        .join('')
    : '<div class="empty">ยังไม่มีคลังสินค้า</div>';

  $('#lowList').innerHTML = data.low.length
    ? data.low.map((p) => productRow(p, true)).join('')
    : '<div class="empty">ไม่มีสินค้าต่ำกว่าจุดสั่งซื้อ 🎉</div>';

  $('#recentList').innerHTML = data.recent.length
    ? data.recent.slice(0, 6).map(movementRow).join('')
    : '<div class="empty">ยังไม่มีความเคลื่อนไหว</div>';
}

function statTile(label, value, hint, kind) {
  return `<div class="stat ${kind ? 'stat--' + kind : ''}">
    <div class="stat__label">${kind ? `<span class="dot"></span>` : ''}${esc(label)}</div>
    <div class="stat__value">${value}</div>
    <div class="stat__hint">${esc(hint)}</div>
  </div>`;
}

function productRow(p, plain = false) {
  const cls = stockClass(Number(p.total_qty), Number(p.min_qty));
  const badge = cls === 'out' ? 'หมด' : cls === 'low' ? 'ใกล้หมด' : '';
  return `<button class="item ${plain ? 'item--plain' : ''}" data-product="${p.id}">
    <div class="item__main">
      <div class="item__name">${esc(p.name)}</div>
      <div class="item__meta">
        <span>${esc(p.sku)}</span>
        ${p.category ? `<span>· ${esc(p.category)}</span>` : ''}
        ${badge ? `<span class="badge badge--${cls}">${badge}</span>` : ''}
      </div>
    </div>
    <div class="item__qty">
      <b class="qty-${cls}">${fmt(p.total_qty)}</b>
      <span>${esc(p.unit)}</span>
    </div>
  </button>`;
}

function movementRow(m) {
  const meta = MOVE_META[m.type] ?? { label: m.type, icon: '•', cls: '' };
  const positive = Number(m.delta) > 0;
  return `<div class="tl">
    <div class="tl__icon badge--${meta.cls}">${meta.icon}</div>
    <div>
      <div class="tl__name">${esc(m.product_name)}</div>
      <div class="tl__meta">${meta.label} · ${esc(m.location_name)} · ${relTime(m.created_at)}${m.actor_name ? ' · ' + esc(m.actor_name) : ''}${m.note ? ' · ' + esc(m.note) : ''}</div>
    </div>
    <div>
      <div class="tl__delta" style="color:var(--${positive ? 'receive' : 'issue'})">${positive ? '+' : ''}${fmt(m.delta)}</div>
      <div class="tl__balance">เหลือ ${fmt(m.balance_after)}</div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------- สินค้า */

function renderLocationFilter() {
  const sel = $('#locationFilter');
  sel.innerHTML =
    '<option value="">ทุกคลัง</option>' +
    state.locations.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  sel.value = state.filters.locationId;
}

function renderProducts(products) {
  $('#productList').innerHTML = products.length
    ? products.map((p) => productRow(p)).join('')
    : `<div class="empty">ไม่พบสินค้าที่ตรงกับเงื่อนไข</div>`;
}

function renderSettingsLocations(byLocation = []) {
  const stats = Object.fromEntries(byLocation.map((l) => [l.id, l]));
  $('#locationList').innerHTML = state.locations
    .map((l) => {
      const s = stats[l.id] ?? { units: 0, items: 0 };
      return `<button class="item item--plain" data-location="${l.id}">
        <div class="item__main">
          <div class="item__name">${esc(l.name)} ${l.is_default ? '<span class="badge badge--ok">ค่าเริ่มต้น</span>' : ''}</div>
          <div class="item__meta"><span>${esc(l.code)}</span><span>· ${s.items} รายการ</span></div>
        </div>
        <div class="item__qty"><b>${fmt(s.units)}</b><span>หน่วย</span></div>
      </button>`;
    })
    .join('');
}

/* ------------------------------------------------------------- ประวัติ */

async function renderHistory() {
  const list = $('#historyList');
  list.innerHTML = '<div class="skeleton"></div>';
  const rows = await api('/movements?limit=100');
  const filtered =
    state.historyType === 'all'
      ? rows
      : rows.filter((r) => (state.historyType === 'transfer' ? r.type.startsWith('transfer') : r.type === state.historyType));
  list.innerHTML = filtered.length ? filtered.map(movementRow).join('') : '<div class="empty">ไม่มีรายการ</div>';
}

/* ------------------------------------------------------------ รายงาน */

async function renderReport() {
  const r = state.report;
  if (!r.data) {
    $('#reportTrend').innerHTML = '<div class="skeleton" style="height:120px"></div>';
    $('#reportList').innerHTML = '<div class="skeleton"></div>';
  }
  try {
    r.data = await api(`/report?period=${r.period}&offset=${r.offset}`);
    paintReport();
  } catch (err) {
    $('#reportTrend').innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    $('#reportList').innerHTML = '';
    toast(err.message, 'error');
  }
}

function paintReport() {
  const { data, sort, period, offset, kind } = state.report;
  if (!data) return;
  const { range, rows, trend, totals } = data;

  $('#reportTitle').textContent = range.label;
  $('#reportSub').textContent = range.sub;
  $('#reportPrev').disabled = !range.canPrev;
  $('#reportNext').disabled = !range.canNext;
  $$('#reportPeriod button').forEach((b) => b.classList.toggle('is-active', b.dataset.period === period));
  $$('#reportSort .chip').forEach((c) => c.classList.toggle('is-active', c.dataset.sort === sort));
  $$('#reportKind button').forEach((b) => b.classList.toggle('is-active', b.dataset.kind === kind));

  $('#reportStats').innerHTML =
    statTile('เบิกออกรวม', fmt(totals.issued), `${totals.issuedProducts} รายการมีการเบิก`, 'danger') +
    statTile('รับเข้ารวม', fmt(totals.received), 'ของที่เข้ามาในช่วงนี้', 'ok') +
    statTile('หน่วยคงเหลือ', fmt(totals.units), `${totals.products} รายการที่ใช้งานอยู่`, '') +
    statTile('ปรับยอด / ย้ายคลัง', `${fmt(totals.adjusted)} / ${fmt(totals.moved)}`, 'รวมช่วงที่เลือก', '');

  const maxVal = Math.max(1, ...trend.map((t) => Number(t[kind])));
  const labelEvery = trend.length > 16 ? Math.ceil(trend.length / 6) : 1;
  const isRecv = kind === 'received';
  $('#reportTrend').innerHTML = trend.length
    ? `<div class="bars__plot">${trend
        .map(
          (t) =>
            `<div class="bar" title="${esc(t.label)} — เบิก ${fmt(t.issued)} · รับ ${fmt(t.received)}">
               <div class="bar__fill${Number(t[kind]) ? (isRecv ? ' bar__fill--received' : '') : ' bar__fill--zero'}" style="height:${(Number(t[kind]) / maxVal) * 100}%"></div>
             </div>`,
        )
        .join('')}</div>
       <div class="bars__labels">${trend
         .map((t, i) => `<span class="bar__label">${i % labelEvery === 0 || i === trend.length - 1 ? esc(t.label) : ''}</span>`)
         .join('')}</div>`
    : '<div class="empty">ไม่มีข้อมูล</div>';

  const sorted = sortRows(rows, sort);
  const maxRow = Math.max(1, ...sorted.map((r) => Number(r.issued)));
  $('#reportList').innerHTML = sorted.length
    ? sorted.map((r) => reportRow(r, maxRow)).join('')
    : '<div class="empty">ไม่พบสินค้า</div>';
}

function sortRows(rows, sort) {
  const list = [...rows];
  if (sort === 'stock') list.sort((a, b) => Number(b.total_qty) - Number(a.total_qty) || a.name.localeCompare(b.name, 'th'));
  else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'th'));
  else list.sort((a, b) => Number(b.issued) - Number(a.issued) || a.name.localeCompare(b.name, 'th'));
  return list;
}

function reportRow(r, maxIssued) {
  const pct = (Number(r.issued) / maxIssued) * 100;
  const stockCls = stockClass(Number(r.total_qty), Number(r.min_qty));
  return `<button class="item item--plain" data-product="${r.id}">
    <div class="item__main">
      <div class="item__name">${esc(r.name)}</div>
      <div class="item__meta">
        <span>${esc(r.sku)}</span>
        ${r.category ? `<span>· ${esc(r.category)}</span>` : ''}
        ${Number(r.received) ? `<span>· รับเข้า ${fmt(r.received)}</span>` : ''}
        ${r.last_issue ? `<span>· ล่าสุด ${esc(r.last_issue)}</span>` : ''}
      </div>
      ${Number(r.issued) ? `<div class="rep-bar"><div class="rep-bar__fill" style="width:${pct}%"></div></div>` : ''}
    </div>
    <div class="item__qty">
      <b class="${Number(r.issued) ? 'qty-issue' : 'qty-ok'}">${fmt(r.issued)}</b>
      <span>เบิก ${esc(r.unit)}</span>
      <span class="rep-stock qty-${stockCls}">เหลือ ${fmt(r.total_qty)}</span>
    </div>
  </button>`;
}

function downloadReportCsv() {
  const { data, period, sort } = state.report;
  if (!data) return;
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['ชื่อสินค้า', 'รหัสสินค้า', 'หมวด', 'หน่วย', 'คงเหลือ', 'เบิกออก', 'รับเข้า', 'ปรับยอด', 'ย้ายคลัง', 'จำนวนครั้ง'];
  const body = sortRows(data.rows, sort).map((r) =>
    [r.name, r.sku, r.category ?? '', r.unit, r.total_qty, r.issued, r.received, r.adjusted, r.moved, r.movements]
      .map(cell)
      .join(','),
  );
  const csv = '\uFEFF' + [head.map(cell).join(','), ...body].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `stock-report-${period}-${data.range.start}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('ดาวน์โหลดไฟล์แล้ว', 'ok');
}

/* -------------------------------------------------------- bottom sheet */

function openSheet(html) {
  $('#sheetBody').innerHTML = html;
  $('#sheet').hidden = false;
  $('#backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#backdrop').hidden = true;
  document.body.style.overflow = '';
}

function sheetHead(title, subtitle) {
  return `<div class="sheet__head">
    <div><div class="sheet__title">${esc(title)}</div>${subtitle ? `<div class="sheet__sub">${esc(subtitle)}</div>` : ''}</div>
    <button class="sheet__close" data-close>✕</button>
  </div>`;
}

/* -------------------------------------------------- รายละเอียดสินค้า */

async function openProduct(id) {
  openSheet(`${sheetHead('กำลังโหลด…', '')}<div class="skeleton" style="height:120px"></div>`);
  try {
    const { product, levels, movements, total } = await api(`/products/${id}`);
    const cls = stockClass(total, product.min_qty);
    openSheet(`
      ${sheetHead(product.name, `${product.sku}${product.barcode ? ' · ' + product.barcode : ''}`)}
      <div style="display:flex;align-items:baseline;gap:8px;margin-top:10px">
        <div class="confirm__big qty-${cls}" style="font-size:34px">${fmt(total)}</div>
        <div style="color:var(--muted);font-size:13px">${esc(product.unit)} รวมทุกคลัง</div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">
        ${product.min_qty > 0 ? `จุดสั่งซื้อขั้นต่ำ ${fmt(product.min_qty)} ${esc(product.unit)}` : 'ยังไม่ตั้งจุดสั่งซื้อ'}
        ${product.category ? ' · ' + esc(product.category) : ''}
      </div>
      ${product.photo ? `<img src="${esc(product.photo)}" style="max-width:200px;margin-top:8px;border-radius:8px" />` : ''}

      <div class="btn-grid" style="margin-top:16px">
        <button class="btn btn--issue" data-move="issue" data-id="${product.id}">📤 เบิกออก</button>
        <button class="btn btn--receive" data-move="receive" data-id="${product.id}">📥 รับเข้า</button>
        <button class="btn btn--ghost" data-move="adjust" data-id="${product.id}">⚖️ ปรับยอด</button>
        <button class="btn btn--ghost" data-move="transfer" data-id="${product.id}">🔁 ย้ายคลัง</button>
      </div>

      <section>
        <h3>คงเหลือแยกตามคลัง</h3>
        <div class="list">
          ${levels
            .map(
              (l) => `<div class="row"><span class="row__label">${esc(l.name)} · ${esc(l.code)}</span>
              <span class="row__value">${fmt(l.qty)} ${esc(product.unit)}</span></div>`,
            )
            .join('')}
        </div>
      </section>

      <section>
        <h3>ความเคลื่อนไหวล่าสุด</h3>
        <div class="timeline">${movements.length ? movements.slice(0, 12).map(movementRow).join('') : '<div class="empty">ยังไม่มีรายการ</div>'}</div>
      </section>

      <section>
        <button class="btn btn--ghost btn--block" data-edit-product="${product.id}">แก้ไขข้อมูลสินค้า</button>
      </section>
      <section>
        <button class="btn btn--danger btn--block" id="delProductBtn" data-del-product="${product.id}">🗑️ ลบสินค้าออกจากระบบ</button>
      </section>
    `);
  } catch (err) {
    toast(err.message, 'error');
    closeSheet();
  }
}

/* ------------------------------------------------------- ทำรายการสต๊อก */

async function openMovement(productId, action = 'issue') {
  const { product, levels } = await api(`/products/${productId}`);
  const meta = ACTIONS[action];
  const defaultLoc = levels.find((l) => l.qty > 0) ?? levels[0];

  openSheet(`
    ${sheetHead(meta.label, product.name)}
    <div class="seg" style="margin-top:6px">
      ${Object.entries(ACTIONS)
        .map(([key, a]) => `<button data-action="${key}" class="${key === action ? 'is-active' : ''}">${a.icon} ${a.label}</button>`)
        .join('')}
    </div>

    <form id="moveForm" style="margin-top:18px">
      <div class="field">
        <label>${action === 'transfer' ? 'คลังต้นทาง' : 'คลัง'}</label>
        <select name="locationId">
          ${levels.map((l) => `<option value="${l.location_id}" ${l.location_id === defaultLoc?.location_id ? 'selected' : ''}>${esc(l.name)} — คงเหลือ ${fmt(l.qty)} ${esc(product.unit)}</option>`).join('')}
        </select>
      </div>

      ${
        action === 'transfer'
          ? `<div class="field"><label>คลังปลายทาง</label>
              <select name="toLocationId">
                ${levels.map((l) => `<option value="${l.location_id}">${esc(l.name)} — คงเหลือ ${fmt(l.qty)} ${esc(product.unit)}</option>`).join('')}
              </select></div>`
          : ''
      }

      <div class="field">
        <label>${action === 'adjust' ? `จำนวนที่นับได้จริง (${esc(product.unit)})` : `จำนวน (${esc(product.unit)})`}</label>
        <div class="stepper">
          <button type="button" data-step="-1">−</button>
          <input name="qty" type="number" inputmode="decimal" min="0" step="any" value="${action === 'adjust' ? fmt(defaultLoc?.qty ?? 0).replace(/,/g, '') : 1}" />
          <button type="button" data-step="1">+</button>
        </div>
      </div>

      <div class="field">
        <label>หมายเหตุ (ไม่บังคับ)</label>
        <input name="note" placeholder="เช่น ใช้ในงานอีเวนต์ / ผู้รับของ" />
      </div>

      <div class="confirm" id="preview"></div>

      <button class="btn btn--${meta.cls} btn--block" style="margin-top:14px" type="submit" id="submitBtn">ยืนยัน</button>
    </form>
  `);

  const form = $('#moveForm');
  const unit = product.unit;

  const updatePreview = () => {
    const locId = Number(form.locationId.value);
    const level = levels.find((l) => l.location_id === locId);
    const current = level?.qty ?? 0;
    const qty = Number(form.qty.value || 0);
    const after = action === 'receive' ? current + qty : action === 'adjust' ? qty : current - qty;
    const cls = stockClass(after, product.min_qty);
    const invalid = (action !== 'adjust' && qty <= 0) || (action !== 'receive' && action !== 'adjust' && after < 0);

    $('#preview').innerHTML = `
      <div class="row"><span class="row__label">คงเหลือปัจจุบัน</span><span class="row__value">${fmt(current)} ${esc(unit)}</span></div>
      <div class="row"><span class="row__label">${ACTIONS[action].verb}</span><span class="row__value" style="color:var(--${meta.cls})">${fmt(qty)} ${esc(unit)}</span></div>
      <div class="row"><span class="row__label">คงเหลือหลังทำรายการ</span><span class="confirm__big qty-${cls}">${fmt(after)} ${esc(unit)}</span></div>
      ${after < 0 ? '<div style="color:var(--danger);font-size:12px">สต๊อกไม่พอสำหรับจำนวนนี้</div>' : ''}
      ${after >= 0 && product.min_qty > 0 && after <= product.min_qty ? `<div style="color:var(--warn);font-size:12px">⚠️ จะต่ำกว่าจุดสั่งซื้อ (ขั้นต่ำ ${fmt(product.min_qty)})</div>` : ''}`;

    const btn = $('#submitBtn');
    btn.disabled = invalid;
    btn.textContent = `ยืนยัน${ACTIONS[action].label} ${fmt(qty)} ${unit}`;
  };

  form.addEventListener('input', updatePreview);
  form.addEventListener('change', updatePreview);
  $$('[data-step]', form).forEach((b) =>
    b.addEventListener('click', () => {
      const input = form.qty;
      input.value = Math.max(0, (Number(input.value) || 0) + Number(b.dataset.step));
      updatePreview();
    }),
  );
  $$('[data-action]').forEach((b) => b.addEventListener('click', () => openMovement(productId, b.dataset.action)));
  updatePreview();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#submitBtn');
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก…';
    try {
      const payload = {
        action,
        productId,
        locationId: Number(form.locationId.value),
        qty: Number(form.qty.value),
        note: form.note.value.trim() || undefined,
      };
      if (action === 'transfer') payload.toLocationId = Number(form.toLocationId.value);
      const result = await api('/movements', { method: 'POST', body: JSON.stringify(payload) });
      closeSheet();
      toast(`${meta.label}สำเร็จ · เลขที่ ${result.ref}`, 'ok');
      await refreshAll();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      updatePreview();
    }
  });
}

/* ------------------------------------------------------ ฟอร์มสินค้า */

function openProductForm(product = null) {
  const p = product ?? {};
  openSheet(`
    ${sheetHead(product ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่', product ? p.sku : 'กรอกข้อมูลสินค้าที่ต้องการเก็บสต๊อก')}
    <form id="productForm" style="margin-top:14px">
      <div class="field"><label>ชื่อสินค้า *</label><input name="name" required value="${esc(p.name ?? '')}" placeholder="เช่น ปากกาลูกลื่น น้ำเงิน" /></div>
      <div class="field--row">
        <div class="field"><label>รหัสสินค้า (SKU)</label><input name="sku" value="${esc(p.sku ?? '')}" placeholder="เว้นว่างให้ระบบสร้าง" /></div>
        <div class="field"><label>หน่วยนับ</label><input name="unit" value="${esc(p.unit ?? 'ชิ้น')}" /></div>
      </div>
      <div class="field">
        <label>บาร์โค้ด</label>
        <div style="display:flex;gap:8px">
          <input name="barcode" value="${esc(p.barcode ?? '')}" placeholder="สแกนหรือพิมพ์" style="flex:1" />
          <button type="button" class="btn btn--ghost" id="scanIntoField">สแกน</button>
        </div>
      </div>
      <div class="field--row">
        <div class="field"><label>หมวดหมู่</label><input name="category" value="${esc(p.category ?? '')}" placeholder="เช่น เครื่องเขียน" /></div>
        <div class="field"><label>รูปสินค้า</label><input type="file" name="photo" accept="image/*" capture="environment" style="font-size:13px" /></div>
        <div class="field"><label>จุดสั่งซื้อขั้นต่ำ</label><input name="min_qty" type="number" min="0" step="any" value="${p.min_qty ?? 0}" /></div>
      </div>
      ${
        product
          ? ''
          : `<div class="field--row">
              <div class="field"><label>ยอดยกมา</label><input name="initial_qty" type="number" min="0" step="any" value="0" /></div>
              <div class="field"><label>เก็บที่คลัง</label><select name="location_id">${state.locations.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div>
            </div>`
      }
      <div class="field"><label>หมายเหตุ</label><input name="note" value="${esc(p.note ?? '')}" /></div>
      <button class="btn btn--primary btn--block" type="submit">${product ? 'บันทึกการแก้ไข' : 'เพิ่มสินค้า'}</button>
      ${product ? `<button class="btn btn--danger btn--block" style="margin-top:8px" type="button" id="archiveBtn">นำสินค้าออกจากระบบ</button>` : ''}
    </form>
  `);

  const form = $('#productForm');
  $('#scanIntoField')?.addEventListener('click', async () => {
    const code = await scan();
    if (code) form.barcode.value = code;
  });

  $('#archiveBtn')?.addEventListener('click', async () => {
    if (!confirm('ต้องการนำสินค้านี้ออกจากระบบหรือไม่? ประวัติเดิมจะยังอยู่')) return;
    try {
      await api(`/products/${p.id}`, { method: 'DELETE' });
      closeSheet();
      toast('นำสินค้าออกแล้ว', 'ok');
      await refreshAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const originalLabel = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
    try {
      const body = Object.fromEntries(new FormData(form).entries());
      body.min_qty = Number(body.min_qty || 0);
      if (body.initial_qty !== undefined) body.initial_qty = Number(body.initial_qty || 0);
      if (body.location_id !== undefined) body.location_id = Number(body.location_id || 0);

      // ไฟล์รูปต้องแปลงเป็น base64 ก่อน เพราะ JSON.stringify ทำกับ File ไม่ได้
      const file = form.querySelector('input[name="photo"]')?.files?.[0];
      if (file) {
        body.photo = await fileToBase64(file);
      } else {
        delete body.photo;
      }

      if (product) await api(`/products/${p.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/products', { method: 'POST', body: JSON.stringify(body) });
      closeSheet();
      toast(product ? 'บันทึกแล้ว' : 'เพิ่มสินค้าแล้ว', 'ok');
      await refreshAll();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalLabel; }
    }
  });
}

/** อ่านไฟล์รูป ย่อขนาดให้เหลือราว 400px แล้วแปลงเป็น base64 เพื่อส่งผ่าน JSON */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('รูปนี้เปิดไม่ได้ ลองเป็นไฟล์ JPG หรือ PNG'));
      img.onload = () => {
        const MAX = 400;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* -------------------------------------------------------- ฟอร์มคลัง */

function openLocationForm(location = null) {
  const l = location ?? {};
  openSheet(`
    ${sheetHead(location ? 'แก้ไขคลัง' : 'เพิ่มคลังใหม่', location ? l.code : 'สร้างที่เก็บสินค้าใหม่')}
    <form id="locForm" style="margin-top:14px">
      <div class="field--row">
        <div class="field"><label>รหัสคลัง *</label><input name="code" required value="${esc(l.code ?? '')}" placeholder="MAIN" /></div>
        <div class="field"><label>ชื่อคลัง *</label><input name="name" required value="${esc(l.name ?? '')}" placeholder="คลังกลาง" /></div>
      </div>
      <label style="display:flex;gap:10px;align-items:center;font-size:13px;margin:6px 0 16px">
        <input type="checkbox" name="is_default" ${l.is_default ? 'checked' : ''} style="width:18px;height:18px" />
        ตั้งเป็นคลังเริ่มต้น
      </label>
      <button class="btn btn--primary btn--block" type="submit">${location ? 'บันทึก' : 'เพิ่มคลัง'}</button>
      ${location ? `<button class="btn btn--danger btn--block" style="margin-top:8px" type="button" id="delLoc">ลบคลังนี้</button>` : ''}
    </form>
  `);

  const form = $('#locForm');
  $('#delLoc')?.addEventListener('click', async () => {
    if (!confirm('ลบคลังนี้หรือไม่?')) return;
    try {
      await api(`/locations/${l.id}`, { method: 'DELETE' });
      closeSheet();
      toast('ลบคลังแล้ว', 'ok');
      await refreshAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      code: form.code.value.trim(),
      name: form.name.value.trim(),
      is_default: form.is_default.checked,
    };
    try {
      if (location) await api(`/locations/${l.id}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/locations', { method: 'POST', body: JSON.stringify(body) });
      closeSheet();
      toast('บันทึกแล้ว', 'ok');
      await refreshAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* ------------------------------------------------------------- สแกน */

async function scan() {
  try {
    if (window.liff?.isInClient?.() && liff.scanCodeV2) {
      const result = await liff.scanCodeV2();
      return result?.value ?? null;
    }
  } catch (err) {
    console.warn('scanCodeV2 failed', err);
  }
  const manual = prompt('กรอกบาร์โค้ด (อุปกรณ์นี้เปิดกล้องสแกนผ่าน LINE ไม่ได้)');
  return manual?.trim() || null;
}

async function scanAndOpen() {
  const code = await scan();
  if (!code) return;
  try {
    const { product } = await api(`/products/lookup/${encodeURIComponent(code)}`);
    openProduct(product.id);
  } catch {
    if (confirm(`ไม่พบสินค้าบาร์โค้ด ${code}\nต้องการเพิ่มเป็นสินค้าใหม่หรือไม่?`)) {
      openProductForm();
      setTimeout(() => {
        const el = $('#productForm')?.barcode;
        if (el) el.value = code;
      }, 60);
    }
  }
}

/* ----------------------------------------------------------- routing */

function switchTab(tab) {
  if (!['overview', 'products', 'report', 'history', 'settings'].includes(tab)) return;
  state.tab = tab;
  $$('.view').forEach((v) => (v.hidden = v.dataset.view !== tab));
  $$('.tab[data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
  $('#topbarSubtitle').textContent = {
    overview: 'ภาพรวมวันนี้',
    products: 'รายการสินค้าทั้งหมด',
    report: 'สรุปการเบิกและคงเหลือ',
    history: 'ประวัติการเคลื่อนไหว',
    settings: 'ตั้งค่าระบบ',
  }[tab];
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (tab === 'history') renderHistory();
  if (tab === 'report') renderReport();
}

/* ---------------------------------------------------------- listeners */

document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab[data-tab]');
  if (tab) return switchTab(tab.dataset.tab);

  if (e.target.closest('#fabScan') || e.target.closest('#scanBtn')) return scanAndOpen();
  if (e.target.closest('[data-close]') || e.target.closest('#backdrop')) return closeSheet();

  const goto = e.target.closest('[data-goto]');
  if (goto) {
    if (goto.dataset.status) {
      state.filters.status = goto.dataset.status;
      $$('#statusChips .chip').forEach((c) => c.classList.toggle('is-active', c.dataset.status === goto.dataset.status));
      loadProducts().then(renderProducts);
    }
    return switchTab(goto.dataset.goto);
  }

  const product = e.target.closest('[data-product]');
  if (product) return openProduct(Number(product.dataset.product));

  const move = e.target.closest('[data-move]');
  if (move) return openMovement(Number(move.dataset.id), move.dataset.move);

  const edit = e.target.closest('[data-edit-product]');
  if (edit) {
    const id = Number(edit.dataset.editProduct);
    return api(`/products/${id}`).then(({ product }) => openProductForm(product));
  }

  const del = e.target.closest('[data-del-product]');
  if (del) {
    const id = Number(del.dataset.delProduct);
    if (!confirm('ต้องการลบสินค้านี้ออกจากระบบหรือไม่? ประวัติเดิมจะยังอยู่')) return;
    api(`/products/${id}`, { method: 'DELETE' }).then(() => {
        toast('ลบสินค้าแล้ว', 'ok');
        closeSheet();
        refreshAll();
    }).catch((err) => toast(err.message, 'error'));
  }

  const loc = e.target.closest('[data-location]');
  if (loc) return openLocationForm(state.locations.find((l) => l.id === Number(loc.dataset.location)));

  if (e.target.closest('#addProductBtn')) return openProductForm();
  if (e.target.closest('#addLocationBtn')) return openLocationForm();

  const chip = e.target.closest('#statusChips .chip[data-status]');
  if (chip) {
    state.filters.status = chip.dataset.status;
    $$('#statusChips .chip').forEach((c) => c.classList.toggle('is-active', c === chip));
    return loadProducts().then(renderProducts);
  }

  const hChip = e.target.closest('#historyChips .chip');
  if (hChip) {
    state.historyType = hChip.dataset.type;
    $$('#historyChips .chip').forEach((c) => c.classList.toggle('is-active', c === hChip));
    return renderHistory();
  }

  const per = e.target.closest('#reportPeriod button');
  if (per) {
    state.report.period = per.dataset.period;
    state.report.offset = 0;
    return renderReport();
  }

  const sChip = e.target.closest('#reportSort .chip');
  if (sChip) {
    state.report.sort = sChip.dataset.sort;
    return paintReport();
  }

  const kBtn = e.target.closest('#reportKind button');
  if (kBtn) {
    state.report.kind = kBtn.dataset.kind;
    return paintReport();
  }

  if (e.target.closest('#reportPrev')) {
    state.report.offset += 1;
    return renderReport();
  }
  if (e.target.closest('#reportNext')) {
    state.report.offset = Math.max(0, state.report.offset - 1);
    return renderReport();
  }
  if (e.target.closest('#reportCsv')) return downloadReportCsv();
});

let searchTimer;
$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.filters.q = e.target.value.trim();
    loadProducts().then(renderProducts);
  }, 280);
});

$('#locationFilter').addEventListener('change', (e) => {
  state.filters.locationId = e.target.value;
  loadProducts().then(renderProducts);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet();
});

boot();
