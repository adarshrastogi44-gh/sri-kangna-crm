import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabase';
import { Badge, DateInput, Empty, ErrorBox, Loading, Modal } from '../components';
import { addDays, ensureCustomer, fetchAll, inr, loadSettings, saveAdvanceBill, today } from '../utils';
import { AdvanceMode, d8, daysTo, t12, whenLabel } from './Rent';

// ---------- Chura booking ----------
export const churaNo = (c) => `C-${String(c.booking_no || 0).padStart(3, '0')}`;
export const churaBalance = (c) => Math.max(0, Number(c.rate || 0) - Number(c.advance || 0));
const STATUS = { booked: ['Booked', 'blue'], ready: ['Ready', 'amber'], delivered: ['Given', 'green'], cancelled: ['Cancelled', 'gray'] };
export const ChuraStatus = ({ c }) => {
  const late = (c.status === 'booked' || c.status === 'ready') && c.give_date && c.give_date < today();
  return <Badge tone={late ? 'red' : STATUS[c.status]?.[1] || 'gray'}>{late ? 'Late' : STATUS[c.status]?.[0] || c.status}</Badge>;
};
const TYPES = ['Bridal chura', 'Punjabi chura', 'Rajasthani chura', 'Lac chura', 'Glass chura', 'Kundan chura', 'Red & white chura', 'Designer chura'];
const SIZES = ['2.2', '2.4', '2.6', '2.8', '2.10', '2.12'];
const TYPE_KEY = 'sk-chura-types';
const savedTypes = () => { try { return JSON.parse(localStorage.getItem(TYPE_KEY) || '[]'); } catch { return []; } };

function TypePicker({ value, onChange }) {
  const [mine, setMine] = useState(savedTypes);
  const [adding, setAdding] = useState(false);
  const [txt, setTxt] = useState('');
  const all = [...new Set([...TYPES, ...mine, ...(value ? [value] : [])])];
  const add = () => {
    const t = txt.trim();
    if (t) {
      const next = all.some((x) => x.toLowerCase() === t.toLowerCase()) ? mine : [...mine, t];
      setMine(next); try { localStorage.setItem(TYPE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      onChange(all.find((x) => x.toLowerCase() === t.toLowerCase()) || t);
    }
    setTxt(''); setAdding(false);
  };
  return (
    <div className="colour-pick">
      {all.map((t) => <button type="button" key={t} className={`chip ${value === t ? 'on' : ''}`} onClick={() => onChange(value === t ? '' : t)}>{t}</button>)}
      {adding ? (
        <span className="colour-add">
          <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="New chura type"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } if (e.key === 'Escape') setAdding(false); }} />
          <button type="button" className="btn small primary" onClick={add}>Add</button>
        </span>
      ) : <button type="button" className="chip add-chip" onClick={() => setAdding(true)}>+ Add type</button>}
    </div>
  );
}

