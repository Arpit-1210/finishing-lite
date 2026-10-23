import './styles/base.css';
import { supabase, HAS_KEYS } from './lib/supabase.js';
import { requireLogin, blockedScreen } from './lib/auth.js';
import { entryValue, isKg, priceLabel } from './lib/value.js';
import { istToday, fetchRosterRows, rosterIndex, membersOn, conflictTeam, withRoster, saveRoster, hasExact, teamsForDay, membersForDay } from './lib/roster.js';
import { buildTeamDays, sumDays, fetchSummaries, inr, num, fmtX, esc, fmtDate, teamName } from './lib/calc.js';
import { startAutoClose, closeDays, loadMonthly, monthlyTableHTML } from './lib/dayclose.js';

const $ = id => document.getElementById(id);
const TODAY = istToday();
let SEL = TODAY;
let me = null;
let page = 'dashboard';
let supId = null;          // supervisor being worked on
let teamId = null;         // team selected on production page
let range = 0;
let D = { sups: [], teams: [], workers: [], products: [], rosters: [], logs: [], summaries: [] };

function toast(msg, type = 'success') {
  const el = $('toast'); $('toast-msg').textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── data ──
async function loadAll() {
  const [s, t, w, p, r, sm] = await Promise.all([
    supabase.from('fin_supervisors').select('*').eq('active', true).order('name'),
    supabase.from('fin_teams').select('*').eq('active', true).order('team_number'),
    supabase.from('workers').select('name, daily_rate, active').order('name'),
    supabase.from('fin_products').select('*').eq('active', true).order('name'),
    fetchRosterRows(supabase),
    fetchSummaries(supabase),
  ]);
  const err = s.error || t.error || p.error;
  if (err) throw err;
  D.sups = s.data || []; D.teams = t.data || []; D.workers = (w.data || []).filter(x => x.active !== false);
  D.products = p.data || []; D.rosters = r; D.summaries = sm;
  await loadLogs();
}
async function loadLogs() {
  let from = SEL, to = SEL;
  if (page === 'log' && range > 0) from = new Date(Date.parse(SEL) - range * 86400000).toISOString().slice(0, 10);
  if (page === 'reports') from = new Date(Date.parse(SEL) - 30 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from('fin_production_log').select('*').gte('production_date', from).lte('production_date', to).order('created_at', { ascending: false }).limit(20000);
  if (error) throw error;
  D.logs = data || [];
}
const myTeams = () => D.teams.filter(t => t.supervisor_id === supId);
const dayTeams = () => teamsForDay(rosterIndex(D.rosters), myTeams(), SEL, D.logs);
const membersToday = tid => membersForDay(rosterIndex(D.rosters), tid, SEL, D.logs.some(l => l.team_id === tid && l.production_date === SEL));
const supOf = t => D.sups.find(s => s.id === t.supervisor_id);
const prodName = id => D.products.find(p => p.id === id)?.name || '—';

// ── shell ──
const TITLES = { dashboard: 'Dashboard', production: 'Log Production', teams: 'Teams', log: 'History', reports: 'Reports' };
function closeSidebar() { $('sidebar').classList.remove('open'); $('overlay').classList.remove('open'); }
$('hamburger').onclick = () => { $('sidebar').classList.add('open'); $('overlay').classList.add('open'); };
$('overlay').onclick = closeSidebar;
document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => { page = b.dataset.page; closeSidebar(); rerender(true); });
document.querySelectorAll('#page-log .range-btn').forEach(b => b.onclick = () => {
  range = +b.dataset.days; document.querySelectorAll('#page-log .range-btn').forEach(x => x.classList.toggle('active', x === b)); rerender(true);
});
$('date-pill').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

function wireDate() {
  const inp = $('global-date'); inp.value = SEL; inp.max = TODAY;
  inp.onchange = () => { if (!inp.value) return; SEL = inp.value > TODAY ? TODAY : inp.value; rerender(true); };
  $('date-today').onclick = () => { SEL = TODAY; inp.value = SEL; rerender(true); };
}
function supSlot() {
  const slot = $('sup-slot');
  if (!me.admin) { slot.innerHTML = `<span class="sup-chip">👤 ${esc(me.supervisor.name)}</span>`; return; }
  slot.innerHTML = `<select id="sup-pick">${D.sups.map(s => `<option value="${s.id}" ${s.id === supId ? 'selected' : ''}>${esc(s.name)}</option>`).join('') || '<option value="">No supervisors yet</option>'}</select>`;
  $('sup-pick').onchange = e => { supId = e.target.value; teamId = null; rerender(false); };
}

async function rerender(reload = true) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page-view').forEach(v => v.classList.toggle('active', v.id === 'page-' + page));
  $('page-title').textContent = TITLES[page];
  $('date-note').textContent = SEL === TODAY ? 'Today' : (fmtDate(SEL) + ' · past date');
  $('global-date').value = SEL;
  try {
    if (reload) await loadLogs();
    if (!dayTeams().find(t => t.id === teamId)) teamId = dayTeams()[0]?.id || null;
    supSlot();
    ({ dashboard: drawDash, production: drawProd, teams: drawTeams, log: drawLog, reports: drawReports })[page]();
  } catch (e) { $(({ dashboard: 'dash', production: 'prod', teams: 'teams', log: 'log', reports: 'rep' })[page] + '-content').innerHTML = `<div class="state-msg" style="color:#b91c1c">Error: ${esc(e.message)}</div>`; }
}

