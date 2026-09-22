import { useEffect, useState } from 'react';
import { CustomerForm, Empty, ErrorBox, Loading, Modal } from '../components';
import { fmtDate, invalidateCustomers, loadCustomers } from '../utils';

export default function Customers({ openCustomer }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { invalidateCustomers(); loadCustomers().then(setList).catch(setErr); }, []);

  if (err) return <ErrorBox error={err} />;
  if (!list) return <Loading />;

  const ql = q.trim().toLowerCase();
  const shown = ql
    ? list.filter((c) => [c.name, c.phone, c.email, c.address].some((v) => (v || '').toLowerCase().includes(ql)))
    : list;

  return (
    <>
      <div className="page-head">
        <h1>Customers <span className="muted light">· {list.length}</span></h1>
        <div className="actions"><button className="btn primary" onClick={() => setAdding(true)}>+ New customer</button></div>
      </div>
      <input className="search" placeholder="Search by name, phone, email or address…" value={q} onChange={(e) => setQ(e.target.value)} />
      <section className="card flush">
        {shown.length === 0 ? <Empty>{list.length ? 'No matching customers.' : 'No customers yet. Add your first one.'}</Empty> : (
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th className="hide-sm">Address</th><th className="hide-sm">Customer since</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="click" onClick={() => openCustomer(c.id)}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.phone || '—'}</td>
                  <td className="hide-sm">{c.address || '—'}</td>
                  <td className="hide-sm">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {adding && (
        <Modal title="New customer" onClose={() => setAdding(false)}>
          <CustomerForm onSaved={(c) => { setAdding(false); openCustomer(c.id); }} onCancel={() => setAdding(false)} />
        </Modal>
      )}
    </>
  );
}
