import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { CustomerForm, DateInput, Empty, ErrorBox, Loading, Modal, Tags } from '../components';
import { addDays, today, fetchAll, fmtDate, inr, invalidateCustomers, loadCustomers, billPoints, pointsFor } from '../utils';
import ImportCustomers from './ImportCustomers';
import ImportOldCrm from './ImportOldCrm';

export default function Customers({ user, openCustomer }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [modal, setModal] = useState(null);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState('');
  const [tick, setTick] = useState(0);
  const [stats, setStats] = useState({});
  const [sort, setSort] = useState('name');
  // Day filter: who came on a day (today / yesterday / any date), bought or only visited
  const [dayMode, setDayMode] = useState(''); // '' | 'today' | 'yesterday' | 'date'
  const [pickDay, setPickDay] = useState(addDays(-2));
  const [kind, setKind] = useState('all'); // all | bought | nobuy
  const [act, setAct] = useState(null); // { bills, visits }

  useEffect(() => {
    if (tick) invalidateCustomers();
    loadCustomers().then(setList).catch(setErr);
    Promise.all([
      fetchAll(() => supabase.from('bills').select('*')),
      fetchAll(() => supabase.from('visits').select('customer_id,visit_date')),
    ]).then(([bills, visits]) => {
      setAct({ bills, visits });
      const s = {};
      const get = (id) => (s[id] ||= { spend: 0, visits: 0, last: '', points: 0 });
      bills.forEach((b) => { const x = get(b.customer_id); x.spend += Number(b.amount || 0); x.points += billPoints(b) - Number(b.points_redeemed || 0); });
      visits.forEach((v) => { const x = get(v.customer_id); x.visits += 1; if (v.visit_date > x.last) x.last = v.visit_date; });
      setStats(s);
    }).catch(() => {});
  }, [tick]);

  if (err) return <ErrorBox error={err} />;
  if (!list) return <Loading />;

  const allTags = [...new Set(list.flatMap((c) => c.tags || []))].sort();
  const day = dayMode === 'today' ? today() : dayMode === 'yesterday' ? addDays(-1) : dayMode === 'date' ? pickDay : '';
  // who came on that day: bought (bill that day) or visited without buying (visit but no bill)
  const dayInfo = {};
  if (day && act) {
    act.visits.filter((v) => v.visit_date === day).forEach((v) => { (dayInfo[v.customer_id] ||= { amt: 0, bills: 0, visited: true }).visited = true; });
    act.bills.filter((b) => b.bill_date === day).forEach((b) => { const x = (dayInfo[b.customer_id] ||= { amt: 0, bills: 0, visited: false }); x.amt += Number(b.amount || 0); x.bills += 1; });
  }
  const dayCount = (k) => Object.values(dayInfo).filter((x) => k === 'all' || (k === 'bought' ? x.bills > 0 : x.bills === 0)).length;
  const ql = q.trim().toLowerCase();
  const shown = list
    .filter((c) => !day || (dayInfo[c.id] && (kind === 'all' || (kind === 'bought' ? dayInfo[c.id].bills > 0 : dayInfo[c.id].bills === 0))))
    .filter((c) => !tag || (c.tags || []).includes(tag))
    .filter((c) => !ql || [c.name, c.phone, c.email, c.address].some((v) => (v || '').toLowerCase().includes(ql)))
    .sort((a, b) => {
      const A = stats[a.id] || {}; const B = stats[b.id] || {};
      if (sort === 'spend') return (B.spend || 0) - (A.spend || 0);
      if (sort === 'visits') return (B.visits || 0) - (A.visits || 0) || (B.spend || 0) - (A.spend || 0);
      if (sort === 'points') return (B.points || 0) - (A.points || 0);
      if (sort === 'recent') return (B.last || '').localeCompare(A.last || '');
      return (a.name || '').localeCompare(b.name || '');
    });

  return (
    <>
      <div className="page-head">
        <h1>Customers <span className="muted light">· {list.length}</span></h1>
        <div className="actions">
          <button className="btn" onClick={() => setModal('old')}>Import from old CRM</button>
          <button className="btn" onClick={() => setModal('import')}>Import from Excel</button>
          <button className="btn primary" onClick={() => setModal('add')}>+ New customer</button>
        </div>
      </div>
      {notice && <div className="notice">{notice}</div>}
      <div className="search-row">
        <input className="search" placeholder="Search by name, phone, email or address…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="inline">Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name">Name (A–Z)</option>
            <option value="spend">Highest purchases</option>
            <option value="visits">Most visits</option>
            <option value="recent">Last visited</option>
            <option value="points">Most loyalty points</option>
          </select>
        </label>
      </div>
      <div className="day-filter">
        <span className="small"><b>Came on</b></span>
        <div className="tabs">
          {[['', 'All customers'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['date', 'Pick a date']].map(([k, l]) => (
            <button key={k} className={dayMode === k ? 'active' : ''} onClick={() => setDayMode(k)}>{l}</button>
          ))}
        </div>
        {dayMode === 'date' && <DateInput value={pickDay} onChange={(v) => v && setPickDay(v)} />}
        {day && (
          <div className="tabs">
            <button className={kind === 'all' ? 'active' : ''} onClick={() => setKind('all')}>Everyone ({dayCount('all')})</button>
            <button className={kind === 'bought' ? 'active' : ''} onClick={() => setKind('bought')}>🛍 Purchased ({dayCount('bought')})</button>
            <button className={kind === 'nobuy' ? 'active' : ''} onClick={() => setKind('nobuy')}>👀 Visited, no purchase ({dayCount('nobuy')})</button>
          </div>
        )}
      </div>
      {day && !act && <div className="muted small">Loading visits and bills…</div>}
      {allTags.length > 0 && (
        <div className="tabs tag-filter">
          <button className={!tag ? 'active' : ''} onClick={() => setTag('')}>All</button>
          {allTags.map((t) => <button key={t} className={tag === t ? 'active' : ''} onClick={() => setTag(t)}>{t} ({list.filter((c) => (c.tags || []).includes(t)).length})</button>)}
        </div>
      )}
      <section className="card flush">
        {shown.length === 0 ? <Empty>{day ? `No customers ${kind === 'nobuy' ? 'visited without buying' : kind === 'bought' ? 'purchased' : 'came'} on ${fmtDate(day)}.` : list.length ? 'No matching customers.' : 'No customers yet. Add your first one, or import them from Excel.'}</Empty> : (
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th className="num">Purchases</th><th className="num">Visits</th><th className="num">Points</th><th className="hide-sm">Last visit</th>{day ? <th>{fmtDate(day)}</th> : <th className="hide-sm">Address</th>}</tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="click" onClick={() => openCustomer(c.id)}>
                  <td><strong>{c.name}</strong> <Tags tags={c.tags} />{c.notes && <div className="list-note" title={c.notes}>📝 {c.notes}</div>}</td>
                  <td>{c.phone || '—'}</td>
                  <td className="num">{inr(stats[c.id]?.spend || 0)}</td>
                  <td className="num">{stats[c.id]?.visits || 0}</td>
                  <td className="num"><span className="pts">{stats[c.id]?.points || 0}</span></td>
                  <td className="hide-sm">{fmtDate(stats[c.id]?.last)}</td>
                  {day
                    ? <td>{dayInfo[c.id]?.bills ? <span className="badge green">🛍 Bought {inr(dayInfo[c.id].amt)}</span> : <span className="badge amber">👀 Visited, no purchase</span>}</td>
                    : <td className="hide-sm">{c.address || '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {modal === 'add' && (
        <Modal title="New customer" onClose={() => setModal(null)}>
          <CustomerForm onSaved={(c) => { setModal(null); openCustomer(c.id); }} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {modal === 'old' && (
        <Modal title="Import from old CRM" onClose={() => setModal(null)}>
          <ImportOldCrm user={user} onCancel={() => setModal(null)} onDone={(r) => {
            setModal(null);
            setNotice(`✓ Imported ${r.customers} customers, ${r.bills} bills, ${r.visits} visits${r.items ? ` and ${r.items} items` : ''}.`);
            setTick((t) => t + 1);
          }} />
        </Modal>
      )}
      {modal === 'import' && (
        <Modal title="Import customers" onClose={() => setModal(null)}>
          <ImportCustomers onDone={(n) => { setModal(null); setNotice(`✓ Imported ${n} customers.`); setTick((t) => t + 1); }} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </>
  );
}