export default function Chura({ user }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState('upcoming');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [openId, setOpenId] = useState(null);
  useEffect(() => {
    fetchAll(() => supabase.from('chura_bookings').select('*').order('give_date', { ascending: true })).then(setRows).catch(setErr);
  }, [tick]);
  const refresh = () => setTick((t) => t + 1);

  const missing = err && /chura/.test(err.message || '') && /(does not exist|schema cache|not find)/i.test(err.message || '');
  if (missing) {
    return <div className="card"><h2>One-time setup needed</h2><p>Open <b>Supabase → SQL Editor</b>, paste the contents of <code>booking-setup.sql</code> and click <b>Run</b>. Then refresh this page.</p></div>;
  }
  if (err) return <ErrorBox error={err} />;
  if (!rows) return <Loading />;

  const open = openId && rows.find((x) => x.id === openId);
  const t = today();
  const ql = q.trim().toLowerCase();
  const match = (c) => !ql || [c.name, c.mobile, c.chura_type, c.size, churaNo(c)].some((v) => (v || '').toLowerCase().includes(ql));
  const lists = {
    upcoming: rows.filter((c) => c.status === 'booked' || c.status === 'ready'),
    delivered: rows.filter((c) => c.status === 'delivered').reverse(),
    all: [...rows].reverse(),
  };
  const shown = lists[tab].filter(match);
  const soon = lists.upcoming.filter((c) => c.give_date && c.give_date >= t && c.give_date <= addDays(2));
  const late = lists.upcoming.filter((c) => c.give_date && c.give_date < t);

  return (
    <>
      <div className="page-head">
        <h1>Chura booking</h1>
        <div className="actions"><button className="btn primary" onClick={() => setModal({})}>+ New chura booking</button></div>
      </div>
      <div className="stats">
        <div className="stat"><div className="stat-label">To give in next 2 days</div><div className="stat-value">{soon.length}</div><div className="stat-sub">{soon.map((c) => c.name).join(', ') || '—'}</div></div>
        <div className={`stat ${late.length ? 'warn' : ''}`}><div className="stat-label">Late (date passed)</div><div className="stat-value">{late.length}</div></div>
        <div className="stat"><div className="stat-label">Ready to give</div><div className="stat-value">{rows.filter((c) => c.status === 'ready').length}</div></div>
        <div className="stat"><div className="stat-label">Open orders</div><div className="stat-value">{lists.upcoming.length}</div><div className="stat-sub">balance to collect {inr(lists.upcoming.reduce((s, c) => s + churaBalance(c), 0))}</div></div>
      </div>
      <div className="toolbar">
        <div className="tabs">
          {[['upcoming', 'Open orders'], ['delivered', 'Given'], ['all', 'All']].map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l} ({lists[k].length})</button>
          ))}
        </div>
        <input className="rent-search" placeholder="Search name, mobile, type, size, C-no…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <section className="card flush">
        {shown.length === 0 ? <Empty>No chura bookings here.</Empty> : (
          <table>
            <thead><tr><th>No</th><th>Customer</th><th>Chura</th><th>Order taken</th><th>Date of giving</th><th className="num">Balance</th><th>Status</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="click" onClick={() => setOpenId(c.id)}>
                  <td><b>{churaNo(c)}</b></td>
                  <td><strong>{c.name}</strong><div className="muted small">{c.mobile}</div></td>
                  <td><b>{c.chura_type || '—'}</b><div className="muted small">Size {c.size || '—'}</div></td>
                  <td>{d8(c.order_date)}</td>
                  <td>{d8(c.give_date)} <span className="muted small">{t12(c.give_time)}</span>{(c.status === 'booked' || c.status === 'ready') && c.give_date && daysTo(c.give_date) >= 0 && daysTo(c.give_date) <= 2 && <div><Badge tone="amber">{whenLabel(c.give_date)}</Badge></div>}</td>
                  <td className="num">{inr(churaBalance(c))}</td>
                  <td><ChuraStatus c={c} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {modal && (
        <Modal title={modal.id ? `Edit chura booking ${churaNo(modal)}` : 'New chura booking'} onClose={() => setModal(null)}>
          <ChuraForm c={modal.id ? modal : null} user={user} onCancel={() => setModal(null)} onSaved={(saved) => { setModal(null); refresh(); if (saved?.id) setOpenId(saved.id); }} />
        </Modal>
      )}
      {open && !modal && <ChuraDetail c={open} onClose={() => setOpenId(null)} onEdit={() => setModal(open)} onChanged={refresh} onDeleted={() => { setOpenId(null); refresh(); }} />}
    </>
  );
}

