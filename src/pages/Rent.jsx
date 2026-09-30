import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabase';
import { Badge, DateInput, Empty, ErrorBox, Loading } from '../components';
import { addDays, fetchAll, inr, loadSettings, today } from '../utils';

// ---------- helpers ----------
export const rentNo = (r) => `R-${String(r.booking_no || 0).padStart(3, '0')}`;
export const d8 = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const t12 = (s) => { if (!s) return ''; const [h, m] = s.split(':'); const H = Number(h); return `${H % 12 || 12}:${m} ${H < 12 ? 'AM' : 'PM'}`; };
export const rentBalance = (r) => Math.max(0, Number(r.rate || 0) - Number(r.advance || 0));
export const daysTo = (d) => Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000);
export const whenLabel = (d) => { const n = daysTo(d); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === 2 ? 'In 2 days' : n < 0 ? `${-n} day${n === -1 ? '' : 's'} ago` : `In ${n} days`; };

const STATUS = {
  booked: ['Booked', 'blue'],
  delivered: ['Delivered', 'amber'],
  returned: ['Returned', 'green'],
  cancelled: ['Cancelled', 'gray'],
};
export const RentStatus = ({ r }) => {
  const late = r.status === 'delivered' && r.dor < today();
  return <Badge tone={late ? 'red' : STATUS[r.status]?.[1] || 'gray'}>{late ? 'Return overdue' : STATUS[r.status]?.[0] || r.status}</Badge>;
};
const OCCASIONS = ['Wedding', 'Engagement', 'Haldi', 'Mehendi', 'Reception', 'Sangeet', 'Photoshoot', 'Karva Chauth', 'Party'];
const COLOURS = ['Green', 'Ruby', 'Red', 'Ruby+Green', 'Pink+Mint', 'Mint', 'White', 'Antik', 'LCT', 'Pink', 'Mehroon'];
const COL_KEY = 'sk-rent-colours';
const savedColours = () => { try { return JSON.parse(localStorage.getItem(COL_KEY) || '[]'); } catch { return []; } };

// Pick one colour from the list, or add a new colour to the list (remembered on this computer)
function ColourPicker({ value, onChange, extra = [] }) {
  const [mine, setMine] = useState(savedColours);
  const [adding, setAdding] = useState(false);
  const [txt, setTxt] = useState('');
  const all = [...new Set([...COLOURS, ...mine, ...extra.filter(Boolean)])];
  const add = () => {
    const c = txt.trim();
    if (!c) { setAdding(false); return; }
    const next = all.some((x) => x.toLowerCase() === c.toLowerCase()) ? mine : [...mine, c];
    setMine(next); try { localStorage.setItem(COL_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    onChange(all.find((x) => x.toLowerCase() === c.toLowerCase()) || c);
    setTxt(''); setAdding(false);
  };
  const remove = (c) => {
    const next = mine.filter((x) => x !== c);
    setMine(next); try { localStorage.setItem(COL_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    if (value === c) onChange('');
  };
  return (
    <div className="colour-pick">
      {all.map((c) => (
        <span key={c} className={`chip ${value === c ? 'on' : ''}`} role="button" tabIndex={0}
          onClick={() => onChange(value === c ? '' : c)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(value === c ? '' : c); } }}>
          {c}{mine.includes(c) && <button type="button" className="chip-x" title="Remove from list" onClick={(e) => { e.stopPropagation(); remove(c); }}>×</button>}
        </span>
      ))}
      {adding ? (
        <span className="colour-add">
          <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="New colour"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } if (e.key === 'Escape') setAdding(false); }} />
          <button type="button" className="btn small primary" onClick={add}>Add</button>
        </span>
      ) : (
        <button type="button" className="chip add-chip" onClick={() => setAdding(true)}>+ Add colour</button>
      )}
    </div>
  );
}
const OPEN_KEY = 'sk-rent-open';
export const openRentLater = (id) => { try { sessionStorage.setItem(OPEN_KEY, id); } catch { /* ignore */ } };

