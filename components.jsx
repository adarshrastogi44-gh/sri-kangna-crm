import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from './supabase';
import { addDays, billNo, dueOf, fmtDate, formatItems, hasTagsColumn, invalidateCustomers, loadCustomers, loadProducts, loadSettings, must, parseItems, statusFor, TAG_PRESETS, today, inr, WA_TEMPLATES, waLink, waSend, waText } from './utils';

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
  const [tags, setTags] = useState(customer?.tags || []);
  const [tagsOk, setTagsOk] = useState(false);
  useEffect(() => { hasTagsColumn().then(setTagsOk); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useSave();

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const row = clean(f);
      if (tagsOk) row.tags = tags;
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
      {tagsOk && <div className="field"><span>Tags</span><TagPicker value={tags} onChange={setTags} /></div>}
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
  const parsed = parseItems(bill?.items);
  const [cid, setCid] = useState(bill?.customer_id || customerId || '');
  const [f, setF] = useState({
    bill_date: bill?.bill_date || today(),
    amount: bill?.amount ?? '',
    paid_amount: bill?.paid_amount ?? '',
    notes: bill?.notes || '',
    freeItems: parsed.ok ? '' : bill?.items || '',
  });
  const [lines, setLines] = useState(parsed.ok ? parsed.lines.filter((l) => l.name !== 'Discount') : []);
  const [discount, setDiscount] = useState(parsed.ok ? String(-(parsed.lines.find((l) => l.name === 'Discount')?.rate || 0) || '') : '');
  const [products, setProducts] = useState(null);
  const [prodErr, setProdErr] = useState(null);
  const [pick, setPick] = useState({ q: '', id: '', qty: 1, rate: '', customName: '', customRate: '' });
  const [fullPaid, setFullPaid] = useState(bill ? Number(bill.paid_amount || 0) >= Number(bill.amount || 0) : true);
  const [logVisit, setLogVisit] = useState(!bill);
  const [saved, setSaved] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useSave();

  useEffect(() => { loadProducts().then((p) => setProducts(p.filter((x) => x.active !== false))).catch(setProdErr); }, []);

  const subtotal = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const disc = Math.max(0, Number(discount || 0));
  const amount = lines.length ? Math.max(0, subtotal - disc) : Number(f.amount || 0);
  const paid = fullPaid ? amount : Number(f.paid_amount || 0);
  const status = statusFor(amount, paid);

  const ql = pick.q.trim().toLowerCase();
  const shownProducts = (products || []).filter((p) => !ql || p.name.toLowerCase().includes(ql) || (p.category || '').toLowerCase().includes(ql));
  const groups = Object.entries(shownProducts.reduce((g, p) => { const k = p.category || 'Other'; (g[k] ||= []).push(p); return g; }, {}))
    .sort(([a], [b]) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));

  const addProduct = () => {
    const p = (products || []).find((x) => x.id === pick.id);
    if (!p) return;
    if (pick.rate === '') return;
    const qty = Math.max(1, Number(pick.qty || 1));
    const rate = Math.max(0, Number(pick.rate));
    const i = lines.findIndex((l) => l.name === p.name && l.rate === rate);
    if (i >= 0) setLines(lines.map((l, j) => (j === i ? { ...l, qty: l.qty + qty } : l)));
    else setLines([...lines, { name: p.name, qty, rate }]);
    setPick({ ...pick, id: '', qty: 1, rate: '' });
  };
  const addCustom = () => {
    if (!pick.customName.trim() || pick.customRate === '') return;
    setLines([...lines, { name: pick.customName.trim().replace(/[@\n]/g, ' '), qty: Math.max(1, Number(pick.qty || 1)), rate: Number(pick.customRate) }]);
    setPick({ ...pick, customName: '', customRate: '', qty: 1 });
  };
  const updLine = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: Math.max(0, Number(v || 0)) } : l)));

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (!cid) throw new Error('Please select a customer.');
      if (!lines.length && !(amount > 0)) throw new Error('Add at least one item, or enter the bill amount.');
      if (paid > amount) throw new Error('Paid amount cannot be more than the bill amount.');
      const itemsText = lines.length
        ? formatItems(disc > 0 ? [...lines, { qty: 1, name: 'Discount', rate: -disc }] : lines)
        : f.freeItems;
      const row = clean({
        customer_id: cid,
        bill_date: f.bill_date,
        items: itemsText,
        amount,
        paid_amount: paid,
        payment_status: status,
        notes: f.notes,
      });
      let result;
      if (bill) {
        result = must(await supabase.from('bills').update(row).eq('id', bill.id).select().single());
        onSaved(result);
        return;
      }
      result = must(await supabase.from('bills').insert({ ...row, created_by: user.id }).select().single());
      if (logVisit) {
        const existing = must(await supabase.from('visits').select('id').eq('customer_id', cid).eq('visit_date', f.bill_date).limit(1));
        if (!existing.length) {
          must(await supabase.from('visits').insert({ customer_id: cid, visit_date: f.bill_date, visit_type: 'Purchase', created_by: user.id }));
        }
      }
      setSaved(result);
    });
  };

  if (saved) {
    return <BillSaved bill={saved} onDone={() => onSaved(saved)} />;
  }

  return (
    <form onSubmit={submit} className="form">
      {!customerId && !bill && <label>Customer *<CustomerPicker value={cid} onChange={setCid} /></label>}
      <label>Bill date *<input type="date" required value={f.bill_date} onChange={set('bill_date')} /></label>

      <div className="item-box">
        <div className="item-box-title">Items</div>
        {prodErr ? (
          <div className="muted small">Item list not set up yet. Run the setup SQL, then add items on the <b>Items</b> page. You can still add items by hand below.</div>
        ) : products && products.length === 0 ? (
          <div className="muted small">No items in your list yet. Add them on the <b>Items</b> page, or add one by hand below.</div>
        ) : (
          <div className="item-pick">
            <input placeholder="Search items…" value={pick.q} onChange={(e) => setPick({ ...pick, q: e.target.value })} />
            <select value={pick.id} onChange={(e) => setPick({ ...pick, id: e.target.value })} size={Math.min(8, Math.max(4, shownProducts.length + groups.length + 1))}>
              <option value="" disabled>— Select item —</option>
              {groups.map(([cat, items]) => (
                <optgroup key={cat} label={cat}>
                  {items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </optgroup>
              ))}
            </select>
            <div className="item-add">
              <label className="inline">Qty<input type="number" min="1" value={pick.qty} onChange={(e) => setPick({ ...pick, qty: e.target.value })} /></label>
              <label className="inline">Price ₹<input className="price-in" type="number" min="0" step="0.01" placeholder="0" value={pick.rate} onChange={(e) => setPick({ ...pick, rate: e.target.value })} /></label>
              <button type="button" className="btn primary small" disabled={!pick.id || pick.rate === ''} onClick={addProduct}>+ Add item</button>
            </div>
          </div>
        )}
        <details className="custom-item">
          <summary>Add an item that's not in the list</summary>
          <div className="item-add">
            <input placeholder="Item name" value={pick.customName} onChange={(e) => setPick({ ...pick, customName: e.target.value })} />
            <input type="number" min="0" step="0.01" placeholder="Price ₹" value={pick.customRate} onChange={(e) => setPick({ ...pick, customRate: e.target.value })} />
            <button type="button" className="btn small" onClick={addCustom}>+ Add</button>
          </div>
        </details>

        {lines.length > 0 && (
          <table className="lines">
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.name}</td>
                  <td className="num"><input className="mini" type="number" min="1" value={l.qty} onChange={(e) => updLine(i, 'qty', e.target.value)} /></td>
                  <td className="num"><input className="mini wide" type="number" min="0" step="0.01" value={l.rate} onChange={(e) => updLine(i, 'rate', e.target.value)} /></td>
                  <td className="num">{inr(l.qty * l.rate)}</td>
                  <td><button type="button" className="icon small" aria-label="Remove item" onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button></td>
                </tr>
              ))}
              <tr><td colSpan="3" className="num muted">Subtotal</td><td className="num">{inr(subtotal)}</td><td></td></tr>
              <tr>
                <td colSpan="3" className="num muted">Discount (₹)</td>
                <td className="num"><input className="mini wide" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></td><td></td>
              </tr>
              <tr className="total"><td colSpan="3" className="num">Total</td><td className="num">{inr(amount)}</td><td></td></tr>
            </tbody>
          </table>
        )}
      </div>

      {lines.length === 0 && (
        <div className="grid2">
          <label>Bill amount (₹) *<input type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} /></label>
          <label>Items (text)<input placeholder="Optional description" value={f.freeItems} onChange={set('freeItems')} /></label>
        </div>
      )}

      <label className="check"><input type="checkbox" checked={fullPaid} onChange={(e) => setFullPaid(e.target.checked)} /> Paid in full</label>
      {!fullPaid && (
        <label>Amount paid (₹)<input type="number" min="0" step="0.01" value={f.paid_amount} onChange={set('paid_amount')} /></label>
      )}
      <div className="muted small">
        Total {inr(amount)} · Status: <StatusBadge status={status} /> {status !== 'paid' && amount > 0 && <>· Due {inr(Math.max(0, amount - paid))}</>}
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

