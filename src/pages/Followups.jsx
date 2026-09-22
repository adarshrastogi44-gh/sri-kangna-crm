import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, Empty, ErrorBox, FollowupForm, Loading, Modal } from '../components';
import { customerMap, fetchAll, fmtDate, today, waLink } from '../utils';

export default function Followups({ user, openCustomer }) {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [adding, setAdding] = useState(false);
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

  const setStatus = async (f, status) => {
    const { error } = await supabase.from('followups').update({ status }).eq('id', f.id);
    if (error) alert(error.message); else setTick((t) => t + 1);
  };

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
                const wa = waLink(f.c?.phone);
                return (
                  <li key={f.id}>
                    <div>
                      <button className="link strong" onClick={() => openCustomer(f.customer_id)}>{f.c?.name || 'Unknown'}</button>
                      <div className="muted small">{f.notes || '—'}{f.c?.phone ? ` · ${f.c.phone}` : ''}</div>
                    </div>
                    <div className="right">
                      {tab === 'pending' && (f.due_date < t ? <Badge tone="red">Overdue · {fmtDate(f.due_date)}</Badge> : f.due_date === t ? <Badge tone="amber">Today</Badge> : <Badge>{fmtDate(f.due_date)}</Badge>)}
                      {tab === 'done' && <Badge tone="green">{fmtDate(f.due_date)}</Badge>}
                      {wa && tab === 'pending' && <a className="btn small" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
                      {tab === 'pending'
                        ? <button className="btn small" onClick={() => setStatus(f, 'done')}>Mark done</button>
                        : <button className="link" onClick={() => setStatus(f, 'pending')}>Reopen</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {adding && <Modal title="New follow-up" onClose={() => setAdding(false)}><FollowupForm user={user} onSaved={() => { setAdding(false); setTick((x) => x + 1); }} onCancel={() => setAdding(false)} /></Modal>}
    </>
  );
}