export default function Rent() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState('upcoming');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [openId, setOpenId] = useState(() => { try { const v = sessionStorage.getItem(OPEN_KEY); sessionStorage.removeItem(OPEN_KEY); return v; } catch { return null; } });

  useEffect(() => {
    fetchAll(() => supabase.from('rentals').select('*').order('dod', { ascending: true })).then(setRows).catch(setErr);
  }, [tick]);
  const refresh = () => setTick((t) => t + 1);

  const missing = err && /rentals/.test(err.message || '') && /(does not exist|schema cache|not find)/i.test(err.message || '');
  if (missing) {
    return (
      <>
        <div className="page-head"><h1>Jewellery on Rent</h1></div>
        <div className="card"><h2>One-time setup needed</h2><p>Open <b>Supabase → SQL Editor</b>, paste the contents of <code>rent-setup.sql</code> and click <b>Run</b>. Then refresh this page.</p></div>
      </>
    );
  }
  if (err) return <ErrorBox error={err} />;
  if (!rows) return <Loading />;

  const nextNo = rows.reduce((mx, x) => Math.max(mx, Number(x.booking_no || 0)), 0) + 1;
  if (modal) {
    return <RentEditor r={modal.id ? modal : null} nextNo={nextNo} onBack={() => setModal(null)} onSaved={(saved) => { setModal(null); refresh(); if (saved?.id) setOpenId(saved.id); }} />;
  }
  if (openId) {
    const r = rows.find((x) => x.id === openId);
    if (r) return <RentDetail r={r} onEdit={() => setModal(r)} onBack={() => setOpenId(null)} onChanged={refresh} onDeleted={() => { setOpenId(null); refresh(); }} />;
  }

  const t = today();
  const ql = q.trim().toLowerCase();
  const match = (r) => !ql || [r.name, r.mob1, r.mob2, r.set_code, r.colour, rentNo(r), r.booked_for].some((v) => (v || '').toLowerCase().includes(ql));
  const lists = {
    upcoming: rows.filter((r) => r.status === 'booked'),
    out: rows.filter((r) => r.status === 'delivered'),
    returned: rows.filter((r) => r.status === 'returned').reverse(),
    all: [...rows].reverse(),
  };
  const shown = lists[tab].filter(match);
  const soon = rows.filter((r) => r.status === 'booked' && r.dod >= t && r.dod <= addDays(2));
  const due = rows.filter((r) => r.status === 'delivered' && r.dor <= addDays(1));
  const securityHeld = rows.filter((r) => r.status === 'delivered').reduce((s, r) => s + Number(r.security || 0), 0);

  return (
    <>
      <div className="page-head">
        <h1>Jewellery on Rent</h1>
        <div className="actions"><button className="btn primary" onClick={() => setModal({})}>+ New booking</button></div>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-label">Deliveries in next 2 days</div><div className="stat-value">{soon.length}</div><div className="stat-sub">{soon.map((r) => r.set_code).join(', ') || '—'}</div></div>
        <div className="stat warn"><div className="stat-label">Returns due (today/tomorrow)</div><div className="stat-value">{due.length}</div><div className="stat-sub">{due.map((r) => r.set_code).join(', ') || '—'}</div></div>
        <div className="stat"><div className="stat-label">Sets out with customers</div><div className="stat-value">{lists.out.length}</div><div className="stat-sub">security held {inr(securityHeld)}</div></div>
        <div className="stat"><div className="stat-label">Upcoming bookings</div><div className="stat-value">{lists.upcoming.length}</div></div>
      </div>

      <div className="toolbar">
        <div className="tabs">
          {[['upcoming', 'Upcoming'], ['out', 'Out now'], ['returned', 'Returned'], ['all', 'All']].map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l} ({lists[k].length})</button>
          ))}
        </div>
        <input className="rent-search" placeholder="Search name, mobile, set code, R-no…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <section className="card flush">
        {shown.length === 0 ? <Empty>No bookings here.</Empty> : (
          <table>
            <thead><tr><th>No</th><th>Customer</th><th>Set</th><th>Delivery (DOD)</th><th>Return (DOR)</th><th className="num">Balance</th><th className="num hide-sm">Security</th><th>Status</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="click" onClick={() => setOpenId(r.id)}>
                  <td><b>{rentNo(r)}</b><div className="muted small">{r.booked_for || ''}</div></td>
                  <td><strong>{r.name}</strong><div className="muted small">{r.mob1}</div></td>
                  <td><b>{r.set_code}</b><div className="muted small">{r.colour || ''}</div></td>
                  <td>{d8(r.dod)} <span className="muted small">{t12(r.dod_time)}</span>{r.status === 'booked' && daysTo(r.dod) >= 0 && daysTo(r.dod) <= 2 && <div><Badge tone="amber">{whenLabel(r.dod)}</Badge></div>}</td>
                  <td>{d8(r.dor)} <span className="muted small">{t12(r.dor_time)}</span></td>
                  <td className="num">{inr(rentBalance(r))}</td>
                  <td className="num hide-sm">{inr(r.security)}</td>
                  <td><RentStatus r={r} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

    </>
  );
}

