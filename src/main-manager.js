import './styles/base.css';
import './styles/owner.css';
import { supabase } from './lib/supabase.js';
import { requireLogin, blockedScreen } from './lib/auth.js';
import { istToday, fetchRosterRows } from './lib/roster.js';
import { buildTeamDays, sumDays, fetchSummaries, inr, num, fmtX, esc, fmtDate, teamName } from './lib/calc.js';
import { entryValue } from './lib/value.js';

const $ = id => document.getElementById(id);
const TODAY = istToday();
let SEL = TODAY, SUP = '';
let D = { sups: [], teams: [], products: [], workers: [], rosters: [], summaries: [] };

const css = document.createElement('style');
css.textContent = `
body.mgr{margin:0;background:var(--bg,#f4f6f9);font-family:Inter,system-ui,sans-serif;color:var(--ink,#101828)}
.mgr-top{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 16px;background:#fff;border-bottom:1px solid var(--border,#e4e7ec);position:sticky;top:0;z-index:5}
.mgr-brand{font-weight:700;font-size:17px}.mgr-brand b{color:#1967D2}.mgr-brand span{font-weight:500;font-size:12px;color:#667085;margin-left:6px}
.mgr-actions{display:flex;gap:8px}
.refresh-btn{border:1px solid #d0d5dd;background:#fff;color:#1967D2;border-radius:8px;padding:6px 10px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.mgr-main{max-width:1100px;margin:0 auto;padding:16px}
.mgr-filters{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;margin-bottom:16px;padding:14px 16px}
.mgr-filters label{display:block;font-size:12px;font-weight:600;color:#667085;margin-bottom:5px}
.mgr-filters input,.mgr-filters select{padding:9px 10px;border:1px solid #d0d5dd;border-radius:8px;font-size:15px;background:#fff;min-width:160px}
.sup-block{margin-bottom:14px}
.sup-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.sup-head b{font-size:15px}.sup-head span{font-size:12px;color:#667085}
`;
document.head.appendChild(css);

async function loadAll() {
  const [sr, tr, pr, wr, rosters, summaries] = await Promise.all([
    supabase.from('fin_supervisors').select('*').order('name'),
    supabase.from('fin_teams').select('*'),
    supabase.from('fin_products').select('*'),
    supabase.from('workers').select('name, daily_rate'),
    fetchRosterRows(supabase), fetchSummaries(supabase),
  ]);
  D = { sups: sr.data || [], teams: tr.data || [], products: pr.data || [], workers: wr.data || [], rosters, summaries };
  const sel = $('m-sup');
  sel.innerHTML = '<option value="">All supervisors</option>' + D.sups.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  sel.value = SUP;
}

