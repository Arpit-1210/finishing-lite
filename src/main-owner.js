import './styles/base.css';
import './styles/owner.css';
import { supabase } from './lib/supabase.js';
import { requireLogin, blockedScreen } from './lib/auth.js';
import { startAutoClose } from './lib/dayclose.js';
import { renderDashboard } from './pages/owner/dashboard.js';
import { renderProductionLog } from './pages/owner/productionLog.js';
import { renderOrg } from './pages/owner/org.js';
import { renderWorkers } from './pages/owner/workers.js';
import { renderProducts } from './pages/owner/products.js';

const pageRoot = document.getElementById('page-root');
const pageTitle = document.getElementById('page-title');
const pageSub = document.getElementById('page-sub');
const todayPill = document.getElementById('today-pill');
if (todayPill) todayPill.textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('sidebar-overlay');
document.getElementById('hamburger')?.addEventListener('click', () => { sidebar.classList.add('is-open'); overlay.classList.add('is-open'); });
overlay?.addEventListener('click', () => { sidebar.classList.remove('is-open'); overlay.classList.remove('is-open'); });

const routes = {
  dashboard: { hash: 'dashboard', title: 'Dashboard', sub: 'Live finishing overview', fn: renderDashboard },
  'production-log': { hash: 'production', title: 'Production Log', sub: 'All entries by supervisor, team & date', fn: renderProductionLog },
  org: { hash: 'supervisors', title: 'Supervisors & Teams', sub: 'Add supervisors, give logins, manage teams', fn: renderOrg },
  workers: { hash: 'workers', title: 'Workers', sub: 'Shared with Moulding · rates & status', fn: renderWorkers },
  products: { hash: 'products', title: 'Products', sub: 'Finishing catalogue & prices', fn: renderProducts },
};
const getRoute = () => { const h = location.hash.replace('#/', ''); return Object.keys(routes).find(k => routes[k].hash === h) || 'dashboard'; };

let authed = false;
async function navigate(route) {
  const r = routes[route];
  pageTitle.textContent = r.title; pageSub.textContent = r.sub;
  pageRoot.innerHTML = '<div class="state-msg" style="padding-top:60px;">Loading…</div>';
  document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.route === route));
  sidebar.classList.remove('is-open'); overlay?.classList.remove('is-open');
  try { await r.fn(pageRoot); }
  catch (e) { pageRoot.innerHTML = `<div class="state-msg" style="color:var(--red);">Error: ${e.message}. Has the setup SQL been run?</div>`; }
}
window.addEventListener('hashchange', () => { if (authed) navigate(getRoute()); });
requireLogin().then(me => {
  if (!me.admin) return blockedScreen('Owner access only');
  authed = true; navigate(getRoute()); startAutoClose(supabase);
});