// ---------- one booking: all details ----------
function RentDetail({ r, onBack, onChanged, onDeleted, onEdit }) {
  const [print, setPrint] = useState(false);
  const set = async (patch) => {
    const { error } = await supabase.from('rentals').update(patch).eq('id', r.id);
    if (error) alert(error.message); else onChanged();
  };
  const del = async () => {
    if (!window.confirm(`Delete booking ${rentNo(r)} for ${r.name}? This cannot be undone.`)) return;
    const { error } = await supabase.from('rentals').delete().eq('id', r.id);
    if (error) alert(error.message); else onDeleted();
  };
  const Row = ({ k, v }) => <div className="rd-row"><span>{k}</span><b>{v || '—'}</b></div>;
  return (
    <>
      <button className="btn ghost small" onClick={onBack}>← All bookings</button>
      <div className="page-head">
        <h1>{rentNo(r)} · {r.name} <RentStatus r={r} /></h1>
        <div className="actions">
          <button className="btn" onClick={() => setPrint(true)}>🖨 Print slip</button>
          <button className="btn" onClick={onEdit}>Edit</button>
          {r.status === 'booked' && <button className="btn primary" onClick={() => set({ status: 'delivered', delivered_at: new Date().toISOString() })}>Mark delivered</button>}
          {r.status === 'delivered' && <button className="btn primary" onClick={() => set({ status: 'returned', returned_at: new Date().toISOString() })}>Mark returned</button>}
          {r.status === 'returned' && <button className="btn" onClick={() => set({ status: 'delivered', returned_at: null })}>Undo return</button>}
        </div>
      </div>

      <div className="rent-hero">
        <div><span>Set code</span><b>{r.set_code}</b><small>{r.colour || ''}</small></div>
        <div><span>Delivery (DOD)</span><b>{d8(r.dod)}</b><small>{t12(r.dod_time) || 'time not set'} · {whenLabel(r.dod)}</small></div>
        <div><span>Return (DOR)</span><b>{d8(r.dor)}</b><small>{t12(r.dor_time) || 'time not set'} · {whenLabel(r.dor)}</small></div>
        <div className="bal"><span>Balance</span><b>{inr(rentBalance(r))}</b><small>rate {inr(r.rate)} − advance {inr(r.advance)}</small></div>
      </div>

      <div className="cols">
        <section className="card">
          <h2>Customer</h2>
          <Row k="Name" v={r.name} />
          <Row k="Address" v={r.address} />
          <Row k="Mobile 1" v={r.mob1 && <a href={`tel:${r.mob1}`}>{r.mob1}</a>} />
          <Row k="Mobile 2" v={r.mob2 && <a href={`tel:${r.mob2}`}>{r.mob2}</a>} />
          {r.mob1 && <a className="btn wa-btn small" style={{ marginTop: 8 }} target="_blank" rel="noreferrer"
            href={`https://wa.me/91${r.mob1.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(`Hi ${r.name}, your jewellery booking ${rentNo(r)} (set ${r.set_code}) at Sri Kangna:\nDelivery: ${d8(r.dod)} ${t12(r.dod_time)}\nReturn: ${d8(r.dor)} ${t12(r.dor_time)}\nBalance: ${inr(rentBalance(r))} · Security: ${inr(r.security)}\nThank you!`)}`}>Send details on WhatsApp</a>}
        </section>
        <section className="card">
          <h2>Booking</h2>
          <Row k="Booking no." v={rentNo(r)} />
          <Row k="Date of booking" v={d8(r.book_date)} />
          <Row k="Booked for" v={r.booked_for} />
          <Row k="Set code" v={r.set_code} />
          <Row k="Colour" v={r.colour} />
          <Row k="Note" v={r.note} />
        </section>
      </div>
      <div className="cols">
        <section className="card">
          <h2>Payment</h2>
          <Row k="Rate" v={inr(r.rate)} />
          <Row k="Advance paid" v={inr(r.advance)} />
          <Row k="Balance" v={inr(rentBalance(r))} />
          <Row k="Security deposit (refundable)" v={inr(r.security)} />
        </section>
        <section className="card">
          <h2>Status</h2>
          <Row k="Status" v={<RentStatus r={r} />} />
          <Row k="Delivered at" v={r.delivered_at && new Date(r.delivered_at).toLocaleString('en-IN')} />
          <Row k="Returned at" v={r.returned_at && new Date(r.returned_at).toLocaleString('en-IN')} />
          <div className="actions" style={{ marginTop: 10 }}>
            {r.status !== 'cancelled' ? <button className="link" onClick={() => window.confirm('Cancel this booking?') && set({ status: 'cancelled' })}>Cancel booking</button>
              : <button className="link" onClick={() => set({ status: 'booked' })}>Restore booking</button>}
            <button className="link danger" onClick={del}>Delete</button>
          </div>
        </section>
      </div>

      {print && <RentPrint r={r} onClose={() => setPrint(false)} />}
    </>
  );
}

