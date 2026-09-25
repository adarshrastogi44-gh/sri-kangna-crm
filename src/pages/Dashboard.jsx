import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, CustomerPicker, Empty, ErrorBox, Loading, Modal, VisitForm, BillForm, CustomerForm, WhatsAppMenu } from '../components';
import { addDays, customerMap, daysUntil, fetchAll, fmtDate, inr, invalidateCustomers, parseItems, today } from '../utils';

// ---------- small inline icons ----------
const I = {
  rupee: <path d="M7 5h10M7 9h10M8 5c5 0 5 8 0 8h-1l7 7" />,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 14.5h2" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-4 3.3-6 6.5-6s6 2 6.5 6" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .7 3.3 2.7 3.5 6" /></>,
  cake: <><path d="M4 21h16v-8H4z" /><path d="M4 16c2 1.5 4 1.5 6 0s4-1.5 6 0 3 1.2 4 .5M12 13V9M12 6.5v-.01" /></>,
  heart: <path d="M12 20s-8-4.6-8-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 8 2.8C20 15.4 12 20 12 20z" />,
  repeat: <><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></>,
  userX: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.5-4 3.3-6 6.5-6s6 2 6.5 6M17 9l4 4M21 9l-4 4" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
};
const Icon = ({ name, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{I[name]}</svg>
);

// Hidden/visible preference for money values (remembered in this browser)
function useHidden(key) {
  const k = `sk-hide-${key}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(k) !== '0'; } catch { return true; } });
  const toggle = () => setHidden((h) => { try { localStorage.setItem(k, h ? '0' : '1'); } catch { /* ignore */ } return !h; });
  return [hidden, toggle];
}

const Dots = () => <span className="dots" aria-label="Hidden">●●●●●●</span>;

function MetricCard({ label, value, icon, hideKey, children, onClick }) {
  const [hidden, toggle] = useHidden(hideKey || label);
  const canHide = Boolean(hideKey);
  return (
    <div className={`metric ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <div className="metric-top">
        <div className="metric-label">{label}</div>
        <div className="metric-icons">
          {canHide && (
            <button type="button" className="eye" onClick={(e) => { e.stopPropagation(); toggle(); }} title={hidden ? 'Show value' : 'Hide value'} aria-label={hidden ? 'Show value' : 'Hide value'}>
              <Icon name={hidden ? 'eyeOff' : 'eye'} size={18} />
            </button>
          )}
          <span className="metric-icon"><Icon name={icon} /></span>
        </div>
      </div>
      <div className="metric-value">{canHide && hidden ? <Dots /> : value}</div>
      {children}
    </div>
  );
}

const PERIODS = [['today', 'Today'], ['month', 'This Month'], ['90', '90 Days'], ['180', '6 Months'], ['365', '1 Year']];
function periodStart(p) {
  const t = today();
  if (p === 'today') return t;
  if (p === 'month') return t.slice(0, 8) + '01';
  return addDays(-(Number(p) - 1));
}

