import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { DateInput, Empty, ErrorBox, Loading } from '../components';
import { fetchAll, fmtDate, inr, today } from '../utils';

const shiftDay = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const startTs = (d) => new Date(`${d}T00:00:00`).toISOString();
const tm = (ts) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
// Cash part of a bill's payment: "Cash + UPI" bills use cash_part when given, otherwise nothing is assumed
const cashOfBill = (b) => {
  const mode = b.pay_mode || 'cash';
  if (mode === 'cash') return Number(b.paid_amount || 0);
  if (mode === 'split') return Number(b.cash_part || 0);
  return 0;
};

export default function CashCounter() {
  const [day, setDay] = useState(today());
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const [opening, setOpening] = useState('');
  const [counted, setCounted] = useState('');
  const [saving, setSaving] = useState(false);
  const [setupNeeded, setSetupNeeded] = useState(false);

  useEffect(() => {
    setD(null); setErr(null);
    const next = shiftDay(day, 1);
    (async () => {
      try {
        const [bills, exps, pentries, cday, prev] = await Promise.all([
          fetchAll(() => supabase.from('bills').select('*').eq('bill_date', day), { fresh: true }),
          fetchAll(() => supabase.from('expenses').select('*').gte('entry_at', startTs(day)).lt('entry_at', startTs(next)), { fresh: true }),
          supabase.from('party_entries').select('*').eq('kind', 'payment').eq('mode', 'cash').gte('entry_at', startTs(day)).lt('entry_at', startTs(next)).then(({ data }) => data || [], () => []),
          supabase.from('cash_days').select('*').eq('day', day).maybeSingle(),
          supabase.from('cash_days').select('*').lt('day', day).order('day', { ascending: false }).limit(1).maybeSingle(),
        ]);
        const missing = cday.error && /cash_days/.test(cday.error.message || '');
        setSetupNeeded(Boolean(missing));
        setD({ bills, exps, pentries, saved: cday.data, prev: prev.data });
        setOpening(cday.data ? String(cday.data.opening) : '');
        setCounted(cday.data?.counted != null ? String(cday.data.counted) : '');
      } catch (e) { setErr(e); }
    })();
  }, [day, tick]);

  if (err) return <ErrorBox error={err} />;
  if (!d) return <Loading />;

  const sum = (list, f = (x) => Number(x.amount || 0)) => list.reduce((t, x) => t + f(x), 0);
  const cashSales = sum(d.bills, cashOfBill);
  const upiSales = sum(d.bills.filter((b) => ['upi', 'card'].includes(b.pay_mode)), (b) => Number(b.paid_amount || 0)) + sum(d.bills.filter((b) => b.pay_mode === 'split'), (b) => Number(b.paid_amount || 0) - Number(b.cash_part || 0));
  const cashExp = d.exps.filter((e) => e.kind === 'expense' && (e.mode || 'cash') === 'cash');
  const deposits = d.exps.filter((e) => e.kind === 'deposit' && !e.party_entry_id);
  const partyDeposits = d.exps.filter((e) => e.kind === 'deposit' && e.party_entry_id);
  const taken = d.exps.filter((e) => e.kind === 'withdrawal');
  const partyCash = d.pentries;
  const out = [
    ['Cash expenses (shop + home)', cashExp],
    ['Deposited in bank', deposits],
    ['Deposited in party accounts', partyDeposits],
    ['Cash taken from counter', taken],
    ['Cash paid to parties', partyCash],
  ];
  const totalOut = out.reduce((t, [, l]) => t + sum(l), 0);
  const open = Number(opening || 0);
  const expected = open + cashSales - totalOut;
  const diff = counted === '' ? null : Number(counted) - expected;

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('cash_days').upsert({ day, opening: open, counted: counted === '' ? null : Number(counted), updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) alert(/cash_days/.test(error.message) ? 'One-time setup needed: run cash-counter-setup.sql in Supabase → SQL Editor.' : error.message);
    else setTick((t) => t + 1);
  };
  const prevClose = d.prev ? (d.prev.counted ?? null) : null;

  return (
    <>
      <div className="page-head">
        <h1>💵 Cash counter</h1>
        <div className="actions day-pick">
          <button className="btn small" onClick={() => setDay(shiftDay(day, -1))}>◀</button>
          <DateInput value={day} onChange={(v) => v && setDay(v)} />
          <button className="btn small" onClick={() => setDay(shiftDay(day, 1))} disabled={day >= today()}>▶</button>
          {day !== today() && <button className="btn small" onClick={() => setDay(today())}>Today</button>}
        </div>
      </div>
      {setupNeeded && <div className="notice warn-notice">One-time setup: run <code>cash-counter-setup.sql</code> in Supabase → SQL Editor so the CRM can save the opening cash and payment mode (Cash / UPI) on bills.</div>}

      <div className="cash-hero">
        <div><span>Opening cash</span><b>{inr(open)}</b></div>
        <div className="plus"><span>+ Cash sales</span><b>{inr(cashSales)}</b></div>
        <div className="minus"><span>− Cash out</span><b>{inr(totalOut)}</b></div>
        <div className="eq"><span>= Cash in counter</span><b>{inr(expected)}</b></div>
      </div>

      <div className="cols">
        <section className="card">
          <h2>Opening &amp; closing · {day === today() ? 'Today' : fmtDate(day)}</h2>
          <label className="cash-field">Opening cash in counter (₹)
            <input type="number" min="0" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="Count the cash when you open" />
          </label>
          {prevClose != null && opening === '' && <button className="link small" onClick={() => setOpening(String(prevClose))}>Use last closing cash ({inr(prevClose)} on {fmtDate(d.prev.day)})</button>}
          <label className="cash-field">Cash counted at closing (₹) <span className="muted small">— optional</span>
            <input type="number" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="Count the cash before closing" />
          </label>
          {diff != null && (
            <div className={`cash-diff ${Math.abs(diff) < 1 ? 'ok' : diff > 0 ? 'more' : 'less'}`}>
              {Math.abs(diff) < 1 ? '✓ Cash matches exactly' : diff > 0 ? `${inr(diff)} MORE than expected` : `${inr(-diff)} SHORT — check entries`}
            </div>
          )}
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </section>
        <section className="card">
          <h2>Sales today</h2>
          <div className="rd-row"><span>Bills</span><b>{d.bills.length}</b></div>
          <div className="rd-row"><span>Total sale</span><b>{inr(sum(d.bills))}</b></div>
          <div className="rd-row"><span>💵 Received in cash</span><b>{inr(cashSales)}</b></div>
          <div className="rd-row"><span>📱 Received by UPI / card</span><b>{inr(upiSales)}</b></div>
          <div className="rd-row"><span>Not yet paid (due)</span><b>{inr(sum(d.bills, (b) => Math.max(0, Number(b.amount || 0) - Number(b.paid_amount || 0))))}</b></div>
          <p className="muted small">Bills with no payment mode are counted as cash.</p>
        </section>
      </div>

      <section className="card flush">
        <h2 className="pad">Cash that went out</h2>
        {totalOut === 0 ? <Empty>No cash went out on this day.</Empty> : (
          <table>
            <thead><tr><th>Time</th><th>Type</th><th>Details</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {out.flatMap(([label, list]) => list.map((e) => (
                <tr key={label + e.id}>
                  <td>{tm(e.entry_at)}</td><td>{label}</td>
                  <td>{e.category || e.note || ''}{e.person ? ` · ${e.person}` : ''}</td>
                  <td className="num">{inr(e.amount)}</td>
                </tr>
              )))}
              <tr className="total-row"><td colSpan="3"><b>Total cash out</b></td><td className="num"><b>{inr(totalOut)}</b></td></tr>
            </tbody>
          </table>
        )}
      </section>
      <p className="muted small">Cash in counter = opening cash + cash sales − cash expenses − bank deposits − cash taken − cash paid to parties. Expenses paid by UPI / card / bank are not counted.</p>
    </>
  );
}
