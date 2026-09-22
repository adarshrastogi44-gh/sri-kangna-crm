import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, Empty, ErrorBox, Loading, MonthPicker } from '../components';
import { addMonths, customerMap, downloadCSV, dueOf, fetchAll, fmtDate, inr, monthKey, monthLabel, monthRange } from '../utils';

// Loads visits + bills for the 12 months ending at `endKey` and aggregates them.
function useReportData(endKey) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    setData(null);
    (async () => {
      try {
        const startKey = addMonths(endKey, -11);
        const [start] = monthRange(startKey);
        const [, end] = monthRange(endKey);
        const [visits, bills, cmap] = await Promise.all([
          fetchAll(() => supabase.from('visits').select('customer_id,visit_date').gte('visit_date', start).lt('visit_date', end).order('visit_date')),
          fetchAll(() => supabase.from('bills').select('customer_id,bill_date,amount,paid_amount').gte('bill_date', start).lt('bill_date', end).order('bill_date')),
          customerMap(),
        ]);
        setData({ visits, bills, cmap });
      } catch (e) { setErr(e); }
    })();
  }, [endKey]);
  return { data, err };
}

function aggregate(data, fromKey, toKey) {
  const per = {};
  const get = (id) => (per[id] ||= { id, c: data.cmap[id], visits: 0, bills: 0, purchase: 0, due: 0, months: new Set(), last: '' });
  data.visits.forEach((v) => {
    const k = v.visit_date.slice(0, 7);
    if (k < fromKey || k > toKey) return;
    const p = get(v.customer_id);
    p.visits += 1; p.months.add(k); if (v.visit_date > p.last) p.last = v.visit_date;
  });
  data.bills.forEach((b) => {
    const k = b.bill_date.slice(0, 7);
    if (k < fromKey || k > toKey) return;
    const p = get(b.customer_id);
    p.bills += 1; p.purchase += Number(b.amount || 0); p.due += dueOf(b); p.months.add(k); if (b.bill_date > p.last) p.last = b.bill_date;
  });
  return Object.values(per);
}