// ---------- booking page: form on the left, live slip on the right (same as the trial) ----------
function RentEditor({ r, nextNo, onBack, onSaved }) {
  const [vals, setVals] = useState(null);
  const [shop, setShop] = useState(null);
  const [printR, setPrintR] = useState(null);
  useEffect(() => { loadSettings().then(setShop).catch(() => setShop({})); }, []);
  const preview = { ...(r || {}), ...(vals || {}), booking_no: r?.booking_no || nextNo };
  return (
    <>
      <button className="btn ghost small" onClick={onBack}>← All bookings</button>
      <div className="rent-top">
        <img src="/logo.png" alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        <div><h1>{r ? `Edit booking ${rentNo(r)}` : 'New rent booking'}</h1><p>Fill the details — the customer slip updates on the right. Save to print it.</p></div>
      </div>
      <div className="rent-editor">
        <section className="card"><RentForm r={r} onChange={setVals} onCancel={onBack} onSaved={(saved) => setPrintR(saved)} /></section>
        <section className="card rent-preview">
          <h2>Slip preview (80 mm thermal)</h2>
          <div className="rent-preview-paper"><RentSlip r={preview} shop={shop} /></div>
          <p className="muted small">Helett printer · Paper “Receipt / 80 × 3000 mm” · Margins None · untick Headers and footers.</p>
        </section>
      </div>
      {printR && <RentPrint r={printR} autoPrint onClose={() => { const x = printR; setPrintR(null); onSaved(x); }} />}
    </>
  );
}