export default function Dashboard({ user, openCustomer, go }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const [tick, setTick] = useState(0);
  const [period, setPeriod] = useState('today');
  const [lookup, setLookup] = useState('');
  const [lookupKey, setLookupKey] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [bills, visits, fups, cmap, products] = await Promise.all([
          fetchAll(() => supabase.from('bills').select('*')),
          fetchAll(() => supabase.from('visits').select('customer_id,visit_date')),
          fetchAll(() => supabase.from('followups').select('*').or('status.is.null,status.neq.done').lte('due_date', today()).order('due_date')),
          customerMap(),
          supabase.from('products').select('name,category').then(({ data }) => data || []),
        ]);
        setD({ bills, visits, fups, cmap, catOf: Object.fromEntries(products.map((p) => [p.name, p.category || 'Other'])) });
      } catch (e) { setErr(e); }
    })();
  }, [tick]);

  const m = useMemo(() => {
    if (!d) return null;
    const t = today();
    const lifetime = d.bills.reduce((s, b) => s + Number(b.amount || 0), 0);
    const start = periodStart(period);
    const periodSales = d.bills.filter((b) => b.bill_date >= start && b.bill_date <= t).reduce((s, b) => s + Number(b.amount || 0), 0);

    // visits per customer & last activity (a bill also counts as activity)
    const visitsBy = {}; const last = {};
    d.visits.forEach((v) => { visitsBy[v.customer_id] = (visitsBy[v.customer_id] || 0) + 1; if (!last[v.customer_id] || v.visit_date > last[v.customer_id]) last[v.customer_id] = v.visit_date; });
    d.bills.forEach((b) => { if (!last[b.customer_id] || b.bill_date > last[b.customer_id]) last[b.customer_id] = b.bill_date; });
    const todays = new Set([...d.visits.filter((v) => v.visit_date === t).map((v) => v.customer_id), ...d.bills.filter((b) => b.bill_date === t).map((b) => b.customer_id)]);
    const cutoff = addDays(-30);
    const customers = Object.values(d.cmap);
    const inactive = customers.filter((c) => !last[c.id] || last[c.id] < cutoff);
    const repeat = customers.filter((c) => (visitsBy[c.id] || 0) >= 2);
    const md = t.slice(5);
    const bdays = customers.filter((c) => c.date_of_birth && c.date_of_birth.slice(5) === md);
    const annivs = customers.filter((c) => c.anniversary && c.anniversary.slice(5) === md);

    // sales per day, last 30 days
    const days = [...Array(30)].map((_, i) => addDays(i - 29));
    const byDay = Object.fromEntries(days.map((x) => [x, 0]));
    d.bills.forEach((b) => { if (b.bill_date in byDay) byDay[b.bill_date] += Number(b.amount || 0); });
    const series = days.map((x) => ({ day: x, value: byDay[x] }));

    // sales by category, last 30 days
    const cats = {};
    const add = (k, v) => { cats[k] = (cats[k] || 0) + v; };
    d.bills.filter((b) => b.bill_date >= days[0]).forEach((b) => {
      const amt = Number(b.amount || 0);
      const { lines, ok } = parseItems(b.items);
      const items = ok ? lines.filter((l) => l.name !== 'Discount') : [];
      if (items.length) {
        const sub = items.reduce((s, l) => s + l.qty * l.rate, 0) || 1;
        items.forEach((l) => add(d.catOf[l.name] || 'Other', (amt * l.qty * l.rate) / sub));
      } else {
        const parts = (b.items || 'Other').split(',').map((s) => s.trim()).filter(Boolean);
        parts.forEach((p) => add(p, amt / parts.length));
      }
    });
    const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]);

    const occasions = [];
    customers.forEach((c) => {
      if (c.date_of_birth) { const n = daysUntil(c.date_of_birth); if (n <= 7) occasions.push({ c, n, what: 'Birthday' }); }
      if (c.anniversary) { const n = daysUntil(c.anniversary); if (n <= 7) occasions.push({ c, n, what: 'Anniversary' }); }
    });
    occasions.sort((a, b) => a.n - b.n);

    return {
      lifetime, periodSales, avg: d.bills.length ? lifetime / d.bills.length : 0,
      todays: [...todays].map((id) => d.cmap[id]).filter(Boolean), bdays, annivs, repeat, inactive,
      series, catRows, occasions, fups: d.fups.map((f) => ({ ...f, c: d.cmap[f.customer_id] })),
    };
  }, [d, period]);

  const done = () => { setModal(null); setTick((x) => x + 1); };

  if (err) return <ErrorBox error={err} />;
  if (!m) return <Loading />;

  const listModal = (title, people, note) => setModal({ title, people, note });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="dash-title">Dashboard</h1>
          <p className="muted dash-sub">Overview of today's activity across the store.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => go('campaigns')}>📣 Campaigns</button>
          <button className="btn" onClick={() => setModal('customer')}>+ Customer</button>
          <button className="btn" onClick={() => setModal('visit')}>+ Visit</button>
          <button className="btn primary" onClick={() => setModal('bill')}>+ Add Bill</button>
        </div>
      </div>

      <section className="card lookup-card">
        <h2>Customer check: new or existing?</h2>
        <CustomerPicker key={lookupKey} value={lookup} onChange={setLookup} />
        {lookup && (
          <div className="lookup-result">
            <span className="muted small">What next?</span>
            <div className="actions">
              <button className="btn" onClick={() => openCustomer(lookup)}>Open profile</button>
              <button className="btn primary" onClick={() => setModal({ billFor: lookup })}>+ New bill</button>
              <button className="btn ghost" onClick={() => { setLookup(''); setLookupKey((k) => k + 1); }}>Check another</button>
            </div>
          </div>
        )}
      </section>

      <div className="metrics">
        <MetricCard label="Total Sales" value={inr(m.periodSales)} icon="rupee" hideKey="total">
          <div className="tabs period-tabs" onClick={(e) => e.stopPropagation()}>
            {PERIODS.map(([k, l]) => <button key={k} className={period === k ? 'active' : ''} onClick={() => setPeriod(k)}>{l}</button>)}
          </div>
        </MetricCard>
        <MetricCard label="Lifetime Sales" value={inr(m.lifetime)} icon="wallet" hideKey="lifetime" />
        <MetricCard label="Average Bill Value" value={inr(Math.round(m.avg))} icon="receipt" hideKey="avg" />

        <MetricCard label="Today's Customers" value={m.todays.length} icon="users" onClick={() => listModal("Today's customers", m.todays)} />
        <MetricCard label="Birthdays Today" value={m.bdays.length} icon="cake" onClick={() => listModal('Birthdays today', m.bdays, 'birthday')} />
        <MetricCard label="Anniversaries Today" value={m.annivs.length} icon="heart" onClick={() => listModal('Anniversaries today', m.annivs, 'anniversary')} />

        <MetricCard label="Repeat Customers" value={m.repeat.length} icon="repeat" onClick={() => listModal('Repeat customers (2+ visits)', m.repeat)} />
        <MetricCard label="Inactive Customers (30+ days)" value={m.inactive.length} icon="userX" onClick={() => listModal('Inactive customers (no visit in 30+ days)', m.inactive, 'collection')} />
      </div>

      <div className="dash-charts">
        <section className="card">
          <h2>Sales — Last 30 Days</h2>
          <LineChart data={m.series} />
        </section>
        <section className="card">
          <h2>Sales by Category</h2>
          {m.catRows.length === 0 ? <Empty>No sales in the last 30 days.</Empty> : <CategoryBars rows={m.catRows} />}
        </section>
      </div>

      <div className="cols">
        <section className="card">
          <h2>Follow-ups due</h2>
          {m.fups.length === 0 ? <Empty>Nothing due today.</Empty> : (
            <ul className="list">
              {m.fups.map((f) => (
                <li key={f.id} onClick={() => openCustomer(f.customer_id)}>
                  <div><strong>{f.c?.name || 'Unknown'}</strong><div className="muted small">{f.notes || '—'}</div></div>
                  <div className="right">{f.due_date < today() ? <Badge tone="red">Overdue · {fmtDate(f.due_date)}</Badge> : <Badge tone="amber">Today</Badge>}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Birthdays &amp; anniversaries (next 7 days)</h2>
          {m.occasions.length === 0 ? <Empty>None coming up.</Empty> : (
            <ul className="list">
              {m.occasions.map((o, i) => (
                <li key={i} onClick={() => openCustomer(o.c.id)}>
                  <div><strong>{o.c.name}</strong><div className="muted small">{o.what}{o.c.phone ? ` · ${o.c.phone}` : ''}</div></div>
                  <div className="right" onClick={(e) => e.stopPropagation()}>
                    <Badge tone={o.n === 0 ? 'green' : 'gray'}>{o.n === 0 ? 'Today' : o.n === 1 ? 'Tomorrow' : `In ${o.n} days`}</Badge>
                    <WhatsAppMenu customer={o.c} small only={[o.what === 'Birthday' ? 'birthday' : 'anniversary']} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {modal?.people && (
        <Modal title={`${modal.title} · ${modal.people.length}`} onClose={() => setModal(null)}>
          {modal.people.length === 0 ? <Empty>No one yet.</Empty> : (
            <ul className="list people-list">
              {modal.people.slice(0, 300).map((c) => (
                <li key={c.id} onClick={() => { setModal(null); openCustomer(c.id); }}>
                  <div><strong>{c.name}</strong><div className="muted small">{c.phone || ''}</div></div>
                  {modal.note && <div className="right" onClick={(e) => e.stopPropagation()}><WhatsAppMenu customer={c} small only={[modal.note]} /></div>}
                </li>
              ))}
            </ul>
          )}
          {modal.people.length > 300 && <p className="muted small">Showing first 300.</p>}
        </Modal>
      )}
      {modal === 'visit' && <Modal title="Record a visit" onClose={() => setModal(null)}><VisitForm user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
      {modal?.billFor && <Modal title="New bill" onClose={() => setModal(null)}><BillForm customerId={modal.billFor} user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
      {modal === 'bill' && <Modal title="New bill" onClose={() => setModal(null)}><BillForm user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
      {modal === 'customer' && (
        <Modal title="New customer" onClose={() => setModal(null)}>
          <CustomerForm onSaved={(c) => { invalidateCustomers(); setModal(null); openCustomer(c.id); }} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </>
  );
}

// Line chart of daily sales with hover tooltip
function LineChart({ data }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 220, L = 48, R = 12, T = 12, B = 28;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const x = (i) => L + (i * (W - L - R)) / (data.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  const short = (v) => (v >= 100000 ? `${+(v / 100000).toFixed(1)}L` : v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : v);
  const lbl = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const h = hover != null ? data[hover] : null;
  return (
    <div className="line-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="line-chart" role="img" aria-label="Daily sales for the last 30 days"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(data.length - 1, Math.round(((px - L) / (W - L - R)) * (data.length - 1)))));
        }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="axis">{short(v)}</text>
          </g>
        ))}
        {[0, 7, 14, 21, 29].map((i) => <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="axis">{lbl(data[i].day)}</text>)}
        <polyline points={`${L},${y(0)} ${pts} ${W - R},${y(0)}`} className="area" />
        <polyline points={pts} className="line" />
        {h && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross" />}
        {h && <circle cx={x(hover)} cy={y(h.value)} r="5" className="dot" />}
      </svg>
      {h && (
        <div className="tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="muted small">{lbl(h.day)}</div><b>{inr(h.value)}</b>
        </div>
      )}
    </div>
  );
}
function niceStep(max) {
  const raw = max / 4; const p = 10 ** Math.floor(Math.log10(raw)); const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function CategoryBars({ rows }) {
  const [hidden] = useHidden('cat');
  const total = rows.reduce((s, r) => s + r[1], 0);
  const max = rows[0][1];
  return (
    <div className="cat-bars">
      {rows.slice(0, 8).map(([name, v]) => (
        <div key={name} className="cat-row" title={`${name}: ${inr(Math.round(v))}`}>
          <div className="cat-name">{name}</div>
          <div className="cat-track"><div className="cat-fill" style={{ width: `${(v / max) * 100}%` }} /></div>
          <div className="cat-val">{hidden ? `${Math.round((v / total) * 100)}%` : inr(Math.round(v))}</div>
        </div>
      ))}
    </div>
  );
}
