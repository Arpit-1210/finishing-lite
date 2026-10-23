// Daily team rosters. A team's members are fixed for ONE DAY only, and a worker can be in only ONE team on a day.
// effective roster for (team, date) = that date's saved roster, or the most recent earlier one
// (so a new day starts as a copy of the previous day).
export const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export async function fetchRosterRows(supabase) {
  const { data, error } = await supabase.from('fin_team_rosters').select('team_id, roster_date, members').limit(50000);
  if (error) { console.warn('fin_team_rosters not available:', error.message); return []; }
  return data || [];
}

export function rosterIndex(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = String(r.team_id);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ date: r.roster_date, members: r.members || [] });
  }
  for (const arr of m.values()) arr.sort((a, b) => (a.date < b.date ? -1 : 1));
  return m;
}

export function membersOn(index, teamId, date) {
  const arr = index.get(String(teamId));
  let res = [];
  if (!arr) return res;
  for (const e of arr) { if (e.date <= date) res = e.members; else break; }
  return res;
}

export function hasExact(index, teamId, date) {
  return (index.get(String(teamId)) || []).some(e => e.date === date);
}

/** Teams that exist ON this day: saved for the day, or (old data) have production logged that day. */
export function teamsForDay(index, teams, date, logs = []) {
  const logged = new Set(logs.filter(l => l.production_date === date).map(l => String(l.team_id)));
  return teams.filter(t => hasExact(index, t.id, date) || logged.has(String(t.id)))
    .sort(teamOrder); // fixed order — renaming never moves a team
}

/** Members for the day. New days start blank; old days that were logged but never saved fall back to carry-forward. */
export function membersForDay(index, teamId, date, hasLogs = false) {
  const e = (index.get(String(teamId)) || []).find(x => x.date === date);
  if (e) return e.members;
  return hasLogs ? membersOn(index, teamId, date) : [];
}

/** Name of ANOTHER team (any supervisor) that already has this worker on `date`, or null. */
export function conflictTeam(index, teams, teamId, date, worker, supName = () => '') {
  for (const t of teams) {
    if (String(t.id) === String(teamId)) continue;
    const e = (index.get(String(t.id)) || []).find(x => x.date === date);
    if (e && e.members.includes(worker)) return `${t.name || 'Team ' + t.team_number}${supName(t) ? ' (' + supName(t) + ')' : ''}`;
  }
  return null;
}

export function withRoster(rows, teamId, date, members) {
  const rest = rows.filter(r => !(String(r.team_id) === String(teamId) && r.roster_date === date));
  return [...rest, { team_id: String(teamId), roster_date: date, members }];
}

export async function saveRoster(supabase, teamId, date, members) {
  const { error } = await supabase.from('fin_team_rosters').upsert(
    { team_id: String(teamId), roster_date: date, members, updated_at: new Date().toISOString() },
    { onConflict: 'team_id,roster_date' }
  );
  if (error) throw error;
}

/** One fixed order for teams everywhere: team number, then creation time, then id. Never depends on name or edits. */
export function teamOrder(a, b) {
  return ((Number(a.team_number) || 0) - (Number(b.team_number) || 0))
    || String(a.created_at || '').localeCompare(String(b.created_at || ''))
    || String(a.id).localeCompare(String(b.id));
}
