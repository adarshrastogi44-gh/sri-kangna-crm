import { useEffect, useState } from 'react';
import { CustomerForm, Empty, ErrorBox, Loading, Modal, Tags } from '../components';
import { fmtDate, invalidateCustomers, loadCustomers } from '../utils';
import ImportCustomers from './ImportCustomers';

export default function Customers({ openCustomer }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [modal, setModal] = useState(null);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => { invalidateCustomers(); loadCustomers().then(setList).catch(setErr); }, [tick]);

  if (err) return <ErrorBox error={err} />;
  if (!list) return <Loading />;

  const allTags = [...new Set(list.flatMap((c) => c.tags || []))].sort();
  const ql = q.trim().toLowerCase();
  const shown = list
    .filter((c) => !tag || (c.tags || []).includes(tag))
    .filter((c) => !ql || [c.name, c.phone, c.email, c.address].some((v) => (v || '').toLowerCase().includes(ql)));

  return (
    <>
      <div className="page-head">
        <h1>Customers <span className="muted light">· {list.length}</span></h1>
        <div className="actions">
          <button className="btn" onClick={() => setModal('import')}>Import from Excel</button>
          <button className="btn primary" onClick={() => setModal('add')}>+ New customer</button>
        </div>
      </div>
      {notice && <div className="notice">{notice}</div>}
      <input className="search" placeholder="Search by name, phone, email or address…" value={q} onChange={(e) => setQ(e.target.value)} />
      {allTags.length > 0 && (
        <div className="tabs tag-filter">
          <button className={!tag ? 'active' : ''} onClick={() => setTag('')}>All</button>
          {allTags.map((t) => <button key={t} className={tag === t ? 'active' : ''} onClick={() => setTag(t)}>{t} ({list.filter((c) => (c.tags || []).includes(t)).length})</button>)}
        </div>
      )}
      <section className="card flush">
        {shown.length === 0 ? <Empty>{list.length ? 'No matching customers.' : 'No customers yet. Add your first one, or import them from Excel.'}</Empty> : (
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th className="hide-sm">Address</th><th className="hide-sm">Customer since</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="click" onClick={() => openCustomer(c.id)}>
                  <td><strong>{c.name}</strong> <Tags tags={c.tags} /></td>
                  <td>{c.phone || '—'}</td>
                  <td className="hide-sm">{c.address || '—'}</td>
                  <td className="hide-sm">{fmtDate(c.created_at)}</td>
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
      {modal === 'import' && (
        <Modal title="Import customers" onClose={() => setModal(null)}>
          <ImportCustomers onDone={(n) => { setModal(null); setNotice(`✓ Imported ${n} customers.`); setTick((t) => t + 1); }} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </>
  );
}