// ---------- form ----------
function RentForm({ r, onSaved, onCancel, onChange }) {
  const [f, setF] = useState({
    book_date: r?.book_date || today(), booked_for: r?.booked_for || '', name: r?.name || '', address: r?.address || '',
    mob1: r?.mob1 || '', mob2: r?.mob2 || '', set_code: r?.set_code || '', colour: r?.colour || '',
    dod: r?.dod || '', dod_time: r?.dod_time?.slice(0, 5) || '', dor: r?.dor || '', dor_time: r?.dor_time?.slice(0, 5) || '',
    rate: r?.rate ?? '', advance: r?.advance ?? '', security: r?.security ?? '', note: r?.note || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  useEffect(() => { onChange?.(f); }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  const bal = Math.max(0, Number(f.rate || 0) - Number(f.advance || 0));
  const submit = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!f.dod || !f.dor) { setErr({ message: 'Enter the delivery date (DOD) and return date (DOR).' }); return; }
    if (f.dor < f.dod) { setErr({ message: 'Return date cannot be before the delivery date.' }); return; }
    setBusy(true); setErr(null);
    const row = {
      ...f, name: f.name.trim(), set_code: f.set_code.trim().toUpperCase(),
      rate: Number(f.rate || 0), advance: Number(f.advance || 0), security: Number(f.security || 0),
      dod_time: f.dod_time || null, dor_time: f.dor_time || null,
      ...Object.fromEntries(['booked_for', 'address', 'mob2', 'colour', 'note'].map((k) => [k, f[k].trim() || null])),
    };
    const res = r ? await supabase.from('rentals').update(row).eq('id', r.id).select().single() : await supabase.from('rentals').insert(row).select().single();
    setBusy(false);
    if (res.error) setErr(res.error); else onSaved(res.data);
  };
  return (
    <form className="form" onSubmit={submit}>
      <ErrorBox error={err} />
      <div className="rf-sec">Booking</div>
      <div className="grid2">
        <label>Date of booking<DateInput value={f.book_date} onChange={(v) => setF({ ...f, book_date: v })} /></label>
        <label>Booked for<input list="rent-occ" value={f.booked_for} onChange={set('booked_for')} placeholder="e.g. Wedding" /><datalist id="rent-occ">{OCCASIONS.map((o) => <option key={o} value={o} />)}</datalist></label>
      </div>
      <div className="rf-sec">Customer</div>
      <label>Name<input value={f.name} onChange={set('name')} required autoFocus={!r} /></label>
      <label>Address<textarea rows={2} value={f.address} onChange={set('address')} /></label>
      <div className="grid2">
        <label>Mobile no. 1<input value={f.mob1} onChange={set('mob1')} inputMode="numeric" maxLength={10} required /></label>
        <label>Mobile no. 2<input value={f.mob2} onChange={set('mob2')} inputMode="numeric" maxLength={10} /></label>
      </div>
      <div className="rf-sec">Jewellery</div>
      <label>Set code<input value={f.set_code} onChange={(e) => setF({ ...f, set_code: e.target.value.toUpperCase() })} required placeholder="e.g. BR-104" /></label>
      <div className="field"><span className="field-label">Colour {f.colour && <b className="colour-picked">· {f.colour}</b>}</span>
        <ColourPicker value={f.colour} onChange={(c) => setF({ ...f, colour: c })} extra={[r?.colour]} />
      </div>
      <div className="rf-sec">Delivery &amp; return</div>
      <div className="grid2">
        <label>DOD – date of delivery<div className="rf-dt"><DateInput value={f.dod} onChange={(v) => setF({ ...f, dod: v })} required /><input type="time" value={f.dod_time} onChange={set('dod_time')} /></div></label>
        <label>DOR – date of return<div className="rf-dt"><DateInput value={f.dor} onChange={(v) => setF({ ...f, dor: v })} required /><input type="time" value={f.dor_time} onChange={set('dor_time')} /></div></label>
      </div>
      <div className="rf-sec">Payment</div>
      <div className="grid3">
        <label>Rate (₹)<input type="number" min="0" value={f.rate} onChange={set('rate')} required /></label>
        <label>Advance (₹)<input type="number" min="0" value={f.advance} onChange={set('advance')} /></label>
        <label>Security (₹)<input type="number" min="0" value={f.security} onChange={set('security')} /></label>
      </div>
      <div className="rf-bal"><span>Balance to pay</span><b>{inr(bal)}</b></div>
      <label>Note<input value={f.note} onChange={set('note')} placeholder="e.g. with maang tikka and nath" /></label>
      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : r ? 'Update & print slip' : 'Save & print slip'}</button>
      </div>
    </form>
  );
}