// helpers
const ridx = () => rosterIndex(D.rosters);
function teamDaysFor(teams, logs) {
  const ids = new Set(teams.map(t => t.id));
  return buildTeamDays(logs.filter(l => ids.has(l.team_id)), D.teams, D.workers, D.rosters, D.summaries, D.products);
}
async function refreshClose(date) { if (date < TODAY) { await closeDays(supabase, [date]); D.summaries = await fetchSummaries(supabase); } }

const money = () => !!(me && me.admin); // prices/values are for the owner only

// ── dashboard ──
function drawDash() {
  const teams = dayTeams();
  if (!teams.length) { $('dash-content').innerHTML = `<div class="state-msg">No team made for ${fmtDate(SEL)} yet. Open the Teams page and make a team.</div>`; return; }
  const days = teamDaysFor(teams, D.logs).filter(r => r.date === SEL);
  const t = sumDays(days);
  const rows = teams.map(tm => {
    const r = days.find(d => d.teamId === tm.id);
    const members = membersToday(tm.id);
    return `<tr><td class="bold">${esc(teamName(tm))}</td><td class="num">${members.length}</td><td class="num">${r ? num(r.units) : '—'}</td>${money() ? `<td class="num">${r ? inr(r.value) : '—'}</td><td class="num">${r ? inr(r.wage) : '—'}</td><td class="num" style="font-weight:700">${r ? fmtX(r.ratio) : '—'}</td>` : ''}</tr>`;
  }).join('');
  $('dash-content').innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-icon">🏭</div><div class="kpi-label">Units</div><div class="kpi-value">${num(t.units)}</div><div class="kpi-sub">${fmtDate(SEL)}</div></div>
      ${money() ? `<div class="kpi-card" style="--ac:#16a34a"><div class="kpi-icon">💰</div><div class="kpi-label">Value Produced</div><div class="kpi-value">${inr(t.value)}</div><div class="kpi-sub">at selling price</div></div>
      <div class="kpi-card" style="--ac:#dc2626"><div class="kpi-icon">👷</div><div class="kpi-label">Labour Cost</div><div class="kpi-value">${inr(t.wage)}</div><div class="kpi-sub">1.5× overtime included</div></div>
      <div class="kpi-card" style="--ac:#7c3aed"><div class="kpi-icon">📈</div><div class="kpi-label">Value ÷ Labour</div><div class="kpi-value">${fmtX(t.ratio)}</div><div class="kpi-sub">higher is better</div></div>` : `<div class="kpi-card"><div class="kpi-icon">👷</div><div class="kpi-label">Teams</div><div class="kpi-value">${teams.length}</div><div class="kpi-sub">working today</div></div>`}
    </div>
    <div class="section-head"><div class="section-title">Teams — ${fmtDate(SEL)}</div></div>
    <div class="table-wrap"><table class="dt"><thead><tr><th>Team</th><th class="num">Workers</th><th class="num">Units</th>${money() ? '<th class="num">Value</th><th class="num">Labour Cost</th><th class="num">Value ÷ Labour</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ── production ──
function drawProd() {
  const teams = dayTeams();
  if (!teams.length) { $('prod-content').innerHTML = `<div class="state-msg">No team made for ${fmtDate(SEL)} yet.<br/><button class="btn-primary" style="margin-top:10px" onclick="document.querySelector('.nav-item[data-page=teams]').click()">+ Make a team</button></div>`; return; }
  const members = membersToday(teamId);
  const entries = D.logs.filter(l => l.team_id === teamId && l.production_date === SEL);
  const day = teamDaysFor(teams, entries)[0];
  $('prod-content').innerHTML = `
    <div class="team-tabs">${teams.map(t => `<button class="team-tab ${t.id === teamId ? 'active' : ''}" data-t="${t.id}">${esc(teamName(t))}</button>`).join('')}</div>
    <div class="prod-panel">
      <div style="font-size:12px;color:#667085;margin-bottom:6px">Workers on ${fmtDate(SEL)} (${members.length})</div>
      <div class="member-chips">${members.map(m => `<span class="chip">${esc(m)}</span>`).join('') || '<span style="color:#b45309;font-size:13px">No workers set for this day — add them on the Teams page.</span>'}</div>
      <div class="field"><label>Product</label><input id="p-prod" list="prod-list" placeholder="Type to search product…" autocomplete="off" /><datalist id="prod-list">${D.products.map(p => `<option value="${esc(p.name)}"></option>`).join('')}</datalist></div>
      <div class="field-row">
        <div class="field"><label>Quantity</label><input id="p-qty" type="number" inputmode="numeric" min="1" step="1" placeholder="0" /></div>
        <div class="field"><label>Weight kg <span id="p-wt-need" style="color:#b45309"></span></label><input id="p-wt" type="number" inputmode="decimal" min="0" step="0.1" placeholder="only for per-kg items" /></div>
      </div>
      <div class="field"><label>Time (optional)</label><input id="p-time" type="time" /></div>
      <div id="p-price-note" style="font-size:12px;color:#667085;margin:-4px 0 10px"></div>
      <button class="btn-primary" id="p-save" style="width:100%">Save Entry</button>
    </div>
    <div class="section-head"><div class="section-title">Entries — ${esc(teamName(teams.find(t => t.id === teamId)))} · ${fmtDate(SEL)}</div></div>
    ${day ? `<div class="kpi-grid"><div class="kpi-card"><div class="kpi-label">Units</div><div class="kpi-value">${num(day.units)}</div></div>${money() ? `<div class="kpi-card"><div class="kpi-label">Value</div><div class="kpi-value">${inr(day.value)}</div></div><div class="kpi-card"><div class="kpi-label">Labour</div><div class="kpi-value">${inr(day.wage)}</div></div><div class="kpi-card"><div class="kpi-label">Value ÷ Labour</div><div class="kpi-value">${fmtX(day.ratio)}</div></div>` : ''}</div>` : ''}
    ${entriesTable(entries)}`;
  $('prod-content').querySelectorAll('.team-tab').forEach(b => b.onclick = () => { teamId = b.dataset.t; drawProd(); });
  const prodNote = () => {
    const p = D.products.find(x => x.name.toLowerCase() === $('p-prod').value.trim().toLowerCase());
    $('p-price-note').textContent = p && money() ? `${inr(p.selling_price)} ${priceLabel(p)}` : '';
    $('p-wt-need').textContent = p && isKg(p) ? '(required)' : '';
  };
  $('p-prod').addEventListener('input', prodNote);
  $('p-save').onclick = saveEntry;
  // Keyboard: Enter / ↓ = next field, ↑ = previous, Enter on the last field = Save
  const order = ['p-prod', 'p-qty', 'p-wt', 'p-time'];
  order.forEach((id) => $(id).addEventListener('keydown', (e) => {
    const k = e.key; if (k !== 'Enter' && k !== 'ArrowDown' && k !== 'ArrowUp') return;
    if (id === 'p-prod' && k !== 'Enter' && !D.products.some(x => x.name.toLowerCase() === e.target.value.trim().toLowerCase())) return; // let the list open
    e.preventDefault();
    const i = order.indexOf(id);
    if (k === 'ArrowUp') { if (i > 0) $(order[i - 1]).focus(); return; }
    if (k === 'Enter' && i === order.length - 1) { saveEntry(); return; }
    if (i < order.length - 1) $(order[i + 1]).focus();
  }));
  wireDelete($('prod-content'));
}
function entriesTable(list, showTeam = false) {
  if (!list.length) return '<div class="state-msg">No entries</div>';
  const prodMap = new Map(D.products.map(p => [p.id, p]));
  return `<div class="table-wrap"><table class="dt"><thead><tr><th>Date</th>${showTeam ? '<th>Team</th>' : ''}<th>Product</th><th class="num">Qty</th>${money() ? '<th class="num">Value</th>' : ''}<th></th></tr></thead><tbody>${list.map(l => {
    const t = D.teams.find(x => x.id === l.team_id);
    return `<tr><td>${fmtDate(l.production_date)}${l.production_time ? ' · ' + esc(l.production_time) : ''}</td>${showTeam ? `<td>${esc(teamName(t))}</td>` : ''}<td class="bold">${esc(prodName(l.product_id))}</td><td class="num">${num(l.quantity)}${l.weight ? `<div style="font-size:11px;color:#667085">${num(l.weight)} kg</div>` : ''}</td>${money() ? `<td class="num">${inr(entryValue(l.quantity, l.weight, prodMap.get(l.product_id)))}</td>` : ''}<td><button class="btn-ghost" data-del="${l.id}" style="padding:4px 10px">Delete</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function wireDelete(root) {
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this entry?')) return;
    const l = D.logs.find(x => x.id === b.dataset.del);
    const { error } = await supabase.from('fin_production_log').delete().eq('id', b.dataset.del);
    if (error) return toast(error.message, 'error');
    toast('Deleted'); if (l) await refreshClose(l.production_date); rerender(true);
  });
}
async function saveEntry() {
  const name = $('p-prod').value.trim(); const qty = parseFloat($('p-qty').value);
  const p = D.products.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!p) return toast('Pick a product from the list', 'error');
  if (!(qty > 0)) return toast('Enter quantity', 'error');
  const wt = parseFloat($('p-wt').value);
  if (isKg(p) && !(wt > 0)) return toast('This product is priced per kg. Enter the weight', 'error');
  if (!teamId || !membersToday(teamId).length) return toast('Add workers to this team for this day first (Teams page)', 'error');
  const btn = $('p-save'); btn.disabled = true;
  const { error } = await supabase.from('fin_production_log').insert({ team_id: teamId, product_id: p.id, quantity: qty, production_date: SEL, production_time: $('p-time').value || null, ...(wt > 0 ? { weight: wt } : {}) });
  btn.disabled = false;
  if (error) return toast(error.message, 'error');
  toast('Saved ✓'); await refreshClose(SEL); rerender(true); setTimeout(() => { const f = document.getElementById('p-prod'); if (f) f.focus(); }, 150);
}

