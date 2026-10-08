// Finishing has no weight. Performance = value of goods produced ÷ labour cost.
// Labour cost for one team on one day = sum of THAT DAY's roster members' daily_rate × OVERTIME,
// counted ONCE per team per day (not per production entry).
import { rosterIndex, membersOn } from './roster.js';

export const OVERTIME = 1.5; // peak season: every worker is paid 1.5x. Set to 1 when it ends.

export const inr = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const num = n => Number(n || 0).toLocaleString('en-IN');
export const fmtX = r => (r > 0 ? Number(r).toFixed(2) + '×' : '—');
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = s => { const [y, m, d] = String(s).split('-'); return `${+d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]} ${y}`; };
export const teamName = t => t?.name || 'Team ' + (t?.team_number ?? '—');

/**
 * One row per (team, day) that logged production:
 *   { date, teamId, team, supId, units, value, wage, ratio }   ratio = value / wage
 * Finished days use the wage frozen in fin_daily_summary, so later rate changes never alter history.
 */
export function buildTeamDays(logs, teams, workers, rosterRows = [], summaries = [], products = []) {
  const rate = new Map(workers.map(w => [w.name, Number(w.daily_rate || 0)]));
  const price = new Map(products.map(p => [p.id, Number(p.selling_price || 0)]));
  const teamMap = new Map(teams.map(t => [t.id, t]));
  const idx = rosterIndex(rosterRows);
  const frozen = new Map();
  for (const sm of summaries) for (const t of sm.teams || []) frozen.set(`${sm.summary_date}|${t.team_id}`, Number(t.wage || 0));
  const wageOf = (t, date) => membersOn(idx, t?.id, date).reduce((s, m) => s + (rate.get(m) || 0), 0) * OVERTIME;

  const rows = new Map();
  for (const l of logs) {
    const t = teamMap.get(l.team_id);
    const key = l.team_id + '|' + l.production_date;
    let r = rows.get(key);
    if (!r) {
      const fk = `${l.production_date}|${l.team_id}`;
      r = { date: l.production_date, teamId: l.team_id, team: teamName(t), supId: t?.supervisor_id, units: 0, value: 0, wage: frozen.has(fk) ? frozen.get(fk) : wageOf(t, l.production_date) };
      rows.set(key, r);
    }
    r.units += Number(l.quantity || 0);
    r.value += Number(l.quantity || 0) * (price.get(l.product_id) || 0);
  }
  return [...rows.values()].map(r => ({ ...r, ratio: r.wage > 0 ? r.value / r.wage : 0 }));
}

export function sumDays(list) {
  const s = list.reduce((a, r) => ({ units: a.units + r.units, value: a.value + r.value, wage: a.wage + r.wage }), { units: 0, value: 0, wage: 0 });
  return { ...s, ratio: s.wage > 0 ? s.value / s.wage : 0 };
}

export async function fetchSummaries(supabase) {
  const { data, error } = await supabase.from('fin_daily_summary').select('*').limit(5000);
  if (error) { console.warn('fin_daily_summary not available:', error.message); return []; }
  return data || [];
}
