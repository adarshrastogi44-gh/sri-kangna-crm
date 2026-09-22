import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { addDays, invalidateCustomers, loadCustomers, must, statusFor, today, inr } from './utils';

export function Modal({ title, onClose, children }) {
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const ErrorBox = ({ error }) =>
  error ? <div className="error">{error.message || String(error)}</div> : null;

export const Empty = ({ children }) => <div className="empty">{children}</div>;
export const Loading = () => <div className="empty">Loading…</div>;
export const Badge = ({ tone = 'gray', children }) => <span className={`badge ${tone}`}>{children}</span>;

export const StatusBadge = ({ status }) => {
  const tone = status === 'paid' ? 'green' : status === 'partial' ? 'amber' : 'red';
  const s = status || 'unpaid';
  return <Badge tone={tone}>{s.charAt(0).toUpperCase() + s.slice(1)}</Badge>;
};

function useSave() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function FormButtons({ busy, onCancel, label = 'Save' }) {
  return (
    <div className="form-actions">
      <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : label}</button>
    </div>
  );
}

export function CustomerPicker({ value, onChange }) {
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  useEffect(() => { loadCustomers().then(setList).catch(() => {}); }, []);
  const ql = q.trim().toLowerCase();
  const shown = ql
    ? list.filter((c) => (c.name || '').toLowerCase().includes(ql) || (c.phone || '').includes(ql))
    : list;
  return (
    <div className="picker">
      <input placeholder="Search customer by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} size={Math.min(6, Math.max(3, shown.length + 1))}>
        <option value="" disabled>— Select customer —</option>
        {shown.map((c) => (
          <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>
        ))}
      </select>
    </div>
  );
}

const clean = (obj) =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v]));

export function CustomerForm({ customer, onSaved, onCancel }) {
  const [f, setF] = useState({
    name: customer?.name || '',
    phone: customer?.phone || '',
    email: customer?.email || '',
    address: customer?.address || '',
    date_of_birth: customer?.date_of_birth || '',
    anniversary: customer?.anniversary || '',
    notes: customer?.notes || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useSave();

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const row = clean(f);
      if (row.phone) {
        const dup = must(await supabase.from('customers').select('id,name').eq('phone', row.phone).limit(1));
        if (dup.length && dup[0].id !== customer?.id) {
          throw new Error(`This phone number already belongs to ${dup[0].name}.`);
        }
      }
      let saved;
      if (customer) {
        row.updated_at = new Date().toISOString();
        saved = must(await supabase.from('customers').update(row).eq('id', customer.id).select().single());
      } else {
        saved = must(await supabase.from('customers').insert(row).select().single());
      }
      invalidateCustomers();
      onSaved(saved);
    });
  };

  return (
    <form onSubmit={submit} className="form">
      <div className="grid2">
        <label>Name *<input required value={f.name} onChange={set('name')} autoFocus /></label>
        <label>Phone<input type="tel" value={f.phone} onChange={set('phone')} /></label>
        <label>Email<input type="email" value={f.email} onChange={set('email')} /></label>
        <label>Address<input value={f.address} onChange={set('address')} /></label>
        <label>Date of birth<input type="date" value={f.date_of_birth} onChange={set('date_of_birth')} /></label>
        <label>Anniversary<input type="date" value={f.anniversary} onChange={set('anniversary')} /></label>
      </div>
      <label>Notes<textarea rows="2" value={f.notes} onChange={set('notes')} /></label>
      <ErrorBox error={error} />
      <FormButtons busy={busy} onCancel={onCancel} />
    </form>
  );
}

const VISIT_TYPES = ['Walk-in', 'Purchase', 'Enquiry', 'Trial', 'Alteration', 'Delivery', 'Service'];

export function VisitForm({ customerId, user, onSaved, onCancel }) {
  const [cid, setCid] = useState(customerId || '');
  const [f, setF] = useState({ visit_date: today(), visit_type: 'Walk-in', notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useSave();

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (!cid) throw new Error('Please select a customer.');
      must(await supabase.from('visits').insert(clean({ customer_id: cid, ...f, created_by: user.id })));
      onSaved();
    });
  };

  return (
    <form onSubmit={submit} className="form">
      {!customerId && <label>Customer *<CustomerPicker value={cid} onChange={setCid} /></label>}
      <div className="grid2">
        <label>Visit date *<input type="date" required value={f.visit_date} onChange={set('visit_date')} /></label>
        <label>Visit type
          <input list="visit-types" value={f.visit_type} onChange={set('visit_type')} />
          <datalist id="visit-types">{VISIT_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
      </div>
      <label>Notes<textarea rows="2" value={f.notes} onChange={set('notes')} /></label>
      <ErrorBox error={error} />
      <FormButtons busy={busy} onCancel={onCancel} label="Save visit" />
    </form>
  );
}

