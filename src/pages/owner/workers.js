import { supabase } from '../../lib/supabase.js';
import { esc } from '../../lib/calc.js';

export async function renderWorkers(root) {
  let workers = [];
  root.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
    <input id="ws" placeholder="Search worker…" style="padding:9px 12px;border:1px solid var(--border-strong);border-radius:8px;width:200px"><button class="btn btn-primary btn-sm" id="wadd">+ Add Worker</button></div>
    <div style="font-size:12px;color:var(--ink-dim);margin-bottom:10px">Same worker list and rates as Moulding — a change here changes it there too.</div>
    <div class="table-wrap"><table class="dt"><thead><tr><th>Name</th><th class="num">Daily Rate</th><th>Status</th><th></th></tr></thead><tbody id="wb"></tbody></table></div>`;
  const draw = () => {
    const q = root.querySelector('#ws').value.toLowerCase();
    root.querySelector('#wb').innerHTML = workers.filter(w => w.name.toLowerCase().includes(q)).map(w => `<tr><td class="bold">${esc(w.name)}</td><td class="num">₹${Number(w.daily_rate || 0).toLocaleString('en-IN')}</td><td>${w.active ? 'Active' : 'Inactive'}</td><td><button class="btn btn-sm" data-e="${w.id}">Edit</button> <button class="btn btn-sm" data-t="${w.id}">${w.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('');
    root.querySelectorAll('[data-e]').forEach(b => b.onclick = async () => {
      const w = workers.find(x => x.id === b.dataset.e);
      const name = prompt('Name', w.name); if (!name) return;
      const rate = parseFloat(prompt('Daily rate (₹)', w.daily_rate)); if (!(rate >= 0)) return;
      const { error } = await supabase.from('workers').update({ name: name.trim(), daily_rate: rate }).eq('id', w.id); if (error) return alert(error.message); load();
    });
    root.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => { const w = workers.find(x => x.id === b.dataset.t); await supabase.from('workers').update({ active: !w.active }).eq('id', w.id); load(); });
  };
  async function load() { const { data, error } = await supabase.from('workers').select('*').order('name'); if (error) throw error; workers = data || []; draw(); }
  root.querySelector('#ws').oninput = draw;
  root.querySelector('#wadd').onclick = async () => {
    const name = prompt('Worker name'); if (!name) return;
    const rate = parseFloat(prompt('Daily rate (₹)', '400')); if (!(rate >= 0)) return;
    const { error } = await supabase.from('workers').insert({ name: name.trim(), daily_rate: rate, active: true }); if (error) return alert(error.message); load();
  };
  await load();
}
