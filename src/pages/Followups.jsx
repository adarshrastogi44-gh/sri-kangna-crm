import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, Empty, ErrorBox, FollowupActions, FollowupForm, Loading, Modal } from '../components';
import { customerMap, fetchAll, fmtDate, today } from '../utils';

export default function Followups({ user, openCustomer }) {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setRows(null);
    (async () => {
      try {
        const q = () => {
          const base = supabase.from('followups').select('*');
          return tab === 'pending'
            ? base.or('status.is.null,status.neq.done').order('due_date', { ascending: true })
            : base.eq('status', 'done').order('due_date', { ascending: false });
        };
        const [list, cmap] = await Promise.all([fetchAll(q), customerMap()]);
        setRows(list.map((f) => ({ ...f, c: cmap[f.customer_id] })));
      } catch (e) { setErr(e); }
    })();
  }, [tab, tick]);

  const t = today();

  return (
    <>
      <div className="page-head">
        <h1>Follow-ups</h1>
        <div className="actions">
          <div className="tabs">
            <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>Pending</button>
            <button className={tab === 'done' ? 'active' : ''} onClick={() => setTab('done')}>Done</button>
          </div>
          <button className="btn primary" onClick={() => setAdding(true)}>+ Follow-up</button>
        </div>
      </div>
      <ErrorBox error={err} />
      {!rows ? <Loading /> : (
        <section className="card flush">
          {rows.length === 0 ? <Empty>Nothing here.</Empty> : (
            <ul className="list pad-list">
              {rows.map((f) => {
                return (
                  <li key={f.id}>
                    <div>
                      <button className="link strong" onClick={() => openCustomer(f.customer_id)}>{f.c?.name || 'Unknown'}</button>
                      <div className="fu-note">{f.notes || '—'}</div>
                      <div className="muted small">{f.c?.phone || ''}</div>
                    </div>
                    <div className="right">
                      {tab === 'pending' && (f.due_date < t ? <Badge tone="red">Overdue · {fmtDate(f.due_date)}</Badge> : f.due_date === t ? <Badge tone="amber">Today</Badge> : <Badge>{fmtDate(f.due_date)}</Badge>)}
                      {tab === 'done' && <Badge tone="green">{fmtDate(f.due_date)}</Badge>}
                      <FollowupActions f={f} customer={f.c} onEdit={() => setEditing(f)} onChanged={() => setTick((x) => x + 1)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {adding && <Modal title="New follow-up" onClose={() => setAdding(false)}><FollowupForm user={user} onSaved={() => { setAdding(false); setTick((x) => x + 1); }} onCancel={() => setAdding(false)} /></Modal>}
      {editing && <Modal title="Edit follow-up" onClose={() => setEditing(null)}><FollowupForm followup={editing} user={user} onSaved={() => { setEditing(null); setTick((x) => x + 1); }} onCancel={() => setEditing(null)} /></Modal>}
    </>
  );
}
