import { supabase } from '../../lib/supabase.js';
import { istToday } from '../../lib/roster.js';
import { inr, num, esc } from '../../lib/calc.js';

let channel = null;

export async function renderInventory(root) {
  if (channel) { supabase.removeChannel(channel); channel = null; }
  const TODAY = istToday();
  const monthStart = TODAY.slice(0, 7) + '-01';
  const weekStart = new Date(Date.now() + 5.5 * 3600 * 1000 - 6 * 86400000).toISOString().slice(0, 10);
  let q = '';
  let rows = [];

  async function load() {
    const [lr, pr] = await Promise.all([
      supabase.from('fin_production_log').select('product_id, quantity, production_date').limit(100000),
      supabase.from('fin_products').select('id, name, selling_price'),
    ]);
    if (lr.error) throw lr.error;
    const prods = new Map((pr.data || []).map(p => [p.id, p]));
    const by = new Map();
    for (const l of lr.data || []) {
      const p = prods.get(l.product_id);
      const r = by.get(l.product_id) || { name: p?.name || 'Unknown', price: Number(p?.selling_price || 0), today: 0, week: 0, month: 0, total: 0 };
      const n = Number(l.quantity || 0);
      r.total += n;
      if (l.production_date === TODAY) r.today += n;
      if (l.production_date >= weekStart) r.week += n;
      if (l.production_date >= monthStart) r.month += n;
      by.set(l.product_id, r);
    }
    rows = [...by.values()].sort((a, b) => b.total - a.total);
    draw();
  }

  function draw() {
    const all = rows.reduce((a, r) => ({ total: a.total + r.total, month: a.month + r.month, today: a.today + r.today, value: a.value + r.total * r.price }), { total: 0, month: 0, today: 0, value: 0 });
    const list = rows.filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()));
    const cards = list.map(r => `<div class="inv-card"><div class="prod-name">${esc(r.name)}</div>
      <div class="inv-stat"><span class="lbl">Today</span><span class="val">${num(r.today)}</span></div>
      <div class="inv-stat"><span class="lbl">This week</span><span class="val">${num(r.week)}</span></div>
      <div class="inv-stat"><span class="lbl">This month</span><span class="val">${num(r.month)}</span></div>
      <div class="inv-stat"><span class="lbl" style="font-weight:600;">Total</span><span class="val" style="color:var(--primary);font-size:15px;">${num(r.total)}</span></div>
      <div class="inv-stat"><span class="lbl">Value</span><span class="val">${inr(r.total * r.price)}</span></div></div>`).join('')
      || '<div class="state-msg">No production data yet</div>';
    const trs = list.map(r => `<tr><td class="bold">${esc(r.name)}</td><td class="num">${num(r.today)}</td><td class="num">${num(r.week)}</td><td class="num">${num(r.month)}</td><td class="num" style="font-weight:700;">${num(r.total)}</td><td class="num">${inr(r.price)}</td><td class="num" style="color:var(--green);font-weight:600;">${inr(r.total * r.price)}</td></tr>`).join('')
      || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--ink-dim);">No data</td></tr>';
    const keep = root.querySelector('#inv-q')?.value ?? q;
    root.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card" style="--accent-color:var(--primary)"><div class="kpi-icon">📦</div><div class="kpi-label">Total Inventory</div><div class="kpi-value">${num(all.total)}</div><div class="kpi-sub">units finished, all time</div></div>
        <div class="kpi-card" style="--accent-color:var(--green)"><div class="kpi-icon">💰</div><div class="kpi-label">Inventory Value</div><div class="kpi-value">${inr(all.value)}</div><div class="kpi-sub">at selling price</div></div>
        <div class="kpi-card" style="--accent-color:var(--orange)"><div class="kpi-icon">🗓️</div><div class="kpi-label">This Month</div><div class="kpi-value">${num(all.month)}</div><div class="kpi-sub">units</div></div>
        <div class="kpi-card" style="--accent-color:var(--purple)"><div class="kpi-icon">🏭</div><div class="kpi-label">Today</div><div class="kpi-value">${num(all.today)}</div><div class="kpi-sub">units</div></div>
        <div class="kpi-card" style="--accent-color:var(--red)"><div class="kpi-icon">🗂️</div><div class="kpi-label">Products</div><div class="kpi-value">${rows.length}</div><div class="kpi-sub">types finished</div></div>
      </div>
      <div class="section-head"><div><div class="section-title">Stock by Product</div><div class="section-sub">Total finished units per product, all supervisors</div></div><span class="badge badge-green">● Live</span></div>
      <div class="card" style="margin-bottom:12px;"><input id="inv-q" placeholder="Search product…" value="${esc(keep)}" autocomplete="off" style="width:100%;padding:9px 10px;border:1px solid var(--border-strong);border-radius:8px;font-size:14px;" /></div>
      <div class="inv-grid">${cards}</div>
      <div class="section-head"><div class="section-title">Product Breakdown</div></div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Product</th><th class="num">Today</th><th class="num">7 Days</th><th class="num">This Month</th><th class="num">Total</th><th class="num">Price</th><th class="num">Value</th></tr></thead>
        <tbody>${trs}</tbody>
        ${list.length ? `<tfoot><tr style="font-weight:700;background:var(--bg);"><td>Total</td><td class="num">${num(list.reduce((s, r) => s + r.today, 0))}</td><td class="num">${num(list.reduce((s, r) => s + r.week, 0))}</td><td class="num">${num(list.reduce((s, r) => s + r.month, 0))}</td><td class="num">${num(list.reduce((s, r) => s + r.total, 0))}</td><td></td><td class="num">${inr(list.reduce((s, r) => s + r.total * r.price, 0))}</td></tr></tfoot>` : ''}
      </table></div>`;
    const inp = root.querySelector('#inv-q');
    inp.oninput = () => { q = inp.value; const pos = inp.selectionStart; draw(); const n = root.querySelector('#inv-q'); n.focus(); n.setSelectionRange(pos, pos); };
  }

  await load();
  channel = supabase.channel('fin-inv').on('postgres_changes', { event: '*', schema: 'public', table: 'fin_production_log' }, () => load()).subscribe();
}