function ChuraDetail({ c, onClose, onEdit, onChanged, onDeleted }) {
  const [print, setPrint] = useState(false);
  const set = async (patch) => {
    const { error } = await supabase.from('chura_bookings').update(patch).eq('id', c.id);
    if (error) alert(error.message); else onChanged();
  };
  const del = async () => {
    if (!window.confirm(`Delete chura booking ${churaNo(c)} for ${c.name}? (The advance bill stays in Bills.)`)) return;
    const { error } = await supabase.from('chura_bookings').delete().eq('id', c.id);
    if (error) alert(error.message); else onDeleted();
  };
  const Row = ({ k, v }) => <div className="rd-row"><span>{k}</span><b>{v || '—'}</b></div>;
  const m = (c.mobile || '').replace(/\D/g, '').slice(-10);
  const wa = m && `https://wa.me/91${m}?text=${encodeURIComponent(`Hi ${c.name}, your chura booking ${churaNo(c)} at Sri Kangna:\nChura: ${c.chura_type || ''} · Size ${c.size || ''}\nDate of giving: ${d8(c.give_date)} ${t12(c.give_time)}\nBalance: ${inr(churaBalance(c))}\nThank you!`)}`;
  return (
    <Modal title={`${churaNo(c)} · ${c.name}`} onClose={onClose}>
      <div className="form">
        <div><ChuraStatus c={c} /></div>
        <Row k="Mobile" v={c.mobile && <a href={`tel:${c.mobile}`}>{c.mobile}</a>} />
        <Row k="Type of chura" v={c.chura_type} />
        <Row k="Size" v={c.size} />
        {c.colour && <Row k="Colour" v={c.colour} />}
        <Row k="Date of taking order" v={d8(c.order_date)} />
        <Row k="Date of giving" v={c.give_date && `${d8(c.give_date)} ${t12(c.give_time)} · ${whenLabel(c.give_date)}`} />
        <Row k="Rate" v={inr(c.rate)} />
        <Row k="Advance" v={`${inr(c.advance)}${Number(c.advance) > 0 ? ` · ${c.adv_mode === 'upi' ? 'UPI' : 'Cash'}` : ''}`} />
        <Row k="Balance" v={inr(churaBalance(c))} />
        {c.note && <Row k="Note" v={c.note} />}
        {c.delivered_at && <Row k="Given on" v={new Date(c.delivered_at).toLocaleString('en-IN')} />}
        <div className="actions" style={{ flexWrap: 'wrap' }}>
          {c.status === 'booked' && <button className="btn" onClick={() => set({ status: 'ready' })}>Mark ready</button>}
          {(c.status === 'booked' || c.status === 'ready') && <button className="btn primary" onClick={() => set({ status: 'delivered', delivered_at: new Date().toISOString() })}>Mark given to customer</button>}
          {c.status === 'delivered' && <button className="btn" onClick={() => set({ status: 'ready', delivered_at: null })}>Undo given</button>}
          <button className="btn" onClick={() => setPrint(true)}>🖨 Print slip</button>
          {wa && <a className="btn wa-btn" target="_blank" rel="noreferrer" href={wa}>WhatsApp</a>}
          <button className="btn" onClick={onEdit}>Edit</button>
        </div>
        <div className="actions">
          {c.status !== 'cancelled'
            ? <button className="link" onClick={() => window.confirm('Cancel this booking?') && set({ status: 'cancelled' })}>Cancel booking</button>
            : <button className="link" onClick={() => set({ status: 'booked' })}>Restore booking</button>}
          <button className="link danger" onClick={del}>Delete</button>
        </div>
      </div>
      {print && <ChuraPrint c={c} onClose={() => setPrint(false)} />}
    </Modal>
  );
}

