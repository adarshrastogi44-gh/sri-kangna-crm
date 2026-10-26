import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { BillForm, DateInput, DeleteBillModal, ShareBill, Empty, ErrorBox, Loading, Modal, MonthPicker, PrintBill, PrintSheet, StatusBadge } from '../components';
import { billNo, customerMap, dueOf, fetchAll, fmtDate, inr, itemsSummary, monthKey, monthLabel, monthRange, today } from '../utils';

const shiftDay = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const dayName = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' });

export default function Bills({ user, openCustomer }) {
  const [view, setView] = useState('day');
  const [day, setDay] = useState(today());
  const [monthSel, setMonth] = useState(monthKey());
  const month = view === 'day' ? day.slice(0, 7) : monthSel;
  const [filter, setFilter] = useState('all');
  // Search box: finds bills of ALL dates by amount (1500 or 1,500), customer name, mobile, item or bill number
  const [q, setQ] = useState('');
  const [allBills, setAllBills] = useState(null);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  const [tick, setTick] = useState(0);
  const [sel, setSel] = useState([]);

  useEffect(() => {
    setRows(null);
    (async () => {
      try {
        const [ms, me] = monthRange(month);
        const [bills, cmap] = await Promise.all([
          fetchAll(() => supabase.from('bills').select('*').gte('bill_date', ms).lt('bill_date', me).order('bill_date', { ascending: false })),
          customerMap(),
        ]);
        setRows(bills.map((b) => ({ ...b, c: cmap[b.customer_id] })));
        setSel([]);
      } catch (e) { setErr(e); }
    })();
  }, [month, tick]);

  const done = () => { setModal(null); setTick((t) => t + 1); setAllBills(null); };
  const query = q.trim().toLowerCase();
  const searching = query.length > 0;
  useEffect(() => {
    if (!searching || allBills) return;
    let alive = true;
    Promise.all([fetchAll(() => supabase.from('bills').select('*').order('bill_date', { ascending: false })), customerMap()])
      .then(([bills, cmap]) => { if (alive) setAllBills(bills.map((b) => ({ ...b, c: cmap[b.customer_id] }))); })
      .catch((e) => setErr(e));
    return () => { alive = false; };
  }, [searching, allBills]);
  const digits = query.replace(/[₹,\s]/g, '');
  const isNum = /^\d+(\.\d+)?$/.test(digits);
  const plain = (n) => String(Math.round(Number(n || 0) * 100) / 100);
  // A number finds ONLY bills where that exact amount appears: bill amount, paid, due, cash part or UPI part
  // (5+ digits also match a customer's mobile number)
  const matches = (b) => {
    if (isNum) {
      const paidAmt = Number(b.paid_amount || 0);
      const nums = [b.amount, paidAmt, dueOf(b)];
      if (b.pay_mode === 'split') nums.push(b.cash_part, Math.max(0, paidAmt - Number(b.cash_part || 0)));
      if (nums.filter((x) => x != null && Number(x) > 0).map(plain).includes(plain(digits))) return true;
      return digits.length >= 5 && (b.c?.phone || '').replace(/\D/g, '').includes(digits);
    }
    return [b.c?.name, b.c?.phone, b.items, billNo(b), b.notes].some((t) => (t || '').toLowerCase().includes(query));
  };
  const exact = (b) => isNum && plain(b.amount) === digits;
  const found = searching && allBills ? allBills.filter(matches).sort((a, b) => exact(b) - exact(a) || b.bill_date.localeCompare(a.bill_date)) : [];
  // Day view: first customer of the day on top, last customer at the bottom
  const seq = (b) => b.created_at || '';
  const inView = rows ? (view === 'day' ? rows.filter((b) => b.bill_date === day).sort((a, b) => seq(a).localeCompare(seq(b)) || Number(a.bill_no || 0) - Number(b.bill_no || 0)) : rows) : [];
  const shown = searching ? found : inView.filter((b) => filter === 'all' || (filter === 'due' ? dueOf(b) > 0 : b.payment_status === 'paid'));
  const dayRows = rows && view === 'month' ? Object.entries(rows.reduce((g, b) => { const k = b.bill_date; (g[k] ||= { n: 0, total: 0, paid: 0, due: 0 }); g[k].n += 1; g[k].total += Number(b.amount || 0); g[k].paid += Number(b.paid_amount || 0); g[k].due += dueOf(b); return g; }, {})).sort((a, b) => b[0].localeCompare(a[0])) : [];
  const openDay = (d) => { setDay(d); setView('day'); };
  const sum = (k) => shown.reduce((s, b) => s + Number(b[k] || 0), 0);
  // Cash / UPI / Card split of money collected (old bills without a mode count as cash)
  const paidOf = (b) => Number(b.paid_amount || 0);
  const cashOf = (b) => (b.pay_mode === 'split' ? Math.min(paidOf(b), Number(b.cash_part || 0)) : !b.pay_mode || b.pay_mode === 'cash' ? paidOf(b) : 0);
  const cashIn = shown.reduce((t, b) => t + cashOf(b), 0);
  const cardIn = shown.filter((b) => b.pay_mode === 'card').reduce((t, b) => t + paidOf(b), 0);
  const upiIn = shown.reduce((t, b) => t + paidOf(b), 0) - cashIn - cardIn;

  return (
    <>
      <div className="page-head">
        <h1>Bills</h1>
        <div className="actions">
          <div className="tabs">
            <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>Day</button>
            <button className={view === 'month' ? 'active' : ''} onClick={() => { setMonth(day.slice(0, 7)); setView('month'); }}>Month</button>
          </div>
          {view === 'day' ? (
            <div className="day-pick">
              <button className="btn small" onClick={() => setDay(shiftDay(day, -1))} title="Previous day">◀</button>
              <DateInput value={day} onChange={(v) => v && setDay(v)} />
              <button className="btn small" onClick={() => setDay(shiftDay(day, 1))} disabled={day >= today()} title="Next day">▶</button>
              {day !== today() && <button className="btn small" onClick={() => setDay(today())}>Today</button>}
            </div>
          ) : <MonthPicker value={monthSel} onChange={setMonth} />}
          <div className="bill-search">
            <input type="search" placeholder="🔍 Find bill: amount, name, mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All bills</option>
            <option value="due">With dues</option>
            <option value="paid">Fully paid</option>
          </select>
          <button className="btn" disabled={!sel.length} onClick={() => setModal({ sheet: shown.filter((b) => sel.includes(b.id)) })} title="Tick bills below, then print them 4 per A4 sheet">🖨 Print 4 per A4{sel.length ? ` (${sel.length})` : ''}</button>
          <button className="btn primary" onClick={() => setModal('new')}>+ New bill</button>
        </div>
      </div>
      <ErrorBox error={err} />
      {searching ? (
        !allBills ? <Loading /> : (
          <>
            <h2 className="bills-h">🔍 {found.length} bill{found.length === 1 ? '' : 's'} found for “{q.trim()}” <span className="muted small">— all dates{isNum ? ' · matching bill amount, paid or due' : ''}</span></h2>
            <BillTable shown={shown} sel={sel} setSel={setSel} openCustomer={openCustomer} setModal={setModal} hit={exact} />
          </>
        )
      ) : !rows ? <Loading /> : (
        <>
          <div className="stats day-stats">
            <div className="stat day-total"><div className="stat-label">{view === 'day' ? `Sale · ${day === today() ? 'Today' : fmtDate(day)} (${dayName(day)})` : `Sale · ${monthLabel(month)}`}</div><div className="stat-value">{inr(sum('amount'))}</div><div className="stat-sub">{shown.length} bill{shown.length === 1 ? '' : 's'}{shown.length ? ` · avg ${inr(Math.round(sum('amount') / shown.length))}` : ''}</div></div>
            <div className="stat"><div className="stat-label">Collected</div><div className="stat-value">{inr(sum('paid_amount'))}</div><div className="stat-sub">💵 Cash {inr(cashIn)} · 📱 UPI {inr(upiIn)}{cardIn ? ` · 💳 Card ${inr(cardIn)}` : ''}</div></div>
            <div className={`stat ${shown.some((b) => dueOf(b) > 0) ? 'warn' : ''}`}><div className="stat-label">Due</div><div className="stat-value">{inr(shown.reduce((t, b) => t + dueOf(b), 0))}</div></div>
            <div className="stat"><div className="stat-label">Customers</div><div className="stat-value">{new Set(shown.map((b) => b.customer_id)).size}</div></div>
          </div>
          {view === 'month' && dayRows.length > 0 && (
            <section className="card flush">
              <h2 className="pad">Day-wise sale · {monthLabel(month)} <span className="muted small">— click a day to see its bills</span></h2>
              <table>
                <thead><tr><th>Date</th><th className="num">Bills</th><th className="num">Total sale</th><th className="num">Collected</th><th className="num">Due</th></tr></thead>
                <tbody>
                  {dayRows.map(([d, v]) => (
                    <tr key={d} className="click" onClick={() => openDay(d)}>
                      <td><b>{fmtDate(d)}</b> <span className="muted small">{dayName(d)}</span></td>
                      <td className="num">{v.n}</td><td className="num"><b>{inr(v.total)}</b></td><td className="num">{inr(v.paid)}</td><td className="num">{v.due ? inr(v.due) : '—'}</td>
                    </tr>
                  ))}
                  <tr className="total-row"><td><b>Month total</b></td><td className="num">{rows.length}</td><td className="num"><b>{inr(rows.reduce((t, b) => t + Number(b.amount || 0), 0))}</b></td><td className="num">{inr(rows.reduce((t, b) => t + Number(b.paid_amount || 0), 0))}</td><td className="num">{inr(rows.reduce((t, b) => t + dueOf(b), 0))}</td></tr>
                </tbody>
              </table>
            </section>
          )}
          {view === 'month' && <h2 className="bills-h">All bills · {monthLabel(month)}</h2>}
          <BillTable shown={shown} sel={sel} setSel={setSel} openCustomer={openCustomer} setModal={setModal} />
        </>
      )}
      {modal === 'new' && <Modal title="New bill" onClose={() => setModal(null)}><BillForm user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
      {modal?.del && <DeleteBillModal key={modal.del.id} bill={modal.del} customerName={modal.del.c?.name} onDeleted={done} onClose={() => setModal(null)} />}
      {modal?.sheet && <PrintSheet bills={modal.sheet} onClose={() => setModal(null)} />}
      {modal?.print && <PrintBill bill={modal.print} onClose={() => setModal(null)} />}
      {modal?.bill && <Modal title={`Edit bill · ${modal.bill.c?.name || ''}`} onClose={() => setModal(null)}><BillForm bill={modal.bill} user={user} onSaved={done} onCancel={() => setModal(null)} /></Modal>}
    </>
  );
}

function BillTable({ shown, sel, setSel, openCustomer, setModal, hit }) {
  return (
          <section className="card flush">
      {shown.length === 0 ? <Empty>No bills to show.</Empty> : (
        <table>
          <thead><tr><th className="pick"><input type="checkbox" title="Select all" checked={shown.length > 0 && shown.every((b) => sel.includes(b.id))} onChange={(e) => setSel(e.target.checked ? shown.map((b) => b.id) : [])} /></th><th>Date</th><th>Customer</th><th className="hide-sm">Items</th><th className="num">Amount</th><th className="num hide-sm">Paid</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {shown.map((b) => (
              <tr key={b.id} className={hit && hit(b) ? 'search-hit' : ''}>
                <td className="pick"><input type="checkbox" checked={sel.includes(b.id)} onChange={() => setSel((x) => (x.includes(b.id) ? x.filter((i) => i !== b.id) : [...x, b.id]))} /></td>
                <td>{fmtDate(b.bill_date)}</td>
                <td><button className="link strong" onClick={() => openCustomer(b.customer_id)}>{b.c?.name || 'Unknown'}</button></td>
                <td className="hide-sm"><span className="muted small">{billNo(b)}</span> {itemsSummary(b.items) || '—'}</td>
                <td className="num">{inr(b.amount)}</td>
                <td className="num hide-sm">{inr(b.paid_amount)}{b.pay_mode === 'split'
                  ? <div className="muted small">💵 {inr(b.cash_part)} + 📱 {inr(Math.max(0, Number(b.paid_amount || 0) - Number(b.cash_part || 0)))}</div>
                  : b.pay_mode && b.pay_mode !== 'cash' ? <div className="muted small">{b.pay_mode === 'upi' ? '📱 UPI' : '💳 Card'}</div> : null}</td>
                <td><StatusBadge status={b.payment_status} /></td>
                <td className="row-actions">
                  <button className="link" onClick={() => setModal({ print: b })}>Print</button>
                  <span className="row-wa"><ShareBill bill={b} customer={b.c} small /></span>
                  <button className="link" onClick={() => setModal({ bill: b })}>Edit</button>
                  <button className="link danger" onClick={() => setModal({ del: b })}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
