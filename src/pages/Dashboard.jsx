import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, BarChart, Empty, ErrorBox, Loading, Modal, VisitForm, BillForm, CustomerForm, WhatsAppMenu } from '../components';
import { addMonths, customerMap, daysUntil, dueOf, fetchAll, fmtDate, inr, invalidateCustomers, monthKey, monthLabel, monthRange, today } from '../utils';

export default function Dashboard({ user, openCustomer }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const key = monthKey();
        const [ms, me] = monthRange(key);
        const [start6] = monthRange(addMonths(key, -5));
        const [visits6, bills6, dues, fups, cmap] = await Promise.all([
          fetchAll(() => supabase.from('visits').select('customer_id,visit_date').gte('visit_date', start6).lt('visit_date', me)),
          fetchAll(() => supabase.from('bills').select('customer_id,bill_date,amount,paid_amount').gte('bill_date', start6).lt('bill_date', me)),
          fetchAll(() => supabase.from('bills').select('customer_id,amount,paid_amount').or('payment_status.is.null,payment_status.neq.paid')),
          fetchAll(() => supabase.from('followups').select('*').or('status.is.null,status.neq.done').lte('due_date', today()).order('due_date')),
          customerMap(),
        ]);

        const visits = visits6.filter((v) => v.visit_date >= ms);
        const bills = bills6.filter((b) => b.bill_date >= ms);
        const months = [...Array(6)].map((_, i) => addMonths(key, i - 5));
        const salesChart = months.map((k) => ({ key: k, label: monthLabel(k, true).split(' ')[0], value: bills6.filter((b) => b.bill_date.startsWith(k)).reduce((s, b) => s + Number(b.amount || 0), 0) }));
        const visitsChart = months.map((k) => ({ key: k, label: monthLabel(k, true).split(' ')[0], value: visits6.filter((v) => v.visit_date.startsWith(k)).length }));

        const visitsBy = {};
        visits.forEach((v) => { visitsBy[v.customer_id] = (visitsBy[v.customer_id] || 0) + 1; });
        const spendBy = {};
        bills.forEach((b) => { spendBy[b.customer_id] = (spendBy[b.customer_id] || 0) + Number(b.amount || 0); });

        const top = Object.entries(spendBy)
          .map(([id, amt]) => ({ c: cmap[id], id, amt, visits: visitsBy[id] || 0 }))
          .sort((a, b) => b.amt - a.amt)
          .slice(0, 8);

        const occasions = [];
        Object.values(cmap).forEach((c) => {
          if (c.date_of_birth) { const n = daysUntil(c.date_of_birth); if (n <= 7) occasions.push({ c, n, what: 'Birthday' }); }
          if (c.anniversary) { const n = daysUntil(c.anniversary); if (n <= 7) occasions.push({ c, n, what: 'Anniversary' }); }
        });
        occasions.sort((a, b) => a.n - b.n);

        setD({
          key,
          visitCount: visits.length,
          visitors: Object.keys(visitsBy).length,
          repeat: Object.values(visitsBy).filter((n) => n >= 2).length,
          sales: bills.reduce((s, b) => s + Number(b.amount || 0), 0),
          collected: bills.reduce((s, b) => s + Number(b.paid_amount || 0), 0),
          billCount: bills.length,
          pendingDue: dues.reduce((s, b) => s + dueOf(b), 0),
          customers: Object.keys(cmap).length,
          fups: fups.map((f) => ({ ...f, c: cmap[f.customer_id] })),
          top,
          occasions,
          salesChart,
          visitsChart,
        });
      } catch (e) {
        setErr(e);
      }
    })();
  }, [tick]);

  const done = () => { setModal(null); setTick((t) => t + 1); };

  if (err) return <ErrorBox error={err} />;
  if (!d) return <Loading />;

  return (
    <>
      <div className="page-head">
        <h1>Dashboard <span className="muted light">· {monthLabel(d.key)}</span></h1>
        <div className="actions">
          <button className="btn" onClick={() => setModal('customer')}>+ Customer</button>
          <button className="btn" onClick={() => setModal('visit')}>+ Visit</button>
          <button className="btn primary" onClick={() => setModal('bill')}>+ Bill</button>
        </div>
      </div>

      <div className="stats">
        <Stat label="Sales this month" value={inr(d.sales)} sub={`${d.billCount} bills`} />
        <Stat label="Collected this month" value={inr(d.collected)} />
        <Stat label="Visits this month" value={d.visitCount} sub={`${d.visitors} customers`} />
        <Stat label="Repeat visitors" value={d.repeat} sub="2+ visits this month" />
        <Stat label="Pending dues (all time)" value={inr(d.pendingDue)} tone={d.pendingDue > 0 ? 'warn' : ''} />
        <Stat label="Total customers" value={d.customers} />
      </div>

      <div className="cols">
        <section className="card">
          <h2>Sales · last 6 months</h2>
          <BarChart data={d.salesChart} format={inr} label="Monthly sales for the last 6 months" />
        </section>
        <section className="card">
          <h2>Visits · last 6 months</h2>
          <BarChart data={d.visitsChart} format={(v) => `${v} visits`} label="Monthly visits for the last 6 months" />
        </section>
      </div>

      <div className="cols">
        <section className="card">
          <h2>Follow-ups due</h2>
          {d.fups.length === 0 ? <Empty>Nothing due today.</Empty> : (
            <ul className="list">
              {d.fups.map((f) => (
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
          {d.occasions.length === 0 ? <Empty>None coming up.</Empty> : (
            <ul className="list">
              {d.occasions.map((o, i) => (
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

      <section className="card">
        <h2>Top customers this month</h2>
        {d.top.length === 0 ? <Empty>No bills yet this month.</Empty> : (
          <table>
            <thead><tr><th>Customer</th><th className="num">Visits</th><th className="num">Purchases</th></tr></thead>
            <tbody>
              {d.top.map((t) => (
                <tr key={t.id} className="click" onClick={() => openCustomer(t.id)}>
                  <td>{t.c?.name || 'Unknown'}</td><td className="num">{t.visits}</td><td className="num">{inr(t.amt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {modal === 'visit' && <Modal title="Record a visit" onClose={() => setModal(null)}><VisitForm user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
      {modal === 'bill' && <Modal title="New bill" onClose={() => setModal(null)}><BillForm user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
      {modal === 'customer' && (
        <Modal title="New customer" onClose={() => setModal(null)}>
          <CustomerForm onSaved={(c) => { invalidateCustomers(); setModal(null); openCustomer(c.id); }} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </>
  );
}

function Stat({ label, value, sub, tone = '' }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