function ChuraForm({ c, user, onSaved, onCancel }) {
  const [f, setF] = useState({
    order_date: c?.order_date || today(), name: c?.name || '', mobile: c?.mobile || '', size: c?.size || '',
    chura_type: c?.chura_type || '', colour: c?.colour || '', give_date: c?.give_date || '', give_time: c?.give_time?.slice(0, 5) || '',
    rate: c?.rate ?? '', advance: c?.advance ?? '', note: c?.note || '',
  });
  const [advMode, setAdvMode] = useState(c?.adv_mode || 'cash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const bal = Math.max(0, Number(f.rate || 0) - Number(f.advance || 0));
  const submit = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!f.give_date) { setErr({ message: 'Enter the date of giving.' }); return; }
    if (f.give_date < f.order_date) { setErr({ message: 'Date of giving cannot be before the order date.' }); return; }
    setBusy(true); setErr(null);
    try {
      const row = {
        order_date: f.order_date || today(), name: f.name.trim(), mobile: f.mobile.trim(), size: f.size.trim() || null,
        chura_type: f.chura_type || null, colour: f.colour.trim() || null, give_date: f.give_date, give_time: f.give_time || null,
        rate: Number(f.rate || 0), advance: Number(f.advance || 0), adv_mode: advMode, note: f.note.trim() || null,
      };
      const cust = await ensureCustomer({ name: row.name, phone: row.mobile, note: 'From chura booking' });
      row.customer_id = cust?.id || c?.customer_id || null;
      if (!c) row.status = 'booked';
      const res = c
        ? await supabase.from('chura_bookings').update(row).eq('id', c.id).select().single()
        : await supabase.from('chura_bookings').insert(row).select().single();
      if (res.error) throw res.error;
      let saved = res.data;
      if (row.advance > 0 || saved.bill_id) {
        const billId = await saveAdvanceBill({
          billId: saved.bill_id, customerId: row.customer_id, date: row.order_date,
          label: `Chura booking advance ${churaNo(saved)} - ${row.chura_type || 'chura'} size ${row.size || '-'}`,
          amount: row.advance, mode: advMode, userId: user?.id,
        });
        if (billId && billId !== saved.bill_id) {
          const u = await supabase.from('chura_bookings').update({ bill_id: billId }).eq('id', saved.id).select().single();
          if (!u.error) saved = u.data;
        }
      }
      setBusy(false);
      onSaved(saved);
    } catch (x) { setBusy(false); setErr(x); }
  };
  return (
    <form className="form" onSubmit={submit}>
      <ErrorBox error={err} />
      <div className="grid2">
        <label>Name<input value={f.name} onChange={set('name')} required autoFocus={!c} /></label>
        <label>Mobile number<input value={f.mobile} onChange={set('mobile')} inputMode="numeric" maxLength={10} required /></label>
      </div>
      <div className="field"><span className="field-label">Type of chura {f.chura_type && <b className="colour-picked">· {f.chura_type}</b>}</span>
        <TypePicker value={f.chura_type} onChange={(v) => setF({ ...f, chura_type: v })} />
      </div>
      <div className="field"><span className="field-label">Size</span>
        <div className="colour-pick">
          {SIZES.map((sz) => <button type="button" key={sz} className={`chip ${f.size === sz ? 'on' : ''}`} onClick={() => setF({ ...f, size: f.size === sz ? '' : sz })}>{sz}</button>)}
          <input className="size-in" value={SIZES.includes(f.size) ? '' : f.size} onChange={set('size')} placeholder="other size" />
        </div>
      </div>
      <label>Colour / design (optional)<input value={f.colour} onChange={set('colour')} placeholder="e.g. Red with golden kundan" /></label>
      <div className="grid2">
        <label>Date of taking order<DateInput value={f.order_date} onChange={(v) => setF({ ...f, order_date: v })} /></label>
        <label>Date of giving<div className="rf-dt"><DateInput value={f.give_date} onChange={(v) => setF({ ...f, give_date: v })} required /><input type="time" value={f.give_time} onChange={set('give_time')} /></div></label>
      </div>
      <div className="grid2">
        <label>Rate (₹)<input type="number" min="0" value={f.rate} onChange={set('rate')} /></label>
        <label>Advance (₹)<input type="number" min="0" value={f.advance} onChange={set('advance')} /></label>
      </div>
      {Number(f.advance) > 0 && <AdvanceMode value={advMode} onChange={setAdvMode} />}
      <div className="rf-bal"><span>Balance to pay</span><b>{inr(bal)}</b></div>
      <label>Note<input value={f.note} onChange={set('note')} placeholder="e.g. with kaleere" /></label>
      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : c ? 'Update booking' : 'Save booking'}</button>
      </div>
    </form>
  );
}

function ChuraPrint({ c, onClose }) {
  const [shop, setShop] = useState(null);
  const shift = useMemo(() => { try { return Number(localStorage.getItem('sk-thermal-shift')) || 0; } catch { return 0; } }, []);
  useEffect(() => { loadSettings().then(setShop).catch(() => setShop({})); }, []);
  return createPortal(
    <div className="print-root">
      <style>{`@page { margin: 0; } @media print { .rent-slip { margin-left: ${shift}mm !important; } }`}</style>
      <div className="print-toolbar no-print">
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()}>Print slip</button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      <div className="thermal rent-slip">
        <div className="t-sri">Sri</div>
        {shop?.address && <div className="t-c">{shop.address}</div>}
        {shop?.phone && <div className="t-c">Ph: {shop.phone}</div>}
        <div className="t-title">CHURA BOOKING</div>
        <div className="t-row"><span>Booking no: <b>{churaNo(c)}</b></span><span>{d8(c.order_date)}</span></div>
        <div className="t-hr" />
        <div><b>Name:</b> {c.name}</div>
        <div><b>Mobile:</b> {c.mobile}</div>
        <div className="t-hr" />
        <div className="t-row"><span><b>Chura:</b> {c.chura_type || '—'}</span><span><b>Size:</b> {c.size || '—'}</span></div>
        {c.colour && <div><b>Colour:</b> {c.colour}</div>}
        {c.note && <div><b>Note:</b> {c.note}</div>}
        <div className="rs-box"><div className="t-row"><b>Date of giving</b><span>{d8(c.give_date)} {t12(c.give_time)}</span></div></div>
        <div className="t-row"><span>Rate</span><span>{inr(c.rate)}</span></div>
        <div className="t-row"><span>Advance paid</span><span>{inr(c.advance)}</span></div>
        <div className="t-total"><span>BALANCE</span><span>{inr(churaBalance(c))}</span></div>
        <div className="t-hr" />
        <div className="rs-sign"><div>Customer</div><div>Sri Kangna</div></div>
        <div className="t-c t-foot">Thank you!</div>
      </div>
    </div>,
    document.body
  );
}