function BillSaved({ bill, onDone }) {
  const [printing, setPrinting] = useState(false);
  const [c, setC] = useState(null);
  const [shop, setShop] = useState(null);
  useEffect(() => {
    supabase.from('customers').select('*').eq('id', bill.customer_id).single().then(({ data }) => setC(data));
    loadSettings().then(setShop);
  }, [bill.customer_id]);
  const wa = c && waSend(c.phone, waText('thanks', { customer: c, shop, bill }));
  return (
    <div className="saved">
      <div className="saved-icon">✓</div>
      <h3>Bill saved</h3>
      <p className="muted">{billNo(bill)} · {inr(bill.amount)}</p>
      <div className="actions center-row">
        <button className="btn" onClick={() => setPrinting(true)}>Print bill</button>
        {wa && <a className="btn" href={wa} target="_blank" rel="noreferrer">Send on WhatsApp</a>}
        <button className="btn primary" onClick={onDone}>Done</button>
      </div>
      {printing && <PrintBill bill={bill} onClose={() => setPrinting(false)} />}
    </div>
  );
}

export function PrintBill({ bill, onClose }) {
  const [c, setC] = useState(null);
  const [shop, setShop] = useState(null);
  useEffect(() => {
    supabase.from('customers').select('*').eq('id', bill.customer_id).single().then(({ data }) => setC(data));
    loadSettings().then(setShop);
  }, [bill.customer_id]);
  const { lines, ok } = parseItems(bill.items);
  const items = lines.filter((l) => l.name !== 'Discount');
  const disc = -(lines.find((l) => l.name === 'Discount')?.rate || 0);

  return createPortal(
    <div className="print-root">
      <div className="print-toolbar no-print">
        <button className="btn primary" onClick={() => window.print()} disabled={!shop}>Print / Save as PDF</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      <div className="receipt">
        <div className="r-head">
          <div className="r-shop">{shop?.shop_name || 'Sri Kangna'}</div>
          {shop?.address && <div>{shop.address}</div>}
          {shop?.phone && <div>Phone: {shop.phone}</div>}
          {shop?.gstin && <div>GSTIN: {shop.gstin}</div>}
        </div>
        <div className="r-meta">
          <div><b>Bill no:</b> {billNo(bill)}</div>
          <div><b>Date:</b> {fmtDate(bill.bill_date)}</div>
          <div><b>Customer:</b> {c?.name || ''}</div>
          {c?.phone && <div><b>Phone:</b> {c.phone}</div>}
        </div>
        <table className="r-table">
          <thead><tr><th>#</th><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {ok && items.length ? items.map((l, i) => (
              <tr key={i}><td>{i + 1}</td><td>{l.name}</td><td className="num">{l.qty}</td><td className="num">{inr(l.rate)}</td><td className="num">{inr(l.qty * l.rate)}</td></tr>
            )) : (
              <tr><td>1</td><td>{bill.items || 'Purchase'}</td><td className="num">1</td><td className="num">{inr(bill.amount)}</td><td className="num">{inr(bill.amount)}</td></tr>
            )}
          </tbody>
        </table>
        <div className="r-totals">
          {disc > 0 && <><div>Subtotal</div><div>{inr(Number(bill.amount) + disc)}</div><div>Discount</div><div>− {inr(disc)}</div></>}
          <div className="r-grand">Total</div><div className="r-grand">{inr(bill.amount)}</div>
          <div>Paid</div><div>{inr(bill.paid_amount)}</div>
          {dueOf(bill) > 0 && <><div><b>Balance due</b></div><div><b>{inr(dueOf(bill))}</b></div></>}
        </div>
        {bill.notes && <div className="r-notes">Note: {bill.notes}</div>}
        <div className="r-foot">{shop?.bill_footer || 'Thank you for shopping with us!'}</div>
      </div>
    </div>,
    document.body
  );
}

