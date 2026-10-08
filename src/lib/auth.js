import { supabase, HAS_KEYS } from './supabase.js';

const STYLE = `
#login-ov{position:fixed;inset:0;z-index:100000;background:#f4f6f9;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,system-ui,-apple-system,sans-serif}
#login-ov .box{background:#fff;border:1px solid #e4e7ec;border-radius:16px;padding:26px 22px;width:100%;max-width:380px;box-shadow:0 10px 30px rgba(16,24,40,.08)}
#login-ov h2{margin:0 0 4px;font-size:20px;color:#101828}
#login-ov p{margin:0 0 18px;color:#667085;font-size:13px}
#login-ov label{display:block;font-size:12px;font-weight:600;color:#344054;margin-bottom:5px}
#login-ov input{width:100%;box-sizing:border-box;font-size:16px;padding:11px 12px;border:1px solid #d0d5dd;border-radius:10px;margin-bottom:12px}
#login-ov .pw{position:relative}#login-ov .pw input{padding-right:62px}
#login-ov .pw button{position:absolute;right:6px;top:7px;border:0;background:none;color:#667085;font-weight:600;font-size:12px;cursor:pointer;padding:6px}
#login-ov .err{color:#b91c1c;font-size:13px;min-height:18px;margin-bottom:8px}
#login-ov .go{width:100%;border:0;background:#1967D2;color:#fff;font-weight:700;font-size:15px;padding:13px;border-radius:10px;cursor:pointer}
#login-ov .go:disabled{opacity:.6}
.logout-btn{margin-top:10px;width:100%;border:1px solid #d0d5dd;background:#fff;border-radius:8px;padding:8px;font-size:13px;font-weight:600;color:#667085;cursor:pointer}
.who{font-size:12px;color:#667085;margin-top:8px;word-break:break-all}
`;

function addLogout(email) {
  const f = document.querySelector('.sidebar-footer');
  if (!f || f.querySelector('.logout-btn')) return;
  const w = document.createElement('div'); w.className = 'who'; w.textContent = email;
  const b = document.createElement('button');
  b.className = 'logout-btn'; b.textContent = 'Logout';
  b.onclick = async () => { await supabase.auth.signOut(); location.reload(); };
  f.appendChild(b); f.appendChild(w);
}

function showLogin() {
  return new Promise((resolve) => {
    const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
    const ov = document.createElement('div'); ov.id = 'login-ov';
    ov.innerHTML = `
      <form class="box" autocomplete="on">
        <h2>🔒 Sign in</h2>
        <p>Factory OS · Finishing. Enter your login ID and password.</p>
        <label>Login ID</label><input id="lg-email" type="email" name="username" autocomplete="username" inputmode="email" placeholder="name@gfpl.com" required />
        <label>Password</label><div class="pw"><input id="lg-pass" type="password" name="password" autocomplete="current-password" required /><button type="button" id="lg-show">Show</button></div>
        <div class="err" id="lg-err">${HAS_KEYS ? '' : 'Setup incomplete: add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Render, then redeploy.'}</div>
        <button class="go" id="lg-go" type="submit">Sign in</button>
      </form>`;
    document.body.appendChild(ov);
    const $ = (s) => ov.querySelector(s);
    $('#lg-show').onclick = () => { const i = $('#lg-pass'); const s = i.type === 'password'; i.type = s ? 'text' : 'password'; $('#lg-show').textContent = s ? 'Hide' : 'Show'; };
    $('form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('#lg-go'); btn.disabled = true; btn.textContent = 'Signing in…'; $('#lg-err').textContent = '';
      const { error } = await supabase.auth.signInWithPassword({ email: $('#lg-email').value.trim(), password: $('#lg-pass').value });
      if (error) { btn.disabled = false; btn.textContent = 'Sign in'; $('#lg-err').textContent = /invalid login credentials/i.test(error.message) ? 'Wrong login ID or password' : (/api key/i.test(error.message) ? 'App key problem (VITE_SUPABASE_ANON_KEY wrong or not deployed): ' : '') + error.message; return; }
      ov.remove(); resolve();
    };
  });
}

/**
 * Resolves once signed in. Returns { email, admin, supervisor } where supervisor is the fin_supervisors row
 * for supervisor accounts (null for the owner).
 */
export async function requireLogin() {
  const { data } = await supabase.auth.getSession();
  if (!data?.session) await showLogin();
  const { data: u } = await supabase.auth.getUser();
  const email = (u?.user?.email || '').toLowerCase();
  addLogout(email);
  supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.reload(); });
  const admin = email === 'admin@gfpl.com';
  let supervisor = null;
  if (!admin) {
    const { data: s } = await supabase.from('fin_supervisors').select('*').eq('email', email).maybeSingle();
    supervisor = s || null;
  }
  return { email, admin, supervisor };
}

export function blockedScreen(msg) {
  document.body.innerHTML = `<div style="font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center;color:#101828"><div><div style="font-size:40px">🔒</div><h2>${msg}</h2><p style="color:#667085">Ask the owner to check your login.</p><button onclick="(async()=>{const m=await import('/src/lib/supabase.js');await m.supabase.auth.signOut();location.reload()})()" style="margin-top:12px;padding:10px 18px;border-radius:8px;border:1px solid #d0d5dd;background:#fff;font-weight:600;cursor:pointer">Logout</button></div></div>`;
}
