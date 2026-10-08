import { supabase } from '../../lib/supabase.js';
import { esc, teamName } from '../../lib/calc.js';

const slug = n => n.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

export async function renderOrg(root) {
  async function load() {
    const [sr, tr] = await Promise.all([supabase.from('fin_supervisors').select('*').order('name'), supabase.from('fin_teams').select('*').order('team_number')]);
    if (sr.error) throw sr.error;
    const sups = sr.data || [], teams = tr.data || [];
    root.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div style="font-weight:700;margin-bottom:4px">Add supervisor</div>
        <div style="font-size:12px;color:var(--ink-dim);margin-bottom:10px">Login ID = name@gfpl.com · Password = name + 123 (e.g. Ramesh → ramesh@gfpl.com / ramesh123). Also creates Team 1 automatically.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="sn" placeholder="Supervisor name (one word)" style="flex:1;min-width:180px;padding:10px;border:1px solid var(--border-strong);border-radius:8px;font-size:14px"><button class="btn btn-primary" id="sadd">+ Add &amp; create login</button></div>
        <div id="smsg" style="margin-top:8px;font-size:13px"></div>
      </div>
      ${sups.map(s => {
        const ts = teams.filter(t => t.supervisor_id === s.id);
        return `<div class="card" style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div><div style="font-weight:700;font-size:15px">${esc(s.name)} ${s.active ? '' : '<span class="badge">inactive</span>'}</div><div style="font-size:12px;color:var(--ink-dim)">Login: ${esc(s.email)} · Password: ${esc(slug(s.name))}123</div></div>
          <div><button class="btn btn-sm" data-pw="${s.id}">Reset password</button> <button class="btn btn-sm" data-tog="${s.id}">${s.active ? 'Deactivate' : 'Activate'}</button></div></div>
          <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${ts.map(t => `<span class="badge badge-blue" style="padding:5px 10px">${esc(teamName(t))} ${t.active ? '' : '(off)'} <a href="#" data-tt="${t.id}" style="margin-left:6px;color:inherit">${t.active ? '✕' : '↺'}</a></span>`).join('') || '<span style="color:var(--ink-dim);font-size:12px">No teams</span>'}
          <button class="btn btn-sm" data-addteam="${s.id}">+ Team</button></div></div>`;
      }).join('') || '<div class="state-msg">No supervisors yet</div>'}`;
    const msg = t => { root.querySelector('#smsg').innerHTML = t; };
    async function makeLogin(name) {
      const email = slug(name) + '@gfpl.com';
      const { error } = await supabase.rpc('fin_create_login', { p_email: email, p_password: slug(name) + '123' });
      if (error) throw error; return email;
    }
    root.querySelector('#sadd').onclick = async () => {
      const name = root.querySelector('#sn').value.trim();
      if (!slug(name)) return msg('<span style="color:var(--red)">Enter a name</span>');
      try {
        const email = await makeLogin(name);
        const { data, error } = await supabase.from('fin_supervisors').insert({ name, email }).select().single();
        if (error) throw error;
        await supabase.from('fin_teams').insert({ supervisor_id: data.id, team_number: 1, name: 'Team 1' });
        load();
      } catch (e) { msg(`<span style="color:var(--red)">${esc(e.message)}</span>`); }
    };
    root.querySelectorAll('[data-pw]').forEach(b => b.onclick = async () => { const s = sups.find(x => x.id === b.dataset.pw); try { await makeLogin(s.name); alert(`Password reset to ${slug(s.name)}123`); } catch (e) { alert(e.message); } });
    root.querySelectorAll('[data-tog]').forEach(b => b.onclick = async () => { const s = sups.find(x => x.id === b.dataset.tog); await supabase.from('fin_supervisors').update({ active: !s.active }).eq('id', s.id); load(); });
    root.querySelectorAll('[data-addteam]').forEach(b => b.onclick = async () => { const id = b.dataset.addteam; const n = Math.max(0, ...teams.filter(t => t.supervisor_id === id).map(t => t.team_number)) + 1; await supabase.from('fin_teams').insert({ supervisor_id: id, team_number: n, name: 'Team ' + n }); load(); });
    root.querySelectorAll('[data-tt]').forEach(a => a.onclick = async e => { e.preventDefault(); const t = teams.find(x => x.id === a.dataset.tt); await supabase.from('fin_teams').update({ active: !t.active }).eq('id', t.id); load(); });
  }
  await load();
}