export function WhatsAppMenu({ customer, due = 0, small = false, only }) {
  const [open, setOpen] = useState(false);
  const [shop, setShop] = useState(null);
  useEffect(() => { if (open && !shop) loadSettings().then(setShop); }, [open, shop]);
  if (!waLink(customer?.phone)) return null;
  const list = WA_TEMPLATES.filter((t) => (only ? only.includes(t.key) : true)).filter((t) => t.key !== 'due' || due > 0);
  return (
    <div className="menu-wrap">
      <button type="button" className={`btn ${small ? 'small' : ''}`} onClick={() => setOpen(!open)}>WhatsApp ▾</button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu">
            {list.map((t) => (
              <a key={t.key} href={waSend(customer.phone, waText(t.key, { customer, shop, due }))} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>{t.label}</a>
            ))}
            <a href={waLink(customer.phone)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>Blank message</a>
          </div>
        </>
      )}
    </div>
  );
}

export function TagPicker({ value = [], onChange }) {
  const [custom, setCustom] = useState('');
  const toggle = (t) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  const all = [...new Set([...TAG_PRESETS, ...value])];
  return (
    <div className="tag-picker">
      {all.map((t) => (
        <button type="button" key={t} className={`chip ${value.includes(t) ? 'on' : ''}`} onClick={() => toggle(t)}>{t}</button>
      ))}
      <input className="mini wide" placeholder="+ new tag" value={custom} onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const t = custom.trim(); if (t && !value.includes(t)) onChange([...value, t]); setCustom(''); } }} />
    </div>
  );
}

export const Tags = ({ tags }) => (tags && tags.length ? <span className="tags">{tags.map((t) => <span key={t} className={`tag ${t === 'VIP' ? 'vip' : ''}`}>{t}</span>)}</span> : null);

// Simple single-series bar chart (one hue, value on hover, latest value labelled)
export function BarChart({ data, format = (v) => v, label }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const [hover, setHover] = useState(null);
  const last = data.length - 1;
  return (
    <div className="chart" role="img" aria-label={label}>
      <div className="chart-plot">
        {data.map((d, i) => (
          <div key={d.key} className={`chart-col ${hover === i ? 'hover' : ''}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {(hover === i || (hover === null && i === last)) && <div className="chart-val">{format(d.value)}</div>}
            <div className="chart-bar" style={{ height: `${(d.value / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="chart-axis">{data.map((d) => <div key={d.key}>{d.label}</div>)}</div>
    </div>
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
