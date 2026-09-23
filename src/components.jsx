import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from './supabase';
import { addDays, billNo, billPoints, billText, customerPoints, hasRedeemColumn, pointsFor, redeemedOf, termsLines, deleteBillWithPin, insertVisits, dueOf, fmtDate, formatItems, hasTagsColumn, invalidateCustomers, loadCustomers, loadProducts, loadSettings, must, parseItems, statusFor, TAG_PRESETS, today, inr, WA_TEMPLATES, waLink, waSend, waText } from './utils';

export function Modal({ title, onClose, children }) {
  return createPortal(
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="icon" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
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

export function CustomerPicker({ value, onChange, onPicked, autoFocus }) {
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(!value);
  const inputRef = useRef(null);
  useEffect(() => { loadCustomers().then(setList).catch(() => {}); }, []);
  const sel = list.find((c) => c.id === value);
  const ql = q.trim().toLowerCase();
  const digits = ql.replace(/\D/g, '');
  const matches = ql
    ? list.filter((c) => (c.name || '').toLowerCase().includes(ql) || (digits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(digits))).slice(0, 8)
    : [];
  const pick = (c) => {
    onChange(c.id); setEditing(false); setQ('');
    if (onPicked) setTimeout(onPicked, 0);
  };
  // Only one customer matches → pick them and jump to the next box
  useEffect(() => {
    setActive(0);
    if (ql.length >= 3 && matches.length === 1) pick(matches[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, list.length]);

  if (!editing && sel) {
    return (
      <div className="picked">
        <div><b>{sel.name}</b>{sel.phone ? <span className="muted"> · {sel.phone}</span> : null}</div>
        <button type="button" className="link" onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}>Change</button>
      </div>
    );
  }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[active]) pick(matches[active]); }
    else if (e.key === 'Escape' && sel) { setEditing(false); setQ(''); }
  };
  return (
    <div className="typeahead">
      <input ref={inputRef} placeholder="Type customer name or mobile number…" value={q} autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} autoComplete="off" />
      {ql && (
        <div className="ta-list">
          {matches.length === 0 ? <div className="ta-empty">No customer found</div> : matches.map((c, i) => (
            <button type="button" key={c.id} className={`ta-opt ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => pick(c)}>
              <b>{c.name}</b>{c.phone ? <span className="muted"> · {c.phone}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Date box that always uses dd/mm/yyyy ----------
const toDMY = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
export function DateInput({ value, onChange, inputRef, onEnter, required }) {
  const [text, setText] = useState(toDMY(value));
  const hidden = useRef(null);
  useEffect(() => { setText(toDMY(value)); }, [value]);
  const handle = (raw) => {
    const d = raw.replace(/\D/g, '').slice(0, 8);
    if (!d.length) { setText(''); onChange(''); return; }
    setText(d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
    if (d.length === 8) {
      const iso = `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
      const dt = new Date(iso + 'T00:00:00');
      if (!isNaN(dt) && dt.getDate() === Number(d.slice(0, 2))) onChange(iso);
    }
  };
  return (
    <div className="date-input">
      <input ref={inputRef} type="text" inputMode="numeric" placeholder="dd/mm/yyyy" value={text} required={required} autoComplete="off"
        onChange={(e) => handle(e.target.value)} onBlur={() => setText(toDMY(value))}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); } }} />
      <button type="button" className="date-btn" aria-label="Open calendar" onClick={() => { try { hidden.current?.showPicker(); } catch { hidden.current?.click(); } }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      </button>
      <input ref={hidden} type="date" className="date-hidden" tabIndex={-1} value={value || ''} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </div>
  );
}

// ---------- Item list: categories you open, search jumps to the item ----------
export function ItemPicker({ products, onPick, inputRef }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState({});
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const groups = useMemo(() => {
    const g = {};
    products.forEach((p) => { (g[p.category || 'Other'] ||= []).push(p); });
    return Object.entries(g).sort(([a], [b]) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
  }, [products]);
  const ql = q.trim().toLowerCase();
  const results = useMemo(() => (ql ? products.filter((p) => p.name.toLowerCase().includes(ql) || (p.category || '').toLowerCase().includes(ql)).slice(0, 60) : []), [ql, products]);

  useEffect(() => { setActive(0); }, [ql]);
  useEffect(() => { listRef.current?.querySelector('.io.active')?.scrollIntoView({ block: 'nearest' }); }, [active, ql]);

  const choose = (p) => { setQ(''); onPick(p); };
  const onKey = (e) => {
    if (!ql) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (results[active]) choose(results[active]); }
  };

  return (
    <div className="item-picker">
      <input ref={inputRef} placeholder="Search item… (↑ ↓ to move, Enter to choose)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} autoComplete="off" />
      <div className="ip-list" ref={listRef}>
        {ql ? (
          results.length === 0 ? <div className="ta-empty">No item found</div> : results.map((p, i) => (
            <button type="button" key={p.id} className={`io ${i === active ? 'active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => choose(p)}>
              {p.name} <span className="io-cat">{p.category || 'Other'}</span>
            </button>
          ))
        ) : groups.map(([cat, items]) => (
          <div key={cat} className="ip-group">
            <button type="button" className={`ip-head ${open[cat] ? 'open' : ''}`} onClick={() => setOpen({ ...open, [cat]: !open[cat] })}>
              <span className="chev">{open[cat] ? '▾' : '▸'}</span> {cat} <span className="muted small">({items.length})</span>
            </button>
            {open[cat] && (
              <div className="ip-items">
                {items.slice(0, 200).map((p) => <button type="button" key={p.id} className="io" onClick={() => choose(p)}>{p.name}</button>)}
                {items.length > 200 && <div className="ta-empty">Showing 200 of {items.length}. Type in the search box to find others.</div>}
              </div>
            )}
          </div>
        ))}
      </div>
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
        <div className="field"><span>Date of birth</span><DateInput value={f.date_of_birth} onChange={(v) => setF((x) => ({ ...x, date_of_birth: v }))} /></div>
        <div className="field"><span>Anniversary</span><DateInput value={f.anniversary} onChange={(v) => setF((x) => ({ ...x, anniversary: v }))} /></div>
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
      await insertVisits(clean({ customer_id: cid, ...f, created_by: user.id }));
      onSaved();
    });
  };

  return (
    <form onSubmit={submit} className="form">
      {!customerId && <div className="field"><span>Customer *</span><CustomerPicker value={cid} onChange={setCid} autoFocus onPicked={() => document.querySelector('.modal .date-input input')?.focus()} /></div>}
      <div className="grid2">
        <div className="field"><span>Visit date *</span><DateInput value={f.visit_date} onChange={(v) => setF((x) => ({ ...x, visit_date: v }))} required /></div>
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
  const [redeem, setRedeem] = useState(bill ? String(redeemedOf(bill) || '') : '');
  const [available, setAvailable] = useState(null);
  const [redeemOk, setRedeemOk] = useState(true);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { busy, error, run } = useSave();
  const dateRef = useRef(null);
  useEffect(() => { hasRedeemColumn().then(setRedeemOk); }, []);
  useEffect(() => {
    setAvailable(null);
    if (cid) customerPoints(cid, bill?.id).then(setAvailable).catch(() => setAvailable(0));
  }, [cid, bill?.id]);
  const itemRef = useRef(null);
  const qtyRef = useRef(null);
  const rateRef = useRef(null);
  const focusSel = (r) => setTimeout(() => { r.current?.focus(); r.current?.select?.(); }, 0);
  const formRef = useRef(null);
  // Customer already chosen (bill opened from a customer's page) → start in the date box
  useEffect(() => { if (customerId || bill) focusSel(dateRef); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // F2 = save the bill
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'F2') { e.preventDefault(); formRef.current?.requestSubmit(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { loadProducts().then((p) => setProducts(p.filter((x) => x.active !== false))).catch(setProdErr); }, []);

  const pickedProduct = (products || []).find((x) => x.id === pick.id);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const disc = Math.max(0, Number(discount || 0));
  const gross = lines.length ? Math.max(0, subtotal - disc) : Number(f.amount || 0);
  const maxRedeem = Math.max(0, Math.min(available || 0, Math.floor(gross)));
  const used = Math.max(0, Math.min(Math.floor(Number(redeem || 0)), maxRedeem));
  const amount = Math.max(0, gross - used);
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
    focusSel(itemRef); // ready for the next item
  };
  const addCustom = () => {
    if (!pick.customName.trim() || pick.customRate === '') return;
    setLines([...lines, { name: pick.customName.trim().replace(/[@\n]/g, ' '), qty: Math.max(1, Number(pick.qty || 1)), rate: Number(pick.customRate) }]);
    setPick({ ...pick, customName: '', customRate: '', qty: 1 });
    focusSel(itemRef);
  };
  const updLine = (i, k, v) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: Math.max(0, Number(v || 0)) } : l)));

  const submit = (e) => {
    e.preventDefault();
    if (busy) return; // avoid saving twice (e.g. F2 pressed quickly)
    run(async () => {
      if (!cid) throw new Error('Please select a customer.');
      if (!f.bill_date) throw new Error('Please enter the bill date (dd/mm/yyyy).');
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
      if (redeemOk) row.points_redeemed = used;
      if (Number(redeem || 0) > used) throw new Error(`Only ${maxRedeem} points can be used on this bill.`);
      let result;
      if (bill) {
        result = must(await supabase.from('bills').update(row).eq('id', bill.id).select().single());
        onSaved(result);
        return;
      }
      result = must(await supabase.from('bills').insert({ ...row, created_by: user.id }).select().single());
      let visitNote = '';
      if (logVisit) {
        // The bill is already saved; a problem with the visit must not block it (avoids duplicate bills)
        try {
          const existing = must(await supabase.from('visits').select('id').eq('customer_id', cid).eq('visit_date', f.bill_date).limit(1));
          if (!existing.length) await insertVisits({ customer_id: cid, visit_date: f.bill_date, visit_type: 'Purchase', created_by: user.id });
        } catch (x) { visitNote = `Bill saved, but the visit could not be recorded: ${x.message}`; }
      }
      setSaved({ ...result, _visitNote: visitNote });
    });
  };

  if (saved) {
    return <BillSaved bill={saved} onDone={() => onSaved(saved)} />;
  }

  return (
    <form ref={formRef} onSubmit={submit} className="form bill-form">
      {!customerId && !bill && <div className="field"><span>Customer *</span><CustomerPicker value={cid} onChange={setCid} autoFocus onPicked={() => focusSel(dateRef)} /></div>}
      <div className="field"><span>Bill date *</span><DateInput value={f.bill_date} onChange={(v) => setF((x) => ({ ...x, bill_date: v }))} inputRef={dateRef} onEnter={() => focusSel(itemRef)} required /></div>

      <div className="item-box">
        <div className="item-box-title">Items</div>
        {prodErr ? (
          <div className="muted small">Item list not set up yet. Run the setup SQL, then add items on the <b>Items</b> page. You can still add items by hand below.</div>
        ) : products && products.length === 0 ? (
          <div className="muted small">No items in your list yet. Add them on the <b>Items</b> page, or add one by hand below.</div>
        ) : (
          <div className="item-pick">
            <ItemPicker products={products || []} inputRef={itemRef}
              onPick={(p) => { setPick((x) => ({ ...x, id: p.id })); focusSel(qtyRef); }} />
            {pickedProduct && <div className="picked small"><div>Selected: <b>{pickedProduct.name}</b> <span className="muted">· {pickedProduct.category || 'Other'}</span></div></div>}
            <div className="item-add">
              <label className="inline">Qty<input ref={qtyRef} type="number" min="1" value={pick.qty} onChange={(e) => setPick({ ...pick, qty: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusSel(rateRef); } }} /></label>
              <label className="inline">Price ₹<input ref={rateRef} className="price-in" type="number" min="0" step="0.01" placeholder="0" value={pick.rate} onChange={(e) => setPick({ ...pick, rate: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProduct(); } }} /></label>
              <button type="button" className="btn primary small" disabled={!pick.id || pick.rate === ''} onClick={addProduct}>+ Add item</button>
            </div>
          </div>
        )}
        <details className="custom-item">
          <summary>Add an item that's not in the list</summary>
          <div className="item-add">
            <input placeholder="Item name" value={pick.customName} onChange={(e) => setPick({ ...pick, customName: e.target.value })} />
            <input type="number" min="0" step="0.01" placeholder="Price ₹" value={pick.customRate} onChange={(e) => setPick({ ...pick, customRate: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
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
              {used > 0 && <tr><td colSpan="3" className="num muted">Loyalty points redeemed</td><td className="num">− {inr(used)}</td><td></td></tr>}
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

      {cid && (
        <div className="redeem-box">
          <div className="redeem-head">
            <b>★ Redeem loyalty points</b>
            <span className="muted small">{available == null ? 'Checking points…' : <>Available: <b className="pts">{available}</b> points (= {inr(available)})</>}</span>
          </div>
          {!redeemOk ? (
            <div className="muted small">To redeem points, run <b>loyalty-setup.sql</b> in Supabase → SQL Editor, then refresh.</div>
          ) : (
            <div className="item-add">
              <label className="inline">Use points<input className="price-in" type="number" min="0" max={maxRedeem} step="1" placeholder="0" value={redeem}
                onChange={(e) => setRedeem(e.target.value)} disabled={!maxRedeem && !redeem} /></label>
              <button type="button" className="btn small" disabled={!maxRedeem} onClick={() => setRedeem(String(maxRedeem))}>Use all ({maxRedeem})</button>
              {used > 0 && <button type="button" className="link" onClick={() => setRedeem('')}>Clear</button>}
              {used > 0 && <span className="small">− {inr(used)} off</span>}
            </div>
          )}
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
      <div className="save-bar">
        <span className="muted small">Total <b>{inr(amount)}</b>{used > 0 && <> · <span className="pts">−{used} pts used</span></>}{amount > 0 && <> · <span className="pts">{disc > 0 || used > 0 ? 'no points (discount)' : `+${pointsFor(amount)} pts`}</span></>} · Press <kbd>F2</kbd> to save</span>
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : bill ? 'Update bill (F2)' : 'Save bill (F2)'}</button>
        </div>
      </div>
    </form>
  );
}

function BillSaved({ bill, onDone }) {
  const [printing, setPrinting] = useState(false);
  const [c, setC] = useState(null);
  const [shop, setShop] = useState(null);
  const [balance, setBalance] = useState(null);
  useEffect(() => {
    customerPoints(bill.customer_id).then(setBalance).catch(() => {});
    supabase.from('customers').select('*').eq('id', bill.customer_id).single().then(({ data }) => setC(data));
    loadSettings().then(setShop);
  }, [bill.customer_id]);
  const wa = c && shop && waSend(c.phone, billText(bill, c, shop));
  const waPts = c && balance != null && waSend(c.phone, waText('points', { customer: c, shop, points: balance, earned: billPoints(bill) }));
  return (
    <div className="saved">
      <div className="saved-icon">✓</div>
      <h3>Bill saved</h3>
      <p className="muted">{billNo(bill)} · {inr(bill.amount)}</p>
      <p className="points-earned">★ {billPoints(bill) ? `+${billPoints(bill)} points earned` : 'No points on this bill (discount given)'}{redeemedOf(bill) > 0 && <> · {redeemedOf(bill)} points used</>}{balance != null && <> · Balance <b>{balance}</b> points</>}</p>
      {bill._visitNote && <div className="error small">{bill._visitNote}</div>}
      <div className="actions center-row">
        <button className="btn" onClick={() => setPrinting(true)}>Print estimate</button>
        {wa && <a className="btn" href={wa} target="_blank" rel="noreferrer">Send bill on WhatsApp</a>}
        {waPts && <a className="btn" href={waPts} target="_blank" rel="noreferrer">Send points on WhatsApp</a>}
        <button className="btn primary" onClick={onDone}>Done</button>
      </div>
      {printing && <PrintBill bill={bill} onClose={() => setPrinting(false)} />}
    </div>
  );
}

const rs = (n) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const longDate = (d) => (d ? new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

export function PrintBill({ bill, onClose }) {
  const receiptRef = useRef(null);
  const [c, setC] = useState(null);
  const [shop, setShop] = useState(null);
  const [balance, setBalance] = useState(null);
  useEffect(() => {
    customerPoints(bill.customer_id).then(setBalance).catch(() => {});
    supabase.from('customers').select('*').eq('id', bill.customer_id).single().then(({ data }) => setC(data));
    loadSettings().then(setShop);
  }, [bill.customer_id]);
  useEffect(() => {
    const old = document.title;
    document.title = `Estimate ${billNo(bill)}`;
    return () => { document.title = old; };
  }, [bill]);
  const { lines, ok } = parseItems(bill.items);
  const items = lines.filter((l) => l.name !== 'Discount');
  const disc = -(lines.find((l) => l.name === 'Discount')?.rate || 0);

  return createPortal(
    <div className="print-root">
      <div className="print-toolbar no-print">
        <ShareBill bill={bill} customer={c} receiptRef={receiptRef} />
        <button className="btn primary" onClick={() => window.print()} disabled={!shop}>Print / Save as PDF</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      <div className="receipt" ref={receiptRef}>
        <div className="r-top">
          <div className="r-brand">
            <img src="/logo.png" alt="" className="r-logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            <div>
              <div className="r-shop">{shop?.shop_name || 'Sri Kangna'}</div>
              {shop?.address && <div className="r-addr">{shop.address}</div>}
              {shop?.phone && <div className="r-addr">Phone: {shop.phone}</div>}
            </div>
          </div>
          <div className="r-doc">
            <div className="r-title">Estimate</div>
            <div className="r-no">{billNo(bill)}</div>
          </div>
        </div>
        <div className="r-meta">
          <div>
            <div className="r-label">BILLED TO</div>
            <div className="r-name">{c?.name || ''}</div>
            {c?.phone && <div className="r-sub">{c.phone}</div>}
          </div>
          <div className="r-right">
            <div className="r-label">DATE</div>
            <div className="r-date">{longDate(bill.bill_date)}</div>
          </div>
        </div>
        <table className="r-table">
          <thead><tr><th>ITEM</th><th className="num">QTY</th><th className="num">RATE</th><th className="num">AMOUNT</th></tr></thead>
          <tbody>
            {ok && items.length ? items.map((l, i) => (
              <tr key={i}><td>{l.name}</td><td className="num">{l.qty}</td><td className="num">{rs(l.rate)}</td><td className="num">{rs(l.qty * l.rate)}</td></tr>
            )) : (
              <tr><td>{bill.items || 'Purchase'}</td><td className="num">1</td><td className="num">{rs(bill.amount)}</td><td className="num">{rs(bill.amount)}</td></tr>
            )}
          </tbody>
        </table>
        <div className="r-totals">
          {(disc > 0 || redeemedOf(bill) > 0) && <><div>Subtotal</div><div>{rs(Number(bill.amount) + disc + redeemedOf(bill))}</div></>}
          {disc > 0 && <><div>Discount</div><div>− {rs(disc)}</div></>}
          {redeemedOf(bill) > 0 && <><div>Loyalty points redeemed</div><div>− {rs(redeemedOf(bill))}</div></>}
          <div className="r-grand-l">Total</div><div className="r-grand">{rs(bill.amount)}</div>
          {dueOf(bill) > 0 && <><div>Paid</div><div>{rs(bill.paid_amount)}</div><div><b>Balance due</b></div><div><b>{rs(dueOf(bill))}</b></div></>}
        </div>
        {bill.notes && !/^Old bill no:/.test(bill.notes) && <div className="r-notes">Note: {bill.notes}</div>}
        {termsLines(shop?.terms).length > 0 && (
          <div className="r-terms">
            <div className="r-terms-title">Terms &amp; Conditions</div>
            <ol>{termsLines(shop.terms).map((t, i) => <li key={i}>{t}</li>)}</ol>
          </div>
        )}
        {shop?.bill_footer && <div className="r-foot">{shop.bill_footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function WhatsAppMenu({ customer, due = 0, points, small = false, only }) {
  const [open, setOpen] = useState(false);
  const [shop, setShop] = useState(null);
  useEffect(() => { if (open && !shop) loadSettings().then(setShop); }, [open, shop]);
  if (!waLink(customer?.phone)) return null;
  const list = WA_TEMPLATES.filter((t) => (only ? only.includes(t.key) : true)).filter((t) => t.key !== 'due' || due > 0).filter((t) => t.key !== 'points' || points != null);
  return (
    <div className="menu-wrap">
      <button type="button" className={`btn ${small ? 'small' : ''}`} onClick={() => setOpen(!open)}>WhatsApp ▾</button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu">
            {list.map((t) => (
              <a key={t.key} href={waSend(customer.phone, waText(t.key, { customer, shop, due, points }))} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>{t.label}</a>
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
      {!customerId && <div className="field"><span>Customer *</span><CustomerPicker value={cid} onChange={setCid} autoFocus onPicked={() => document.querySelector('.modal .date-input input')?.focus()} /></div>}
      <div className="field"><span>Follow-up date *</span><DateInput value={f.due_date} onChange={(v) => setF((x) => ({ ...x, due_date: v }))} required /></div>
      <label>What to follow up about<textarea rows="2" placeholder="e.g. Call about new collection" value={f.notes} onChange={set('notes')} /></label>
      <ErrorBox error={error} />
      <FormButtons busy={busy} onCancel={onCancel} label="Save follow-up" />
    </form>
  );
}

export function MonthPicker({ value, onChange }) {
  return <input type="month" className="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />;
}

export function PinInput({ value, onChange, autoFocus }) {
  // A plain text box shown as dots, so the browser never saves or auto-fills the PIN like a password
  const [name] = useState(() => `pin-${Math.random().toString(36).slice(2)}`);
  return (
    <input className="pin-input" type="text" name={name} inputMode="numeric" autoComplete="off" autoCorrect="off" spellCheck={false}
      data-lpignore="true" data-1p-ignore="true" data-form-type="other" maxLength={4} placeholder="••••"
      value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))} />
  );
}

export function DeleteBillModal({ bill, customerName, onDeleted, onClose }) {
  const [pin, setPin] = useState('');
  const { busy, error, run } = useSave();
  const submit = (e) => {
    e.preventDefault();
    run(async () => { await deleteBillWithPin(bill.id, pin); onDeleted(); });
  };
  return (
    <Modal title="Delete bill" onClose={onClose}>
      <form className="form" onSubmit={submit} autoComplete="off">
        <div className="delete-summary">
          <div><b>{customerName || 'Customer'}</b> · {fmtDate(bill.bill_date)}</div>
          <div className="muted small">{billNo(bill)} · {inr(bill.amount)}</div>
        </div>
        <p className="muted small">This cannot be undone. Enter the 4-digit delete PIN to confirm. Forgot it? The owner can reset it in <b>Settings → Delete PIN</b>.</p>
        <label>Delete PIN<PinInput value={pin} onChange={setPin} autoFocus /></label>
        <ErrorBox error={error} />
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn danger-btn" disabled={busy || pin.length !== 4}>{busy ? 'Deleting…' : 'Delete bill'}</button>
        </div>
      </form>
    </Modal>
  );
}


// Send a bill to the customer's WhatsApp (as a message), or share it as an image
export function ShareBill({ bill, customer, small, receiptRef }) {
  const [c, setC] = useState(customer || null);
  const [shop, setShop] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadSettings().then(setShop);
    if (!customer) supabase.from('customers').select('*').eq('id', bill.customer_id).single().then(({ data }) => setC(data));
  }, [bill.customer_id, customer]);
  const link = c && shop && waSend(c.phone, billText(bill, c, shop));
  const shareImage = async () => {
    const el = receiptRef?.current;
    if (!el) return;
    setBusy(true);
    try {
      const { default: html2canvas } = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm');
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const file = new File([blob], `${billNo(bill)}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `Estimate ${billNo(bill)}` });
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
        alert('The bill image was downloaded. Attach it in WhatsApp (the chat opens next).');
        if (link) window.open(link, '_blank');
      }
    } catch (e) { if (e?.name !== 'AbortError') alert('Could not create the image: ' + e.message); }
    finally { setBusy(false); }
  };
  if (c && !waLink(c.phone)) return <span className="muted small">No mobile number</span>;
  return (
    <>
      <a className={`btn wa-btn ${small ? 'small' : ''}`} href={link || '#'} target="_blank" rel="noreferrer" onClick={(e) => { if (!link) e.preventDefault(); }}>
        <WaIcon /> Share on WhatsApp
      </a>
      {receiptRef && <button type="button" className={`btn ${small ? 'small' : ''}`} disabled={busy} onClick={shareImage}>{busy ? 'Preparing…' : 'Share as image'}</button>}
    </>
  );
}
export const WaIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3z"/></svg>
);
