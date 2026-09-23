import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, BillForm, CustomerForm, DeleteBillModal, Empty, ErrorBox, FollowupForm, Loading, Modal, PrintBill, StatusBadge, Tags, VisitForm, WhatsAppMenu } from '../components';
import { dueOf, fetchAll, fmtDate, inr, itemsSummary, must, pointsFor, pointsTotal, waLink } from '../utils';

export default function CustomerDetail({ id, user, onBack }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [c, visits, bills, fups] = await Promise.all([
          supabase.from('customers').select('*').eq('id', id).single().then(must),
          fetchAll(() => supabase.from('visits').select('*').eq('customer_id', id).order('visit_date', { ascending: false })),
          fetchAll(() => supabase.from('bills').select('*').eq('customer_id', id).order('bill_date', { ascending: false })),
          fetchAll(() => supabase.from('followups').select('*').eq('customer_id', id).order('due_date', { ascending: false })),
        ]);
        setD({ c, visits, bills, fups });
      } catch (e) {
        setErr(e);
      }
    })();
  }, [id, tick]);

  const done = () => { setModal(null); setTick((t) => t + 1); };
  const remove = async (table, rowId, label) => {
    if (!window.confirm(`Delete this ${label}? This cannot be undone.`)) return;
    const { error } = await supabase.from(table).delete().eq('id', rowId);
    if (error) alert(error.message); else done();
  };
  const markDone = async (f) => {
    const { error } = await supabase.from('followups').update({ status: 'done' }).eq('id', f.id);
    if (error) alert(error.message); else done();
  };

  if (err) return <><button className="btn ghost" onClick={onBack}>← Back</button><ErrorBox error={err} /></>;
  if (!d) return <Loading />;

  const { c, visits, bills, fups } = d;
  const total = bills.reduce((s, b) => s + Number(b.amount || 0), 0);
  const due = bills.reduce((s, b) => s + dueOf(b), 0);
  const months = new Set([...visits.map((v) => v.visit_date?.slice(0, 7)), ...bills.map((b) => b.bill_date?.slice(0, 7))].filter(Boolean));
  const wa = waLink(c.phone);

  return (
    <>
      <button className="btn ghost small" onClick={onBack}>← Back</button>
      <div className="page-head">
        <h1>{c.name} <Tags tags={c.tags} /></h1>
        <div className="actions">
          <WhatsAppMenu customer={c} due={due} />
          <button className="btn" onClick={() => setModal('edit')}>Edit</button>
          <button className="btn" onClick={() => setModal('followup')}>+ Follow-up</button>
          <button className="btn" onClick={() => setModal('visit')}>+ Visit</button>
          <button className="btn primary" onClick={() => setModal('bill')}>+ Bill</button>
        </div>
      </div>

      <section className="card info">
        <div><span className="muted small">Phone</span>{c.phone ? <span>{c.phone} · <a href={`tel:${c.phone}`}>Call</a>{wa && <> · <a href={wa} target="_blank" rel="noreferrer">WhatsApp</a></>}</span> : '—'}</div>
        <div><span className="muted small">Email</span>{c.email || '—'}</div>
        <div><span className="muted small">Address</span>{c.address || '—'}</div>
        <div><span className="muted small">Birthday</span>{fmtDate(c.date_of_birth)}</div>
        <div><span className="muted small">Anniversary</span>{fmtDate(c.anniversary)}</div>
        <div><span className="muted small">Customer since</span>{fmtDate(c.created_at)}</div>
        {c.notes && <div className="wide"><span className="muted small">Notes</span>{c.notes}</div>}
      </section>

      <div className="stats">
        <div className="stat"><div className="stat-label">Total purchases</div><div className="stat-value">{inr(total)}</div><div className="stat-sub">{bills.length} bills</div></div>
        <div className="stat"><div className="stat-label">Visits</div><div className="stat-value">{visits.length}</div><div className="stat-sub">Last: {fmtDate(visits[0]?.visit_date)}</div></div>
        <div className="stat loyalty"><div className="stat-label">★ Loyalty points</div><div className="stat-value">{pointsTotal(bills)}</div><div className="stat-sub">5% of every purchase</div></div>
        <div className="stat"><div className="stat-label">Active months</div><div className="stat-value">{months.size}</div></div>
        <div className={`stat ${due > 0 ? 'warn' : ''}`}><div className="stat-label">Pending due</div><div className="stat-value">{inr(due)}</div></div>
      </div>

      <section className="card flush">
        <h2 className="pad">Bills</h2>
        {bills.length === 0 ? <Empty>No bills yet.</Empty> : (
          <table>
            <thead><tr><th>Date</th><th className="hide-sm">Items</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Points</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td>{fmtDate(b.bill_date)}</td>
                  <td className="hide-sm">{itemsSummary(b.items) || '—'}</td>
                  <td className="num">{inr(b.amount)}</td>
                  <td className="num">{inr(b.paid_amount)}</td>
                  <td className="num"><span className="pts">+{pointsFor(b.amount)}</span></td>
                  <td><StatusBadge status={b.payment_status} /></td>
                  <td className="row-actions">
                    <button className="link" onClick={() => setModal({ print: b })}>Print</button>
                    <button className="link" onClick={() => setModal({ bill: b })}>Edit</button>
                    <button className="link danger" onClick={() => setModal({ del: b })}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="cols">
        <section className="card flush">
          <h2 className="pad">Visits</h2>
          {visits.length === 0 ? <Empty>No visits yet.</Empty> : (
            <table>
              <thead><tr><th>Date</th><th>Type</th><th className="hide-sm">Notes</th><th></th></tr></thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id}>
                    <td>{fmtDate(v.visit_date)}</td><td>{v.visit_type || '—'}</td><td className="hide-sm">{v.notes || '—'}</td>
                    <td className="row-actions"><button className="link danger" onClick={() => remove('visits', v.id, 'visit')}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card flush">
          <h2 className="pad">Follow-ups</h2>
          {fups.length === 0 ? <Empty>No follow-ups.</Empty> : (
            <ul className="list pad-list">
              {fups.map((f) => (
                <li key={f.id}>
                  <div><strong>{fmtDate(f.due_date)}</strong><div className="muted small">{f.notes || '—'}</div></div>
                  <div className="right">
                    {f.status === 'done' ? <Badge tone="green">Done</Badge> : <button className="btn small" onClick={() => markDone(f)}>Mark done</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {modal === 'edit' && <Modal title="Edit customer" onClose={() => setModal(null)}><CustomerForm customer={c} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
      {modal === 'visit' && <Modal title={`Visit · ${c.name}`} onClose={() => setModal(null)}><VisitForm customerId={id} user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
      {modal === 'bill' && <Modal title={`New bill · ${c.name}`} onClose={() => setModal(null)}><BillForm customerId={id} user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
      {modal === 'followup' && <Modal title={`Follow-up · ${c.name}`} onClose={() => setModal(null)}><FollowupForm customerId={id} user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
      {modal?.del && <DeleteBillModal key={modal.del.id} bill={modal.del} customerName={c.name} onDeleted={done} onClose={() => setModal(null)} />}
      {modal?.print && <PrintBill bill={modal.print} onClose={() => setModal(null)} />}
      {modal?.bill && <Modal title="Edit bill" onClose={() => setModal(null)}><BillForm bill={modal.bill} user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
    </>
  );
}