export default function Reports({ openCustomer }) {
  const [tab, setTab] = useState('monthly');
  const [month, setMonth] = useState(monthKey());
  const [period, setPeriod] = useState(6);
  const [tier, setTier] = useState('all');
  const { data, err } = useReportData(month);

  const monthly = useMemo(() => {
    if (!data) return [];
    return aggregate(data, month, month).sort((a, b) => b.purchase - a.purchase || b.visits - a.visits);
  }, [data, month]);

  const good = useMemo(() => {
    if (!data) return [];
    const from = addMonths(month, -(period - 1));
    const loyalMin = Math.max(2, Math.ceil(period / 2));
    return aggregate(data, from, month)
      .map((p) => ({ ...p, active: p.months.size, tier: p.months.size >= loyalMin ? 'Loyal' : p.months.size >= 2 ? 'Repeat' : 'One-time' }))
      .sort((a, b) => b.purchase - a.purchase || b.active - a.active);
  }, [data, month, period]);

  const trend = useMemo(() => {
    if (!data) return [];
    const rows = [];
    for (let i = 11; i >= 0; i--) {
      const k = addMonths(month, -i);
      const agg = aggregate(data, k, k);
      rows.push({
        k,
        visits: agg.reduce((s, p) => s + p.visits, 0),
        customers: agg.filter((p) => p.visits > 0).length,
        repeat: agg.filter((p) => p.visits >= 2).length,
        bills: agg.reduce((s, p) => s + p.bills, 0),
        sales: agg.reduce((s, p) => s + p.purchase, 0),
      });
    }
    return rows;
  }, [data, month]);

  const isNew = (c) => c?.created_at?.slice(0, 7) === month;

  return (
    <>
      <div className="page-head">
        <h1>Reports</h1>
        <div className="actions">
          <div className="tabs">
            <button className={tab === 'monthly' ? 'active' : ''} onClick={() => setTab('monthly')}>Monthly</button>
            <button className={tab === 'good' ? 'active' : ''} onClick={() => setTab('good')}>Good customers</button>
            <button className={tab === 'trend' ? 'active' : ''} onClick={() => setTab('trend')}>Month by month</button>
          </div>
          <MonthPicker value={month} onChange={setMonth} />
        </div>
      </div>
      <ErrorBox error={err} />
      {!data ? <Loading /> : (
        <>
          {tab === 'monthly' && (
            <>
              <div className="toolbar">
                <p className="muted">
                  {monthLabel(month)} · {monthly.filter((p) => p.visits > 0).length} customers visited · {monthly.reduce((s, p) => s + p.visits, 0)} visits · {inr(monthly.reduce((s, p) => s + p.purchase, 0))} sales
                </p>
                <button className="btn small" onClick={() => downloadCSV(`monthly-report-${month}.csv`,
                  ['Customer', 'Phone', 'Visits', 'Bills', 'Purchase', 'Due'],
                  monthly.map((p) => [p.c?.name, p.c?.phone, p.visits, p.bills, p.purchase, p.due]))}>Download CSV</button>
              </div>
              <section className="card flush">
                {monthly.length === 0 ? <Empty>No activity in {monthLabel(month)}.</Empty> : (
                  <table>
                    <thead><tr><th>Customer</th><th className="num">Visits</th><th className="num">Bills</th><th className="num">Purchase</th><th className="num hide-sm">Due</th></tr></thead>
                    <tbody>
                      {monthly.map((p) => (
                        <tr key={p.id} className="click" onClick={() => openCustomer(p.id)}>
                          <td>
                            <strong>{p.c?.name || 'Unknown'}</strong>{' '}
                            {p.visits >= 2 && <Badge tone="green">Repeat visitor</Badge>}{' '}
                            {isNew(p.c) && <Badge tone="blue">New</Badge>}
                          </td>
                          <td className="num">{p.visits}</td>
                          <td className="num">{p.bills}</td>
                          <td className="num">{inr(p.purchase)}</td>
                          <td className="num hide-sm">{p.due ? inr(p.due) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}

          {tab === 'good' && (
            <>
              <div className="toolbar">
                <div className="actions">
                  <label className="inline">Period
                    <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
                      <option value={3}>Last 3 months</option>
                      <option value={6}>Last 6 months</option>
                      <option value={12}>Last 12 months</option>
                    </select>
                  </label>
                  <div className="tabs">
                    {['all', 'Loyal', 'Repeat', 'One-time'].map((t) => (
                      <button key={t} className={tier === t ? 'active' : ''} onClick={() => setTier(t)}>
                        {t === 'all' ? 'All' : t} ({t === 'all' ? good.length : good.filter((p) => p.tier === t).length})
                      </button>
                    ))}
                  </div>
                </div>
                <button className="btn small" onClick={() => downloadCSV(`good-customers-${period}m-to-${month}.csv`,
                  ['Rank', 'Customer', 'Phone', 'Tier', 'Active months', 'Visits', 'Bills', 'Purchase', 'Last activity'],
                  good.map((p, i) => [i + 1, p.c?.name, p.c?.phone, p.tier, p.active, p.visits, p.bills, p.purchase, p.last]))}>Download CSV</button>
              </div>
              <p className="muted small">
                Ranked by total purchases over the {period} months up to {monthLabel(month)}.
                <b> Loyal</b> = active in at least {Math.max(2, Math.ceil(period / 2))} of those months ·
                <b> Repeat</b> = active in 2 or more months · <b>One-time</b> = active in only 1 month.
              </p>
              <section className="card flush">
                {good.length === 0 ? <Empty>No activity in this period.</Empty> : (
                  <table>
                    <thead><tr><th>#</th><th>Customer</th><th>Tier</th><th className="num">Active months</th><th className="num hide-sm">Visits</th><th className="num">Purchase</th><th className="hide-sm">Last activity</th></tr></thead>
                    <tbody>
                      {good.map((p, i) => ({ p, i })).filter(({ p }) => tier === 'all' || p.tier === tier).map(({ p, i }) => (
                        <tr key={p.id} className="click" onClick={() => openCustomer(p.id)}>
                          <td className="muted">{i + 1}</td>
                          <td><strong>{p.c?.name || 'Unknown'}</strong><div className="muted small">{p.c?.phone || ''}</div></td>
                          <td><Badge tone={p.tier === 'Loyal' ? 'green' : p.tier === 'Repeat' ? 'blue' : 'gray'}>{p.tier}</Badge></td>
                          <td className="num">{p.active} / {period}</td>
                          <td className="num hide-sm">{p.visits}</td>
                          <td className="num">{inr(p.purchase)}</td>
                          <td className="hide-sm">{fmtDate(p.last)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}

          {tab === 'trend' && (
            <>
              <div className="toolbar">
                <p className="muted">12 months up to {monthLabel(month)}</p>
                <button className="btn small" onClick={() => downloadCSV(`month-by-month-to-${month}.csv`,
                  ['Month', 'Visits', 'Customers visited', 'Repeat visitors', 'Bills', 'Sales'],
                  trend.map((r) => [monthLabel(r.k), r.visits, r.customers, r.repeat, r.bills, r.sales]))}>Download CSV</button>
              </div>
              <section className="card flush">
                <table>
                  <thead><tr><th>Month</th><th className="num">Visits</th><th className="num hide-sm">Customers visited</th><th className="num hide-sm">Repeat visitors</th><th className="num">Bills</th><th className="num">Sales</th><th className="hide-sm"></th></tr></thead>
                  <tbody>
                    {trend.map((r) => {
                      const max = Math.max(1, ...trend.map((x) => x.sales));
                      return (
                        <tr key={r.k}>
                          <td>{monthLabel(r.k, true)}</td>
                          <td className="num">{r.visits}</td>
                          <td className="num hide-sm">{r.customers}</td>
                          <td className="num hide-sm">{r.repeat}</td>
                          <td className="num">{r.bills}</td>
                          <td className="num">{inr(r.sales)}</td>
                          <td className="hide-sm bar-cell"><div className="bar" style={{ width: `${(r.sales / max) * 100}%` }} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
