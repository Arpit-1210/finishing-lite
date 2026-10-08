import { supabase } from '../../lib/supabase.js';
import { esc, inr } from '../../lib/calc.js';

export async function renderProducts(root) {
  let list = [];
  root.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <input id="ps" placeholder="Search product…" style="padding:9px 12px;border:1px solid var(--border-strong);border-radius:8px;width:220px"><button class="btn btn-primary btn-sm" id="padd">+ Add Product</button></div>
    <div id="pc" style="font-size:12px;color:var(--ink-dim);margin-bottom:10px"></div>
    <div class="table-wrap"><table class="dt"><thead><tr><th>Product</th><th class="num">Selling Price</th><th>Status</th><th></th></tr></thead><tbody id="pb"></tbody></table></div>`;
  const draw = () => {
    const q = root.querySelector('#ps').value.toLowerCase();
    const l = list.filter(p => p.name.toLowerCase().includes(q));
    root.querySelector('#pc').textContent = `${l.length} of ${list.length} products`;
    root.querySelector('#pb').innerHTML = l.map(p => `<tr><td class="bold">${esc(p.name)}</td><td class="num">${inr(p.selling_price)}</td><td>${p.active ? 'Active' : 'Hidden'}</td><td><button class="btn btn-sm" data-e="${p.id}">Edit</button> <button class="btn btn-sm" data-t="${p.id}">${p.active ? 'Hide' : 'Show'}</button></td></tr>`).join('');
    root.querySelectorAll('[data-e]').forEach(b => b.onclick = async () => {
      const p = list.find(x => x.id === b.dataset.e);
      const name = prompt('Product name', p.name); if (!name) return;
      const price = parseFloat(prompt('Selling price (₹)', p.selling_price)); if (!(price >= 0)) return;
      const { error } = await supabase.from('fin_products').update({ name: name.trim(), selling_price: price }).eq('id', p.id); if (error) return alert(error.message); load();
    });
    root.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => { const p = list.find(x => x.id === b.dataset.t); await supabase.from('fin_products').update({ active: !p.active }).eq('id', p.id); load(); });
  };
  async function load() { const { data, error } = await supabase.from('fin_products').select('*').order('name').limit(5000); if (error) throw error; list = data || []; draw(); }
  root.querySelector('#ps').oninput = draw;
  root.querySelector('#padd').onclick = async () => {
    const name = prompt('Product name'); if (!name) return;
    const price = parseFloat(prompt('Selling price (₹)', '0')); if (!(price >= 0)) return;
    const { error } = await supabase.from('fin_products').insert({ name: name.trim(), selling_price: price }); if (error) return alert(error.message); load();
  };
  await load();
}
