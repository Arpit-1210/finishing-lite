import { supabase } from '../../lib/supabase.js';
import { esc, inr } from '../../lib/calc.js';
import { priceLabel } from '../../lib/value.js';

export async function renderProducts(root) {
  let list = [], unsetOnly = false;
  root.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <input id="ps" placeholder="Search product…" style="padding:9px 12px;border:1px solid var(--border-strong);border-radius:8px;width:220px"><button class="btn btn-primary btn-sm" id="padd">+ Add Product</button></div>
    <div id="unset" style="margin-bottom:10px"></div>
    <div id="pc" style="font-size:12px;color:var(--ink-dim);margin-bottom:10px"></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th class="num">Selling Price</th><th>Priced</th><th>Status</th><th></th></tr></thead><tbody id="pb"></tbody></table></div>`;
  const draw = () => {
    const q = root.querySelector('#ps').value.toLowerCase();
    const unset = list.filter(p => p.active && !(Number(p.selling_price) > 0));
    root.querySelector('#unset').innerHTML = unset.length ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:13px;color:#92400e"><b>${unset.length} product${unset.length > 1 ? 's' : ''} ha${unset.length > 1 ? 've' : 's'} no price set.</b> Their value counts as ₹0 until you set it.</span><button class="btn btn-sm" id="unsetbtn">${unsetOnly ? 'Show all' : 'Show only these'}</button></div>` : '';
    root.querySelector('#unsetbtn')?.addEventListener('click', () => { unsetOnly = !unsetOnly; draw(); });
    if (!unset.length) unsetOnly = false;
    const l = list.filter(p => p.name.toLowerCase().includes(q) && (!unsetOnly || unset.includes(p)));
    root.querySelector('#pc').textContent = `${l.length} of ${list.length} products`;
    root.querySelector('#pb').innerHTML = l.map(p => `<tr><td class="bold">${esc(p.name)}</td><td class="num">${inr(p.selling_price)}<span style="font-size:11px;color:var(--ink-dim)"> ${priceLabel(p)}</span></td><td><select data-pu="${p.id}" style="border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:13px"><option value="unit" ${(p.pricing_unit || 'unit') === 'unit' ? 'selected' : ''}>per unit</option><option value="kg" ${p.pricing_unit === 'kg' ? 'selected' : ''}>per kg</option><option value="set" ${p.pricing_unit === 'set' ? 'selected' : ''}>per set</option></select>${p.pricing_unit === 'set' ? ` <input type="number" min="1" step="1" data-ss="${p.id}" value="${p.set_size || 1}" title="Pieces in one set" style="width:60px;border:1px solid var(--border);border-radius:6px;padding:5px 6px;font-size:13px"> pcs` : ''}</td><td>${p.active ? 'Active' : 'Hidden'}</td><td>${Number(p.selling_price) > 0 ? '' : `<button class="btn btn-primary btn-sm" data-sp="${p.id}">Set price</button> `}<button class="btn btn-sm" data-e="${p.id}">Edit</button> <button class="btn btn-sm" data-t="${p.id}">${p.active ? 'Hide' : 'Show'}</button></td></tr>`).join('');
    root.querySelectorAll('[data-pu]').forEach(sel => sel.onchange = async () => {
      const p = list.find(x => x.id === sel.dataset.pu);
      const upd = { pricing_unit: sel.value }; if (sel.value === 'set' && !(Number(p.set_size) >= 1)) upd.set_size = 1;
      const { error } = await supabase.from('fin_products').update(upd).eq('id', p.id);
      if (error) { sel.value = p.pricing_unit || 'unit'; return alert(error.message + '\n\nRun sql/price_units.sql in Supabase first.'); }
      load();
    });
    root.querySelectorAll('[data-ss]').forEach(inp => inp.onchange = async () => {
      const v = Math.max(1, Math.round(parseFloat(inp.value) || 1));
      const { error } = await supabase.from('fin_products').update({ set_size: v }).eq('id', inp.dataset.ss); if (error) return alert(error.message); load();
    });
    root.querySelectorAll('[data-e]').forEach(b => b.onclick = async () => {
      const p = list.find(x => x.id === b.dataset.e);
      const name = prompt('Product name', p.name); if (!name) return;
      const price = parseFloat(prompt('Selling price (₹)', p.selling_price)); if (!(price >= 0)) return;
      const { error } = await supabase.from('fin_products').update({ name: name.trim(), selling_price: price }).eq('id', p.id); if (error) return alert(error.message); load();
    });
    root.querySelectorAll('[data-sp]').forEach(b => b.onclick = async () => {
      const p = list.find(x => x.id === b.dataset.sp);
      const price = parseFloat(prompt(`Selling price (₹) for ${p.name}`, '')); if (!(price > 0)) return;
      const { error } = await supabase.from('fin_products').update({ selling_price: price }).eq('id', p.id); if (error) return alert(error.message); load();
    });
    root.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => { const p = list.find(x => x.id === b.dataset.t); await supabase.from('fin_products').update({ active: !p.active }).eq('id', p.id); load(); });
  };
  async function load() { const { data, error } = await supabase.from('fin_products').select('*').order('name').limit(5000); if (error) throw error; list = data || []; draw(); }
  root.querySelector('#ps').oninput = draw;
  root.querySelector('#padd').onclick = async () => {
    const name = prompt('Product name'); if (!name) return;
    const price = parseFloat(prompt('Selling price (₹)', '0')); if (!(price >= 0)) return;
    const u = (prompt('Price is for:  1 = per unit,  2 = per kg,  3 = per set', '1') || '1').trim();
    const row = { name: name.trim(), selling_price: price };
    if (u === '2') row.pricing_unit = 'kg';
    else if (u === '3') { const n = Math.max(1, Math.round(parseFloat(prompt('How many pieces in one set?', '2')) || 1)); row.pricing_unit = 'set'; row.set_size = n; }
    const { error } = await supabase.from('fin_products').insert(row); if (error) return alert(error.message + (row.pricing_unit ? '\n\nRun sql/price_units.sql in Supabase first.' : '')); load();
  };
  await load();
}
