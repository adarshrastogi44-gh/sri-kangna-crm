import { useEffect, useState } from 'react';
import { warmUp } from './utils';
import { supabase, configOk } from './supabase';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Visits from './pages/Visits';
import Bills from './pages/Bills';
import Followups from './pages/Followups';
import Reports from './pages/Reports';
import Items from './pages/Items';
import Settings from './pages/Settings';
import Campaigns from './pages/Campaigns';
import Staff from './pages/Staff';
import Expenses from './pages/Expenses';

const NAV_ICONS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  customers: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-4 3.3-6 6.5-6s6 2 6.5 6" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3.3 2.7 3.5 6" /></>,
  visits: <><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16" /><path d="M9 21v-5h6v5M9 8h2M13 8h2M9 12h2M13 12h2" /></>,
  bills: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  followups: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" /></>,
  campaigns: <><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z" /><path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" /></>,
  expenses: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 14.5h2" /></>,
  staff: <><circle cx="12" cy="7" r="4" /><path d="M4 21c.6-4.5 4-7 8-7s7.4 2.5 8 7" /></>,
  reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  items: <><path d="M20 7l-8-4-8 4 8 4 8-4z" /><path d="M4 7v10l8 4 8-4V7M12 11v10" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  signout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></>,
};
const NavIcon = ({ k }) => <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{NAV_ICONS[k]}</svg>;

const PAGES = [
  ['dashboard', 'Dashboard'],
  ['customers', 'Customers'],
  ['visits', 'Visits'],
  ['bills', 'Bills'],
  ['followups', 'Follow-ups'],
  ['campaigns', 'Campaigns'],
  ['expenses', 'Expenses'],
  ['staff', 'Staff'],
  ['reports', 'Reports'],
  ['items', 'Items'],
  ['settings', 'Settings'],
];

export default function App() {
  const [session, setSession] = useState(undefined);
  const [page, setPage] = useState('dashboard');
  const [customerId, setCustomerId] = useState(null);
  const [back, setBack] = useState('customers');

  useEffect(() => {
    if (!configOk) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Make sure the signed-in user has a profile row (bills/visits record who created them)
  useEffect(() => {
    const u = session?.user;
    if (!u) return;
    warmUp();
    (async () => {
      const { data } = await supabase.from('profiles').select('id').eq('id', u.id).maybeSingle();
      if (!data) await supabase.from('profiles').insert({ id: u.id, full_name: u.email });
    })().catch(() => {});
  }, [session?.user?.id]);

  if (!configOk) {
    return (
      <div className="center">
        <div className="card narrow">
          <h2>Setup needed</h2>
          <p>The Supabase settings are missing. In Vercel, add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> under Settings → Environment Variables, then redeploy.</p>
        </div>
      </div>
    );
  }
  if (session === undefined) return <div className="center muted">Loading…</div>;
  if (!session) return <Login />;

  const go = (p) => { setPage(p); setCustomerId(null); window.scrollTo(0, 0); };
  const openCustomer = (id) => { setBack(page === 'customer' ? back : page); setCustomerId(id); setPage('customer'); window.scrollTo(0, 0); };
  const props = { user: session.user, openCustomer, go };

  return (
    <div className="app with-sidebar">
      <aside className="sidebar">
        <div className="side-brand">
          <img src="/logo.png" alt="Sri Kangna" className="side-logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <div className="side-name">Sri Kangna <span>CRM</span></div>
        </div>
        <nav>
          {PAGES.map(([key, label]) => (
            <button key={key} className={page === key || (page === 'customer' && key === 'customers') ? 'active' : ''} onClick={() => go(key)}>
              <NavIcon k={key} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="side-signout" onClick={() => supabase.auth.signOut()} title={session.user.email}>
          <NavIcon k="signout" /><span>Sign out</span>
        </button>
      </aside>
      <main>
        {page === 'dashboard' && <Dashboard {...props} />}
        {page === 'customers' && <Customers {...props} />}
        {page === 'customer' && customerId && <CustomerDetail {...props} id={customerId} onBack={() => go(back)} />}
        {page === 'visits' && <Visits {...props} />}
        {page === 'bills' && <Bills {...props} />}
        {page === 'followups' && <Followups {...props} />}
        {page === 'reports' && <Reports {...props} />}
        {page === 'items' && <Items {...props} />}
        {page === 'settings' && <Settings {...props} />}
        {page === 'campaigns' && <Campaigns {...props} />}
        {page === 'staff' && <Staff {...props} />}
        {page === 'expenses' && <Expenses {...props} />}
      </main>
    </div>
  );
}
