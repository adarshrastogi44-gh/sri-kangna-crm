import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, Empty, ErrorBox, Loading, Modal, MonthPicker, Tags, VisitForm } from '../components';
import { addMonths, customerMap, downloadCSV, fetchAll, fmtDate, inr, monthKey, monthLabel, monthRange } from '../utils';

const PERIODS = [
  [1, 'This month'],
  [3, 'Last 3 months'],
  [6, 'Last 6 months'],
  [9, 'Last 9 months'],
  [12, 'Last 1 year'],
];

export default function Visits({ user, openCustomer }) {
  const [tab, setTab] = useState('top');
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="page-head">
        <h1>Visits</h1>
        <div className="actions">
          <div className="tabs">
            <button className={tab === 'top' ? 'active' : ''} onClick={() => setTab('top')}>Most visits</button>
            <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>All visits by month</button>
          </div>
          <button className="btn primary" onClick={() => setAdding(true)}>+ Record visit</button>
        </div>
      </div>
      {tab === 'top' ? <TopVisitors key={tick} openCustomer={openCustomer} /> : <MonthList key={tick} openCustomer={openCustomer} />}
      {adding && <Modal title="Record a visit" onClose={() => setAdding(false)}><VisitForm user={user} onSaved={() => { setAdding(false); setTick((t) => t + 1); }} onCancel={() => setAdding(false)} /></Modal>}
    </>
  );
}

function TopVisitors({ openCustomer }) {
  const [period, setPeriod] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [minVisits, setMinVisits] = useState(1);

  useEffect(() => {
    setData(null);
    (async () => {
      try {
        const now = monthKey();
        const [start] = monthRange(addMonths(now, -(period - 1)));
        const [, end] = monthRange(now);
        const [visits, bills, cmap] = await Promise.all([
          fetchAll(() => supabase.from('visits').select('customer_id,visit_date').gte('visit_date', start).lt('visit_date', end)),
          fetchAll(() => supabase.from('bills').select('customer_id,amount').gte('bill_date', start).lt('bill_date', end)),
          customerMap(),
        ]);
        setData({ visits, bills, cmap, start, now });
      } catch (e) { setErr(e); }
    })();
  }, [period]);

  const rows = useMemo(() => {
    if (!data) return [];
    const per = {};
    const get = (id) => (per[id] ||= { id, c: data.cmap[id], visits: 0, spend: 0, last: '', months: new Set() });
    data.visits.forEach((v) => { const p = get(v.customer_id); p.visits += 1; p.months.add(v.visit_date.slice(0, 7)); if (v.visit_date > p.last) p.last = v.visit_date; });
    data.bills.forEach((b) => { get(b.customer_id).spend += Number(b.amount || 0); });
    return Object.values(per).filter((p) => p.visits > 0).sort((a, b) => b.visits - a.visits || b.spend - a.spend);
  }, [data]);

  const shown = rows.filter((r) => r.visits >= minVisits);
  const label = PERIODS.find(([n]) => n === period)[1];

  return (
    <>
      <div className="toolbar">
        <div className="actions">
          <div className="tabs">
            {PERIODS.map(([n, l]) => <button key={n} className={period === n ? 'active' : ''} onClick={() => setPeriod(n)}>{l}</button>)}
          </div>
          <label className="inline">Show
            <select value={minVisits} onChange={(e) => setMinVisits(Number(e.target.value))}>
              <option value={1}>everyone who visited</option>
              <option value={2}>2+ visits</option>
              <option value={3}>3+ visits</option>
              <option value={5}>5+ visits</option>
            </select>
          </label>
        </div>
        <button className="btn small" disabled={!shown.length} onClick={() => downloadCSV(`most-visits-${period}m.csv`,
          ['Rank', 'Customer', 'Phone', 'Visits', 'Purchases', 'Last visit'],
          shown.map((r, i) => [i + 1, r.c?.name, r.c?.phone, r.visits, r.spend, r.last]))}>Download CSV</button>
      </div>
      <ErrorBox error={err} />
      {!data ? <Loading /> : (
        <>
          <p className="muted">
            {label} ({monthLabel(addMonths(data.now, -(period - 1)), true)} – {monthLabel(data.now, true)}):
            {' '}<b>{rows.length}</b> customers made <b>{data.visits.length}</b> visits
            {' '}· <b>{rows.filter((r) => r.visits >= 2).length}</b> came 2 or more times
          </p>
          <section className="card flush">
            {shown.length === 0 ? <Empty>No visits in this period.</Empty> : (
              <table>
                <thead><tr><th>#</th><th>Customer</th><th className="num">Visits</th><th className="num">Purchases</th><th className="hide-sm">Last visit</th></tr></thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={r.id} className="click" onClick={() => openCustomer(r.id)}>
                      <td className="muted">{i + 1}</td>
                      <td>
                        <strong>{r.c?.name || 'Unknown'}</strong> <Tags tags={r.c?.tags} />
                        {i < 3 && r.visits >= 2 && <> <Badge tone="green">Top visitor</Badge></>}
                        <div className="muted small">{r.c?.phone || ''}</div>
                      </td>
                      <td className="num"><b>{r.visits}</b></td>
                      <td className="num">{inr(r.spend)}</td>
                      <td className="hide-sm">{fmtDate(r.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  );
}

function MonthList({ openCustomer }) {
  const [month, setMonth] = useState(monthKey());
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setRows(null);
    (async () => {
      try {
        const [ms, me] = monthRange(month);
        const [visits, cmap] = await Promise.all([
          fetchAll(() => supabase.from('visits').select('*').gte('visit_date', ms).lt('visit_date', me).order('visit_date', { ascending: false })),
          customerMap(),
        ]);
        setRows(visits.map((v) => ({ ...v, c: cmap[v.customer_id] })));
      } catch (e) { setErr(e); }
    })();
  }, [month]);

  const unique = rows ? new Set(rows.map((r) => r.customer_id)).size : 0;

  return (
    <>
      <div className="toolbar">
        <MonthPicker value={month} onChange={setMonth} />
      </div>
      <ErrorBox error={err} />
      {!rows ? <Loading /> : (
        <>
          <p className="muted">{rows.length} visits by {unique} customers</p>
          <section className="card flush">
            {rows.length === 0 ? <Empty>No visits in this month.</Empty> : (
              <table>
                <thead><tr><th>Date</th><th>Customer</th><th>Type</th><th className="hide-sm">Notes</th></tr></thead>
                <tbody>
                  {rows.map((v) => (
                    <tr key={v.id} className="click" onClick={() => openCustomer(v.customer_id)}>
                      <td>{fmtDate(v.visit_date)}</td><td><strong>{v.c?.name || 'Unknown'}</strong></td><td>{v.visit_type || '—'}</td><td className="hide-sm">{v.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  );
}