export function BillForm({ bill, customerId, user, onSaved, onCancel }) {
  const [cid, setCid] = useState(bill?.customer_id || customerId || '');
  const [f, setF] = useState({
    bill_date: bill?.bill_date || today(),
    items: bill?.items || '',
    amount: bill?.amount ?? '',
    paid_amount: bill?.paid_amount ?? '',
    notes: bill?.notes || '',
  });
  const [fullPaid, setFullPaid] = useState(bill ? Number(bill.paid_amount || 0) >= Number(bill.amount || 0) : true);
  const [logVisit, setLogVisit] = useState(!bill);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useSave();

  const amount = Number(f.amount || 0);
  const paid = fullPaid ? amount : Number(f.paid_amount || 0);
  const status = statusFor(amount, paid);

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (!cid) throw new Error('Please select a customer.');
      if (paid > amount) throw new Error('Paid amount cannot be more than the bill amount.');
      const row = clean({
        customer_id: cid,
        bill_date: f.bill_date,
        items: f.items,
        amount,
        paid_amount: paid,
        payment_status: status,
        notes: f.notes,
      });
      if (bill) {
        must(await supabase.from('bills').update(row).eq('id', bill.id));
      } else {
        must(await supabase.from('bills').insert({ ...row, created_by: user.id }));
        if (logVisit) {
          const existing = must(await supabase.from('visits').select('id').eq('customer_id', cid).eq('visit_date', f.bill_date).limit(1));
          if (!existing.length) {
            must(await supabase.from('visits').insert({ customer_id: cid, visit_date: f.bill_date, visit_type: 'Purchase', created_by: user.id }));
          }
        }
      }
      onSaved();
    });
  };

  return (
    <form onSubmit={submit} className="form">
      {!customerId && !bill && <label>Customer *<CustomerPicker value={cid} onChange={setCid} /></label>}
      <div className="grid2">
        <label>Bill date *<input type="date" required value={f.bill_date} onChange={set('bill_date')} /></label>
        <label>Bill amount (₹) *<input type="number" min="0" step="0.01" required value={f.amount} onChange={set('amount')} /></label>
      </div>
      <label>Items<textarea rows="2" placeholder="e.g. 2 suits, 1 dupatta" value={f.items} onChange={set('items')} /></label>
      <label className="check"><input type="checkbox" checked={fullPaid} onChange={(e) => setFullPaid(e.target.checked)} /> Paid in full</label>
      {!fullPaid && (
        <label>Amount paid (₹)<input type="number" min="0" step="0.01" value={f.paid_amount} onChange={set('paid_amount')} /></label>
      )}
      <div className="muted small">
        Status: <StatusBadge status={status} /> {status !== 'paid' && amount > 0 && <>· Due {inr(Math.max(0, amount - paid))}</>}
      </div>
      <label>Notes<textarea rows="2" value={f.notes} onChange={set('notes')} /></label>
      {!bill && (
        <label className="check"><input type="checkbox" checked={logVisit} onChange={(e) => setLogVisit(e.target.checked)} /> Also count this as a visit on the bill date</label>
      )}
      <ErrorBox error={error} />
      <FormButtons busy={busy} onCancel={onCancel} label={bill ? 'Update bill' : 'Save bill'} />
    </form>
  );
}

export function FollowupForm({ customerId, user, onSaved, onCancel }) {
  const [cid, setCid] = useState(customerId || '');
  const [f, setF] = useState({ due_date: addDays(1), notes: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useSave();

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (!cid) throw new Error('Please select a customer.');
      must(await supabase.from('followups').insert(clean({ customer_id: cid, ...f, status: 'pending', created_by: user.id })));
      onSaved();
    });
  };

  return (
    <form onSubmit={submit} className="form">
      {!customerId && <label>Customer *<CustomerPicker value={cid} onChange={setCid} /></label>}
      <label>Follow-up date *<input type="date" required value={f.due_date} onChange={set('due_date')} /></label>
      <label>What to follow up about<textarea rows="2" placeholder="e.g. Call about new collection" value={f.notes} onChange={set('notes')} /></label>
      <ErrorBox error={error} />
      <FormButtons busy={busy} onCancel={onCancel} label="Save follow-up" />
    </form>
  );
}

export function MonthPicker({ value, onChange }) {
  return <input type="month" className="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />;
}
