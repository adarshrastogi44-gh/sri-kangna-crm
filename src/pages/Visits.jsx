import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Empty, ErrorBox, Loading, Modal, MonthPicker, VisitForm } from '../components';
import { customerMap, fetchAll, fmtDate, monthKey, monthRange } from '../utils';

export default function Visits({ user, openCustomer }) {
  const [month, setMonth] = useState(monthKey());
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);

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
  }, [month, tick]);

  const unique = rows ? new Set(rows.map((r) => r.customer_id)).size : 0;

  return (
    <>
      <div className="page-head">
        <h1>Visits</h1>
        <div className="actions">
          <MonthPicker value={month} onChange={setMonth} />
          <button className="btn primary" onClick={() => setAdding(true)}>+ Record visit</button>
        </div>
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
      {adding && <Modal title="Record a visit" onClose={() => setAdding(false)}><VisitForm user={user} onSaved={() => { setAdding(false); setTick((t) => t + 1); }} onCancel={() => setAdding(false)} /></Modal>}
    </>
  );
}
