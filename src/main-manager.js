import './styles/base.css';
import './styles/owner.css';
import { supabase } from './lib/supabase.js';
import { requireLogin, blockedScreen } from './lib/auth.js';
import { istToday, fetchRosterRows, rosterIndex, teamsForDay, membersForDay } from './lib/roster.js';
import { buildTeamDays, sumDays, fetchSummaries, inr, num, fmtX, esc, fmtDate, teamName } from './lib/calc.js';
import { entryValue } from './lib/value.js';
import { renderInventory } from './pages/owner/inventory.js';

const $ = id => document.getElementById(id);
const TODAY = istToday();
let SEL = TODAY, SUP = '', Q = '', MONEY = false;
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
.mgr-tabs{display:flex;gap:8px;margin-bottom:12px}.mgr-tab{flex:1;border:1px solid #d0d5dd;background:#fff;border-radius:10px;padding:10px;font-size:14px;font-weight:600;color:#667085;cursor:pointer}.mgr-tab.on{background:#1967D2;border-color:#1967D2;color:#fff}
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

let CACHE = null;
async function draw(force = false) {
  const body = $('m-body');
  let logs, error;
  if (CACHE && CACHE.date === SEL && !force) logs = CACHE.logs;
  else { const r = await supabase.from('fin_production_log').select('*').eq('production_date', SEL).limit(20000); logs = r.data; error = r.error; if (!error) CACHE = { date: SEL, logs }; }
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
  const shown = plist.filter(r => !Q || r.name.toLowerCase().includes(Q.toLowerCase()));

  const kpi = (icon, label, val, sub, accent) => `<div class="kpi-card" style="--accent-color:${accent}"><div class="kpi-icon">${icon}</div><div class="kpi-label">${label}</div><div class="kpi-value">${val}</div><div class="kpi-sub">${sub}</div></div>`;

  body.innerHTML = `
    <div class="kpi-grid">
      ${kpi('🏭', 'Units Made', num(tot.units), `${plist.length} products · ${working} team${working === 1 ? '' : 's'} working`, 'var(--primary)')}
      ${MONEY ? kpi('💰', 'Value Produced', inr(tot.value), 'at selling price', 'var(--green)') : kpi('📦', 'Products', num(plist.length), 'types made', 'var(--green)')}
      ${MONEY ? kpi('👷', 'Labour Cost', inr(tot.wage), '1.5× overtime included', 'var(--red)') : ''}
      ${MONEY ? kpi('🧮', 'Labour % of Value', tot.value > 0 ? pct.toFixed(1) + '%' : '—', `${inr(tot.wage)} ÷ ${inr(tot.value)}`, 'var(--orange)') : ''}
      ${MONEY ? kpi('📈', 'Value ÷ Labour', fmtX(tot.ratio), 'higher is better', 'var(--purple)') : ''}
    </div>
    <div class="section-head"><div><div class="section-title">Products made — ${fmtDate(SEL)}</div><div class="section-sub">${SUP ? esc(D.sups.find(s => s.id === SUP)?.name || '') : 'All supervisors'} · ${num(tot.units)} units${MONEY ? ' · ' + inr(tot.value) : ''}</div></div></div>
    <div class="card" style="margin-bottom:12px;"><input id="m-q" placeholder="Search product…" value="${esc(Q)}" autocomplete="off" style="width:100%;padding:9px 10px;border:1px solid var(--border-strong);border-radius:8px;font-size:14px;box-sizing:border-box;" /></div>
    <div class="inv-grid">${shown.map(r => `<div class="inv-card"><div class="prod-name">${esc(r.name)}</div><div class="inv-stat"><span class="lbl" style="font-weight:600;">Total made</span><span class="val" style="color:var(--primary);font-size:18px;">${num(r.qty)}</span></div>${MONEY ? `<div class="inv-stat"><span class="lbl">Value</span><span class="val">${inr(r.value)}</span></div>` : ''}</div>`).join('') || '<div class="state-msg">No production found</div>'}</div>`;
  drawTeamsTab(mine, teamSup, prod);
  const qi = $('m-q');
  qi.oninput = () => { Q = qi.value; const pos = qi.selectionStart; draw(false); const n = $('m-q'); n.focus(); n.setSelectionRange(pos, pos); };
}

// Third section: which supervisor made which team, with which labourers, and which products (no money)
function drawTeamsTab(mine, teamSup, prod) {
  const idx = rosterIndex(D.rosters);
  const supTeams = D.teams.filter(t => !SUP || t.supervisor_id === SUP);
  const dayT = teamsForDay(idx, supTeams, SEL, mine);
  const sups = D.sups.filter(s => !SUP || s.id === SUP);
  const blocks = sups.map(s => {
    const ts = dayT.filter(t => t.supervisor_id === s.id);
    if (!ts.length) return '';
    const cards = ts.map(t => {
      const ls = mine.filter(l => l.team_id === t.id);
      const members = membersForDay(idx, t.id, SEL, ls.length > 0);
      const by = new Map();
      for (const l of ls) { const p = prod.get(l.product_id); by.set(l.product_id, { name: p?.name || 'Unknown', qty: (by.get(l.product_id)?.qty || 0) + Number(l.quantity || 0) }); }
      const plist = [...by.values()].sort((a, b) => b.qty - a.qty);
      const units = plist.reduce((a, r) => a + r.qty, 0);
      return `<div class="card" style="margin-bottom:12px;padding:14px 16px">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px"><b>${esc(teamName(t))}</b><span style="font-size:12px;color:#667085">${members.length} labourer${members.length === 1 ? '' : 's'} · ${num(units)} units</span></div>
        <div style="font-size:12px;font-weight:600;color:#667085;margin-bottom:5px">Labourers</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${members.map(m => `<span style="background:#eaf1fc;color:#1967D2;border-radius:999px;padding:4px 10px;font-size:13px;font-weight:600">${esc(m)}</span>`).join('') || '<span style="color:#667085;font-size:13px">No labourers listed</span>'}</div>
        <div style="font-size:12px;font-weight:600;color:#667085;margin-bottom:5px">Products made</div>
        <div class="table-wrap"><table class="data-table"><tbody>${plist.map(r => `<tr><td class="bold">${esc(r.name)}</td><td class="num">${num(r.qty)}</td></tr>`).join('') || '<tr><td style="color:#667085">Nothing logged yet</td></tr>'}</tbody></table></div>
      </div>`;
    }).join('');
    return `<div class="section-head"><div><div class="section-title">${esc(s.name)}</div><div class="section-sub">${ts.length} team${ts.length === 1 ? '' : 's'} · ${fmtDate(SEL)}</div></div></div>${cards}`;
  }).join('');
  $('m-teams').innerHTML = blocks || `<div class="state-msg">No team made on ${fmtDate(SEL)}</div>`;
}

async function refresh() { try { await draw(true); } catch (e) { $('m-body').innerHTML = `<div class="state-msg" style="color:#b91c1c">Error: ${esc(e.message)}</div>`; } }

requireLogin().then(async me => {
  if (!me.manager && !me.admin) return blockedScreen('Master access only');
  MONEY = !!(me.owner2 || me.admin);
  $('mgr-logout').onclick = async () => { await supabase.auth.signOut(); location.reload(); };
  const d = $('m-date'); d.value = SEL; d.max = TODAY;
  d.onchange = () => { if (!d.value) return; SEL = d.value > TODAY ? TODAY : d.value; d.value = SEL; refresh(); };
  $('m-today').onclick = () => { SEL = TODAY; d.value = SEL; refresh(); };
  $('m-sup').onchange = e => { SUP = e.target.value; refresh(); };
  let invLoaded = false;
  document.querySelectorAll('.mgr-tab').forEach(b => b.onclick = async () => {
    document.querySelectorAll('.mgr-tab').forEach(x => x.classList.toggle('on', x === b));
    const inv = b.dataset.t === 'inv', tm = b.dataset.t === 'teams';
    $('m-filters').style.display = inv ? 'none' : ''; $('m-body').style.display = (inv || tm) ? 'none' : ''; $('m-inv').style.display = inv ? '' : 'none'; $('m-teams').style.display = tm ? '' : 'none';
    if (inv && !invLoaded) { invLoaded = true; try { await renderInventory($('m-inv'), { money: MONEY }); } catch (e) { $('m-inv').innerHTML = `<div class="state-msg" style="color:#b91c1c">Error: ${esc(e.message)}</div>`; } }
  });
  await loadAll(); await refresh();
  supabase.channel('fin-mgr').on('postgres_changes', { event: '*', schema: 'public', table: 'fin_production_log' }, () => refresh()).subscribe();
});