// ── teams ──
function drawTeams() {
  const teams = dayTeams(); const idx = ridx();
  const supName = t => supOf(t)?.name || '';
  $('teams-content').innerHTML = `
    <div class="prod-panel"><div style="font-size:12px;color:#667085;margin-bottom:8px">Every day starts with no teams. Make the teams you need for ${fmtDate(SEL)}.</div><div class="add-member-row"><input id="nt-name" placeholder="Team name (optional)" /><button class="btn-primary" id="nt-add" style="padding:9px 16px">+ Make a new team</button></div><button class="btn-ghost" id="nt-copy" style="margin-top:8px">Copy previous day's teams</button></div>
    ${teams.map(t => {
      const mem = membersToday(t.id);
      return `<div class="prod-panel" data-team="${t.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px"><div style="font-weight:700;font-size:15px">${esc(teamName(t))} <span style="font-weight:500;font-size:12px;color:#667085">· ${mem.length} workers on ${fmtDate(SEL)}${hasExact(idx, t.id, SEL) ? '' : ' (carried from earlier)'}</span></div>
        <div><button class="btn-ghost" data-rename="${t.id}" style="padding:4px 10px">Rename</button> <button class="btn-ghost" data-edit="${t.id}" style="padding:4px 10px">Edit workers</button></div></div>
        <div class="member-chips">${mem.map(m => `<span class="chip">${esc(m)}</span>`).join('') || '<span style="color:#667085;font-size:13px">No workers</span>'}</div>
        <div class="editor" id="ed-${t.id}"></div></div>`;
    }).join('') || '<div class="state-msg">No teams for this day yet — tap “Make a new team”.</div>'}`;
  $('nt-add').onclick = async () => {
    if (!supId) return toast('No supervisor selected', 'error');
    const nm = $('nt-name').value.trim();
    const active = new Set(dayTeams().map(t => String(t.id)));
    const idle = myTeams().filter(t => !active.has(String(t.id))).sort((a, b) => a.team_number - b.team_number)[0];
    try {
      if (idle) {
        await saveRoster(supabase, idle.id, SEL, []); D.rosters = withRoster(D.rosters, idle.id, SEL, []);
        if (nm) { const { error } = await supabase.from('fin_teams').update({ name: nm }).eq('id', idle.id); if (error) throw error; idle.name = nm; }
      } else {
        const n = Math.max(0, ...D.teams.filter(t => t.supervisor_id === supId).map(t => t.team_number)) + 1;
        const { data, error } = await supabase.from('fin_teams').insert({ supervisor_id: supId, team_number: n, name: nm || 'Team ' + n }).select().single();
        if (error) throw error;
        D.teams.push(data); await saveRoster(supabase, data.id, SEL, []); D.rosters = withRoster(D.rosters, data.id, SEL, []);
      }
    } catch (e) { return toast(e.message, 'error'); }
    toast('Team made for this day'); drawTeams();
  };
  $('nt-copy').onclick = async () => {
    const prevDates = D.rosters.map(r => r.roster_date).filter(d => d < SEL).sort();
    const prev = prevDates[prevDates.length - 1];
    if (!prev) return toast('No earlier day to copy', 'error');
    const ix = ridx(); const here = new Set(dayTeams().map(t => String(t.id)));
    const taken = new Set(D.teams.flatMap(t => (ix.get(String(t.id)) || []).find(e => e.date === SEL)?.members || []));
    let n = 0;
    for (const t of myTeams()) {
      if (here.has(String(t.id)) || !hasExact(ix, t.id, prev)) continue;
      const mem = membersForDay(ix, t.id, prev).filter(m => !taken.has(m));
      try { await saveRoster(supabase, t.id, SEL, mem); D.rosters = withRoster(D.rosters, t.id, SEL, mem); mem.forEach(m => taken.add(m)); n++; } catch (e) { return toast(e.message, 'error'); }
    }
    toast(n ? `Copied ${n} team${n > 1 ? 's' : ''} from ${fmtDate(prev)}` : 'Nothing new to copy'); drawTeams();
  };
  $('teams-content').querySelectorAll('[data-rename]').forEach(b => b.onclick = async () => {
    const t = D.teams.find(x => x.id === b.dataset.rename); const nm = prompt('Team name', teamName(t));
    if (!nm || !nm.trim()) return;
    const { error } = await supabase.from('fin_teams').update({ name: nm.trim() }).eq('id', t.id);
    if (error) return toast(error.message, 'error');
    t.name = nm.trim(); drawTeams();
  });
  $('teams-content').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit, supName));
}
function openEditor(tid, supName) {
  const box = $('ed-' + tid);
  if (box.innerHTML) { box.innerHTML = ''; return; }
  const idx = ridx(); let sel = new Set(membersToday(tid));
  const draw = (q = '') => {
    const list = D.workers.filter(w => w.name.toLowerCase().includes(q.toLowerCase()));
    box.innerHTML = `<div style="border-top:1px solid #e4e7ec;margin-top:10px;padding-top:10px">
      <input id="ws-${tid}" placeholder="Search worker…" value="${esc(q)}" style="width:100%;padding:9px 10px;border:1px solid #c9d0db;border-radius:8px;margin-bottom:8px;font-size:14px" />
      <div style="max-height:300px;overflow:auto;border:1px solid #e4e7ec;border-radius:8px">${list.map(w => {
        const c = sel.has(w.name) ? null : conflictTeam(idx, D.teams, tid, SEL, w.name, supName);
        return `<label style="display:flex;gap:10px;align-items:center;padding:9px 12px;border-bottom:1px solid #f0f2f5;${c ? 'opacity:.5' : ''}"><input type="checkbox" data-w="${esc(w.name)}" ${sel.has(w.name) ? 'checked' : ''} ${c ? 'disabled' : ''} /><span style="flex:1">${esc(w.name)}</span>${c ? `<span style="font-size:11px;color:#b45309">in ${esc(c)}</span>` : ''}</label>`;
      }).join('') || '<div class="state-msg">No match</div>'}</div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn-primary" id="sv-${tid}" style="flex:1">Save (${sel.size})</button><button class="btn-ghost" id="cx-${tid}">Cancel</button></div></div>`;
    box.querySelectorAll('input[type=checkbox]').forEach(c => c.onchange = () => { c.checked ? sel.add(c.dataset.w) : sel.delete(c.dataset.w); $('sv-' + tid).textContent = `Save (${sel.size})`; });
    const s = $('ws-' + tid); s.oninput = () => { draw(s.value); const n = $('ws-' + tid); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    $('cx-' + tid).onclick = () => { box.innerHTML = ''; };
    $('sv-' + tid).onclick = async () => {
      const members = [...sel];
      for (const m of members) { const c = conflictTeam(idx, D.teams, tid, SEL, m, supName); if (c) return toast(`${m} is already in ${c} today`, 'error'); }
      try { await saveRoster(supabase, tid, SEL, members); } catch (e) { return toast(e.message, 'error'); }
      D.rosters = withRoster(D.rosters, tid, SEL, members);
      await refreshClose(SEL);
      toast('Team saved ✓'); drawTeams();
    };
  };
  draw();
}

// ── history ──
function drawLog() {
  const ids = new Set(myTeams().map(t => t.id));
  const from = range > 0 ? new Date(Date.parse(SEL) - range * 86400000).toISOString().slice(0, 10) : SEL;
  const list = D.logs.filter(l => ids.has(l.team_id) && l.production_date >= from).sort((a, b) => (a.production_date < b.production_date ? 1 : -1));
  $('log-content').innerHTML = entriesTable(list, true);
  wireDelete($('log-content'));
}

// ── reports ──
async function drawReports() {
  const teams = myTeams();
  const days = teamDaysFor(teams, D.logs).sort((a, b) => (a.date < b.date ? 1 : -1));
  const byTeam = teams.map(t => ({ t, s: sumDays(days.filter(d => d.teamId === t.id)) }));
  const monthly = money() ? await loadMonthly(supabase, supId) : [];
  const M = money();
  $('rep-content').innerHTML = `
    <div class="section-head"><div><div class="section-title">Team performance — last 30 days</div>${M ? '<div class="section-sub">Value produced ÷ labour cost</div>' : ''}</div></div>
    <div class="table-wrap"><table class="dt"><thead><tr><th>Team</th><th class="num">Units</th>${M ? '<th class="num">Value</th><th class="num">Labour Cost</th><th class="num">Value ÷ Labour</th>' : ''}</tr></thead><tbody>${byTeam.map(({ t, s }) => `<tr><td class="bold">${esc(teamName(t))}</td><td class="num">${num(s.units)}</td>${M ? `<td class="num">${inr(s.value)}</td><td class="num">${inr(s.wage)}</td><td class="num" style="font-weight:700">${fmtX(s.ratio)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
    <div class="section-head"><div class="section-title">Day by day</div></div>
    <div class="table-wrap"><table class="dt"><thead><tr><th>Date</th><th>Team</th><th class="num">Units</th>${M ? '<th class="num">Value</th><th class="num">Labour Cost</th><th class="num">Value ÷ Labour</th>' : ''}</tr></thead><tbody>${days.map(d => `<tr><td>${fmtDate(d.date)}</td><td class="bold">${esc(d.team)}</td><td class="num">${num(d.units)}</td>${M ? `<td class="num">${inr(d.value)}</td><td class="num">${inr(d.wage)}</td><td class="num" style="font-weight:700">${fmtX(d.ratio)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${M ? 6 : 3}" style="text-align:center;padding:20px;color:#667085">No data</td></tr>`}</tbody></table></div>
    ${M ? `<div class="section-head"><div class="section-title">Monthly record</div></div>
    ${monthlyTableHTML(monthly, 'dt')}` : ''}`;
}

// ── start ──
(async function init() {
  wireDate();
  try {
    me = await requireLogin();
    if (!HAS_KEYS) return;
    if (me.manager) { location.replace('/manager.html'); return; }
    if (!me.admin && !me.supervisor) return blockedScreen('This login is not set up as a Finishing supervisor');
    if (me.admin) $('owner-link').style.display = '';
    await loadAll();
    supId = me.admin ? (D.sups[0]?.id || null) : me.supervisor.id;
    if (!me.admin && !D.sups.find(s => s.id === supId)) D.sups.push(me.supervisor);
    startAutoClose(supabase);
    rerender(false);
    supabase.channel('fin-live').on('postgres_changes', { event: '*', schema: 'public', table: 'fin_production_log' }, () => { if (['dashboard','log','reports'].includes(page)) rerender(true); }).subscribe();
  } catch (e) { document.querySelector('.app-content').innerHTML = `<div class="state-msg" style="color:#b91c1c">Error: ${esc(e.message)}. Has the setup SQL been run?</div>`; }
})();
