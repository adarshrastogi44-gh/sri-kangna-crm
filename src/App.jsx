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

const PAGES = [
  ['dashboard', 'Dashboard'],
  ['customers', 'Customers'],
  ['visits', 'Visits'],
  ['bills', 'Bills'],
  ['followups', 'Follow-ups'],
  ['campaigns', 'Campaigns'],
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
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo">SK</span> Sri Kangna CRM</div>
        <nav>
          {PAGES.map(([key, label]) => (
            <button key={key} className={page === key || (page === 'customer' && key === 'customers') ? 'active' : ''} onClick={() => go(key)}>{label}</button>
          ))}
        </nav>
        <button className="btn ghost small signout" onClick={() => supabase.auth.signOut()} title={session.user.email}>Sign out</button>
      </header>
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
      </main>
    </div>
  );
}