// ---------- 80 mm booking slip ----------
function RentPrint({ r, onClose, autoPrint }) {
  const [shop, setShop] = useState(null);
  const shift = useMemo(() => { try { return Number(localStorage.getItem('sk-thermal-shift')) || 0; } catch { return 0; } }, []);
  useEffect(() => { loadSettings().then(setShop).catch(() => setShop({})); }, []);
  useEffect(() => { if (autoPrint && shop) { const t = setTimeout(() => window.print(), 300); return () => clearTimeout(t); } return undefined; }, [autoPrint, shop]);
  return createPortal(
    <div className="print-root">
      <style>{`@page { margin: 0; } @media print { .rent-slip { margin-left: ${shift}mm !important; } }`}</style>
      <div className="print-toolbar no-print">
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()}>Print slip</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      <p className="print-hint no-print">Helett 80 mm · Paper “Receipt / 80 × 3000 mm” · Margins None · untick Headers and footers.</p>
      <RentSlip r={r} shop={shop} />
    </div>,
    document.body
  );
}

export function RentSlip({ r, shop }) {
  return (
      <div className="thermal rent-slip">
      <div className="t-sri">Sri</div>
      {shop?.address && <div className="t-c">{shop.address}</div>}
      {shop?.phone && <div className="t-c">Ph: {shop.phone}</div>}
      <div className="t-title">JEWELLERY ON RENT</div>
      <div className="t-row"><span>Booking no: <b>{rentNo(r)}</b></span><span>{d8(r.book_date)}</span></div>
      {r.booked_for && <div>Booked for: <b>{r.booked_for}</b></div>}
      <div className="t-hr" />
      <div><b>Name:</b> {r.name}</div>
      {r.address && <div><b>Address:</b> {r.address}</div>}
      <div><b>Mobile:</b> {r.mob1}{r.mob2 ? ` / ${r.mob2}` : ''}</div>
      <div className="t-hr" />
      <div className="t-row"><span><b>Set code:</b> {r.set_code}</span><span><b>Colour:</b> {r.colour || '—'}</span></div>
      {r.note && <div><b>Note:</b> {r.note}</div>}
      <div className="rs-box">
        <div className="t-row"><b>Delivery (DOD)</b><span>{d8(r.dod)} {t12(r.dod_time)}</span></div>
        <div className="t-row"><b>Return (DOR)</b><span>{d8(r.dor)} {t12(r.dor_time)}</span></div>
      </div>
      <div className="t-row"><span>Rate</span><span>{inr(r.rate)}</span></div>
      <div className="t-row"><span>Advance paid</span><span>{inr(r.advance)}</span></div>
      <div className="t-total"><span>BALANCE</span><span>{inr(rentBalance(r))}</span></div>
      <div className="t-row"><b>Security deposit (refundable)</b><b>{inr(r.security)}</b></div>
      <div className="t-hr" />
      <div className="t-terms"><b>Terms &amp; Conditions</b><ol>
        <li>Balance and security deposit to be paid at delivery.</li>
        <li>Jewellery must be returned on the return date and time.</li>
        <li>Security is refunded after checking the set on return.</li>
        <li>Any damage or missing piece will be charged.</li>
        <li>Late return will be charged extra per day.</li>
      </ol></div>
      <div className="rs-sign"><div>Customer</div><div>Sri Kangna</div></div>
      <div className="t-c t-foot">Thank you!</div>
    </div>
  );
}