async function draw() {
  const body = $('m-body');
  const { data: logs, error } = await supabase.from('fin_production_log').select('*').eq('production_date', SEL).limit(20000);
  if (error) { body.innerHTML = `<div class="state-msg" style="color:#b91c1c">Error: ${esc(error.message)}. Has sql/add_manager.sql been run?</div>`; return; }
  const teamSup = new Map(D.teams.map(t => [t.id, t.supervisor_id]));
  const prod = new Map(D.products.map(p => [p.id, p]));
  const mine = (logs || []).filter(l => !SUP || teamSup.get(l.team_id) === SUP);
  const days = buildTeamDays(mine, D.teams, D.workers, D.rosters, D.summaries, D.products);
  const tot = sumDays(days);
  const pct = tot.value > 0 ? (tot.wage / tot.value) * 100 : 0;
  const working = new Set(mine.map(l => l.team_id)).size;

  // product totals
  const byProd = new Map();
  for (const l of mine) {
    const p = prod.get(l.product_id);
    const r = byProd.get(l.product_id) || { name: p?.name || 'Unknown', qty: 0, value: 0 };
    r.qty += Number(l.quantity || 0); r.value += entryValue(l.quantity, l.weight, p);
    byProd.set(l.product_id, r);
  }
  const plist = [...byProd.values()].sort((a, b) => b.qty - a.qty);

  const kpi = (icon, label, val, sub, accent) => `<div class="kpi-card" style="--accent-color:${accent}"><div class="kpi-icon">${icon}</div><div class="kpi-label">${label}</div><div class="kpi-value">${val}</div><div class="kpi-sub">${sub}</div></div>`;
  const prodTable = (list, withTotal = true) => `<div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th class="num">Quantity</th><th class="num">Value</th></tr></thead><tbody>${list.map(r => `<tr><td class="bold">${esc(r.name)}</td><td class="num">${num(r.qty)}</td><td class="num">${inr(r.value)}</td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--ink-dim)">No production</td></tr>'}</tbody>${withTotal && list.length ? `<tfoot><tr style="font-weight:700;background:var(--bg)"><td>Total</td><td class="num">${num(list.reduce((s, r) => s + r.qty, 0))}</td><td class="num">${inr(list.reduce((s, r) => s + r.value, 0))}</td></tr></tfoot>` : ''}</table></div>`;

  // per supervisor blocks
  const supIds = [...new Set(mine.map(l => teamSup.get(l.team_id)))];
  const blocks = supIds.map(sid => {
    const s = D.sups.find(x => x.id === sid);
    const ls = mine.filter(l => teamSup.get(l.team_id) === sid);
    const t = sumDays(buildTeamDays(ls, D.teams, D.workers, D.rosters, D.summaries, D.products));
    const m = new Map();
    for (const l of ls) { const p = prod.get(l.product_id); const r = m.get(l.product_id) || { name: p?.name || 'Unknown', qty: 0, value: 0 }; r.qty += Number(l.quantity || 0); r.value += entryValue(l.quantity, l.weight, p); m.set(l.product_id, r); }
    return { s, t, list: [...m.values()].sort((a, b) => b.qty - a.qty) };
  }).sort((a, b) => b.t.value - a.t.value);

  body.innerHTML = `
    <div class="kpi-grid">
      ${kpi('🏭', 'Units Made', num(tot.units), `${plist.length} products · ${working} team${working === 1 ? '' : 's'} working`, 'var(--primary)')}
      ${kpi('💰', 'Value Produced', inr(tot.value), 'at selling price', 'var(--green)')}
      ${kpi('👷', 'Labour Cost', inr(tot.wage), '1.5× overtime included', 'var(--red)')}
      ${kpi('🧮', 'Labour % of Value', tot.value > 0 ? pct.toFixed(1) + '%' : '—', `${inr(tot.wage)} ÷ ${inr(tot.value)}`, 'var(--orange)')}
      ${kpi('📈', 'Value ÷ Labour', fmtX(tot.ratio), 'higher is better', 'var(--purple)')}
    </div>
    <div class="section-head"><div><div class="section-title">Products made — ${fmtDate(SEL)}</div><div class="section-sub">${SUP ? esc(D.sups.find(s => s.id === SUP)?.name || '') : 'All supervisors'}</div></div></div>
    ${prodTable(plist)}
    ${SUP ? '' : `<div class="section-head"><div><div class="section-title">Supervisor-wise</div><div class="section-sub">Who made which product and how much</div></div></div>
    ${blocks.map(b => `<div class="sup-block"><div class="sup-head"><b>${esc(b.s?.name || 'Supervisor')}</b><span>${num(b.t.units)} units · ${inr(b.t.value)} value · labour ${inr(b.t.wage)} (${b.t.value > 0 ? (b.t.wage / b.t.value * 100).toFixed(1) + '%' : '—'})</span></div>${prodTable(b.list, false)}</div>`).join('') || '<div class="state-msg">No production on this day</div>'}`}`;
}

async function refresh() { try { await draw(); } catch (e) { $('m-body').innerHTML = `<div class="state-msg" style="color:#b91c1c">Error: ${esc(e.message)}</div>`; } }

requireLogin().then(async me => {
  if (!me.manager && !me.admin) return blockedScreen('Manager access only');
  $('mgr-logout').onclick = async () => { await supabase.auth.signOut(); location.reload(); };
  const d = $('m-date'); d.value = SEL; d.max = TODAY;
  d.onchange = () => { if (!d.value) return; SEL = d.value > TODAY ? TODAY : d.value; d.value = SEL; refresh(); };
  $('m-today').onclick = () => { SEL = TODAY; d.value = SEL; refresh(); };
  $('m-sup').onchange = e => { SUP = e.target.value; refresh(); };
  await loadAll(); await refresh();
  supabase.channel('fin-mgr').on('postgres_changes', { event: '*', schema: 'public', table: 'fin_production_log' }, () => refresh()).subscribe();
});
