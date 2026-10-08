import { supabase } from '../../lib/supabase.js';
import { istToday } from '../../lib/roster.js';
import { closeDays } from '../../lib/dayclose.js';
import { inr, num, esc, fmtDate, teamName } from '../../lib/calc.js';

export async function renderProductionLog(root) {
  const TODAY = istToday();
  const weekAgo = new Date(Date.now() + 5.5 * 3600 * 1000 - 6 * 86400000).toISOString().slice(0, 10);
  const [sr, tr, pr] = await Promise.all([supabase.from('fin_supervisors').select('*').order('name'), supabase.from('fin_teams').select('*'), supabase.from('fin_products').select('id,name,selling_price')]);
  const sups = sr.data || [], teams = tr.data || [], prods = new Map((pr.data || []).map(p => [p.id, p]));
  root.innerHTML = `
    <div class="card" style="margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:end">
      <div><div style="font-size:11px;font-weight:600;color:var(--ink-dim)">FROM</div><input type="date" id="f-from" value="${weekAgo}" style="padding:8px;border:1px solid var(--border-strong);border-radius:8px"></div>
      <div><div style="font-size:11px;font-weight:600;color:var(--ink-dim)">TO</div><input type="date" id="f-to" value="${TODAY}" style="padding:8px;border:1px solid var(--border-strong);border-radius:8px"></div>
      <div><div style="font-size:11px;font-weight:600;color:var(--ink-dim)">SUPERVISOR</div><select id="f-sup" style="padding:8px;border:1px solid var(--border-strong);border-radius:8px"><option value="">All</option>${sups.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
    </div><div id="pl-body"></div>`;
  async function load() {
    const { data, error } = await supabase.from('fin_production_log').select('*').gte('production_date', root.querySelector('#f-from').value).lte('production_date', root.querySelector('#f-to').value).order('production_date', { ascending: false }).order('created_at', { ascending: false }).limit(5000);
    if (error) { root.querySelector('#pl-body').innerHTML = `<div class="state-msg">${esc(error.message)}</div>`; return; }
    const sf = root.querySelector('#f-sup').value;
    const list = (data || []).filter(l => !sf || teams.find(t => t.id === l.team_id)?.supervisor_id === sf);
    root.querySelector('#pl-body').innerHTML = `<div class="table-wrap"><table class="dt"><thead><tr><th>Date</th><th>Supervisor</th><th>Team</th><th>Product</th><th class="num">Qty</th><th class="num">Value</th><th></th></tr></thead><tbody>${list.map(l => {
      const t = teams.find(x => x.id === l.team_id), p = prods.get(l.product_id);
      return `<tr><td>${fmtDate(l.production_date)}</td><td>${esc(sups.find(s => s.id === t?.supervisor_id)?.name || '')}</td><td>${esc(teamName(t))}</td><td class="bold">${esc(p?.name || '—')}</td><td class="num">${num(l.quantity)}</td><td class="num">${inr(l.quantity * (p?.selling_price || 0))}</td><td><button class="btn btn-sm" data-del="${l.id}" data-date="${l.production_date}">Delete</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--ink-dim)">No entries</td></tr>'}</tbody></table></div>`;
    root.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this entry?')) return;
      const { error } = await supabase.from('fin_production_log').delete().eq('id', b.dataset.del);
      if (error) return alert(error.message);
      if (b.dataset.date < TODAY) await closeDays(supabase, [b.dataset.date]);
      load();
    });
  }
  root.querySelectorAll('input,select').forEach(e => e.onchange = load);
  await load();
}
