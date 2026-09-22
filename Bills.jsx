import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { BillForm, Empty, ErrorBox, Loading, Modal, MonthPicker, StatusBadge } from '../components';
import { customerMap, dueOf, fetchAll, fmtDate, inr, monthKey, monthRange } from '../utils';

export default function Bills({ user, openCustomer }) {
  const [month, setMonth] = useState(monthKey());
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setRows(null);
    (async () => {
      try {
        const [ms, me] = monthRange(month);
        const [bills, cmap] = await Promise.all([
          fetchAll(() => supabase.from('bills').select('*').gte('bill_date', ms).lt('bill_date', me).order('bill_date', { ascending: false })),
          customerMap(),
        ]);
        setRows(bills.map((b) => ({ ...b, c: cmap[b.customer_id] })));
      } catch (e) { setErr(e); }
    })();
  }, [month, tick]);

  const done = () => { setModal(null); setTick((t) => t + 1); };
  const shown = rows ? rows.filter((b) => filter === 'all' || (filter === 'due' ? dueOf(b) > 0 : b.payment_status === 'paid')) : [];
  const sum = (k) => shown.reduce((s, b) => s + Number(b[k] || 0), 0);

  return (
    <>
      <div className="page-head">
        <h1>Bills</h1>
        <div className="actions">
          <MonthPicker value={month} onChange={setMonth} />
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All bills</option>
            <option value="due">With dues</option>
            <option value="paid">Fully paid</option>
          </select>
          <button className="btn primary" onClick={() => setModal('new')}>+ New bill</button>
        </div>
      </div>
      <ErrorBox error={err} />
      {!rows ? <Loading /> : (
        <>
          <p className="muted">{shown.length} bills · Total {inr(sum('amount'))} · Collected {inr(sum('paid_amount'))} · Due {inr(shown.reduce((s, b) => s + dueOf(b), 0))}</p>
          <section className="card flush">
            {shown.length === 0 ? <Empty>No bills to show.</Empty> : (
              <table>
                <thead><tr><th>Date</th><th>Customer</th><th className="hide-sm">Items</th><th className="num">Amount</th><th className="num hide-sm">Paid</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {shown.map((b) => (
                    <tr key={b.id}>
                      <td>{fmtDate(b.bill_date)}</td>
                      <td><button className="link strong" onClick={() => openCustomer(b.customer_id)}>{b.c?.name || 'Unknown'}</button></td>
                      <td className="hide-sm">{b.items || '—'}</td>
                      <td className="num">{inr(b.amount)}</td>
                      <td className="num hide-sm">{inr(b.paid_amount)}</td>
                      <td><StatusBadge status={b.payment_status} /></td>
                      <td className="row-actions"><button className="link" onClick={() => setModal({ bill: b })}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
      {modal === 'new' && <Modal title="New bill" onClose={() => setModal(null)}><BillForm user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
      {modal?.bill && <Modal title={`Edit bill · ${modal.bill.c?.name || ''}`} onClose={() => setModal(null)}><BillForm bill={modal.bill} user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
    </>
  );
}
