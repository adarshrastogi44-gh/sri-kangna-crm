import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, DateInput, Empty, ErrorBox, Loading, Modal, MonthPicker, PinInput } from '../components';
import { checkStaffPin, fetchAll, fmtDate, hasStaffPin, inr, monthKey, monthLabel, monthRange, pinOwnerInfo, resetStaffPin, sendPinResetCode, setStaffPin, today, verifyPinResetCode } from '../utils';

// ---------- small time helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const tm = (ts) => (ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const dtm = (ts) => (ts ? new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const hhmm = (ts) => (ts ? `${pad(new Date(ts).getHours())}:${pad(new Date(ts).getMinutes())}` : '');
const toTs = (date, t) => (t ? new Date(`${date}T${t}:00`).toISOString() : null);
const localDT = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const mins = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : 0);
const dur = (m) => (m ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : '—');
const monthStartTs = (m) => new Date(`${monthRange(m)[0]}T00:00:00`).toISOString();
const monthEndTs = (m) => new Date(`${monthRange(m)[1]}T00:00:00`).toISOString();
const dayName = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' });

const STATUS = {
  present: ['Present', 'green'],
  half: ['Half day', 'amber'],
  absent: ['Absent', 'red'],
  leave: ['Paid leave', 'blue'],
};
const StatusTag = ({ s }) => (s ? <Badge tone={STATUS[s]?.[1] || 'gray'}>{STATUS[s]?.[0] || s}</Badge> : <Badge>Not marked</Badge>);

function breakMins(list, now = new Date().toISOString()) {
  return list.reduce((t, b) => t + mins(b.break_start, b.break_end || now), 0);
}
function workedMins(att, breaks) {
  if (!att?.time_in) return 0;
  const end = att.time_out || (att.work_date === today() ? new Date().toISOString() : null);
  if (!end) return 0;
  return Math.max(0, mins(att.time_in, end) - breakMins(breaks, end));
}

// Salary rule: per-day rate = monthly salary ÷ 30. Absent = 1 day cut, Half day = ½ day cut.
// Present, paid leave and days not marked are paid in full.
// Advances are kept as ONE running balance (all months). They are reduced only when:
//   • the staff returns money (↩ Return), or
//   • you pay less salary — the shortfall is cut from the advance balance (saved as adv_cut on the payment).
export function salaryFor(s, atts, monthAdv, monthPays, allAdv = monthAdv, allPays = monthPays) {
  const perDay = Number(s.monthly_salary || 0) / 30;
  const count = (st) => atts.filter((a) => a.status === st).length;
  const absent = count('absent');
  const half = count('half');
  const deduction = Math.round(perDay * absent + perDay * 0.5 * half);
  const earned = Math.max(0, Math.round(Number(s.monthly_salary || 0) - deduction));
  const sum = (list, f = () => true, k = 'amount') => list.filter(f).reduce((t, a) => t + Number(a[k] || 0), 0);
  const isAdv = (a) => a.kind !== 'return' && a.kind !== 'reward';
  const rewards = sum(monthAdv, (a) => a.kind === 'reward');
  const given = sum(monthAdv, isAdv);
  const returned = sum(monthAdv, (a) => a.kind === 'return');
  const advBalance = Math.round(sum(allAdv, isAdv) - sum(allAdv, (a) => a.kind === 'return') - sum(allPays, () => true, 'adv_cut'));
  const paid = sum(monthPays);
  const cut = sum(monthPays, () => true, 'adv_cut');
  const left = Math.max(0, Math.round(earned - paid - cut));
  const fullyPaid = earned > 0 && left === 0 && paid + cut > 0;
  return { present: count('present'), half, absent, leave: count('leave'), deduction, earned, given, returned, rewards, advBalance, paid, cut, left, fullyPaid, opening: advBalance - given + returned + cut, balance: left, toPay: Math.max(0, left - Math.max(0, advBalance)), advAfter: Math.max(0, advBalance - left) };
}

async function loadMonth(month) {
  const [ms, me] = monthRange(month);
  const [staff, atts, breaks, allAdv, allPays] = await Promise.all([
    fetchAll(() => supabase.from('staff').select('*').order('name')),
    fetchAll(() => supabase.from('staff_attendance').select('*').gte('work_date', ms).lt('work_date', me)),
    fetchAll(() => supabase.from('staff_breaks').select('*').gte('work_date', ms).lt('work_date', me).order('break_start')),
    fetchAll(() => supabase.from('staff_advances').select('*').order('given_at')),
    fetchAll(() => supabase.from('staff_payments').select('*').order('paid_at')),
  ]);
  const a0 = monthStartTs(month), a1 = monthEndTs(month);
  const inMonth = (ts) => { const t = new Date(ts).getTime(); return t >= new Date(a0).getTime() && t < new Date(a1).getTime(); };
  const advances = allAdv.filter((a) => inMonth(a.given_at));
  const payments = allPays.filter((p) => p.month === month);
  // Advance balance is worked out up to the END of the chosen month (later months are not counted)
  const advTill = allAdv.filter((a) => new Date(a.given_at).getTime() < new Date(a1).getTime());
  const paysTill = allPays.filter((p) => (p.month || '') <= month);
  return { staff, atts, breaks, advances, payments, allAdv: advTill, allPays: paysTill };
}

const byStaff = (list, id) => list.filter((x) => x.staff_id === id);
const isReturn = (a) => a.kind === 'return';
const isReward = (a) => a.kind === 'reward';
const notReward = (a) => !isReward(a);
const FESTIVALS = ['Tea', 'Help', 'Diwali', 'Holi', 'Raksha Bandhan', 'Dussehra', 'Navratri', 'Karva Chauth', 'Chhath', 'Eid', 'New Year', 'Bonus'];
const AdvAmount = ({ a }) => (isReturn(a) ? <span className="adv-ret">− {inr(a.amount)}</span> : <span>{inr(a.amount)}</span>);
const AdvType = ({ a }) => (isReturn(a) ? <Badge tone="green">↩ Returned</Badge> : <Badge tone="amber">Advance</Badge>);
const ymKey = (ts) => { const x = new Date(ts); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; };

// ---------- Month-by-month statement: salary + advances, a separate calculation for every month ----------
const addMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const x = new Date(y, mo - 1 + n, 1); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; };
function monthsFrom(a, b) { const out = []; for (let m = a; m <= b && out.length < 36; m = addMonth(m, 1)) out.push(m); return out; }

export function monthlyStatement(s, atts, advs, pays, nowMonth = monthKey()) {
  const mine = (l) => l.filter((x) => x.staff_id === s.id);
  const A = mine(atts), V = mine(advs), P = mine(pays);
  const recMonths = [...V.map((a) => ymKey(a.given_at)), ...P.map((p) => p.month), ...A.map((a) => a.work_date.slice(0, 7))].filter(Boolean).sort();
  // Start from the first month that has an entry in the CRM (not before joining)
  let start = recMonths[0] || nowMonth;
  if (s.join_date && s.join_date.slice(0, 7) > start) start = s.join_date.slice(0, 7);
  if (start > nowMonth) start = nowMonth;
  const end = s.active ? nowMonth : (recMonths[recMonths.length - 1] || start);
  let months = monthsFrom(start, end);
  if (months.length > 24) months = months.slice(-24);
  return months.map((m) => {
    const endTs = new Date(`${monthRange(m)[1]}T00:00:00`).getTime();
    const x = salaryFor(
      s,
      A.filter((a) => a.work_date.startsWith(m)),
      V.filter((a) => ymKey(a.given_at) === m),
      P.filter((p) => p.month === m),
      V.filter((a) => new Date(a.given_at).getTime() < endTs),
      P.filter((p) => (p.month || '') <= m),
    );
    return { month: m, ...x };
  });
}

const statusOf = (r, current) => {
  if (r.fullyPaid) return <Badge tone="green">✓ Paid</Badge>;
  if (r.paid + r.cut > 0) return <Badge tone="amber">Part paid</Badge>;
  if (!(r.earned > 0)) return <span className="muted small">—</span>;
  return r.month >= monthKey() ? <Badge>Not paid</Badge> : <Badge tone="red">Pending</Badge>;
};

function MonthlyStatement({ staffList, staffId, current, onPick }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    Promise.all([
      fetchAll(() => supabase.from('staff_attendance').select('staff_id,work_date,status')),
      fetchAll(() => supabase.from('staff_advances').select('*').order('given_at')),
      fetchAll(() => supabase.from('staff_payments').select('*')),
    ]).then(([atts, advs, pays]) => setData({ atts, advs, pays })).catch(() => setData({ atts: [], advs: [], pays: [] }));
  }, [staffId, current]);
  if (!data) return null;
  const people = staffId ? staffList.filter((s) => s.id === staffId) : staffList;
  const byMonth = {};
  people.forEach((s) => monthlyStatement(s, data.atts, data.advs, data.pays).forEach((r) => {
    const t = (byMonth[r.month] ||= { month: r.month, earned: 0, paid: 0, cut: 0, left: 0, opening: 0, given: 0, returned: 0, advBalance: 0, staff: 0, paidStaff: 0, rows: [] });
    ['earned', 'paid', 'cut', 'left', 'opening', 'given', 'returned', 'advBalance'].forEach((k) => { t[k] += r[k]; });
    if (r.earned > 0) t.staff += 1;
    if (r.fullyPaid) t.paidStaff += 1;
    t.rows.push(r);
  }));
  const rows = Object.values(byMonth).sort((a, b) => b.month.localeCompare(a.month));
  const single = Boolean(staffId);
  return (
    <section className="card flush">
      <div className="pad adv-head">
        <h2>Month by month — salary &amp; advances</h2>
        <div className="muted small">Every month is worked out on its own. <b>Adv. b/f</b> = advance due at the start of the month · <b>Adv. cut</b> = cut from salary · <b>Adv. c/f</b> = advance still due at the end. Click a month to open it.</div>
      </div>
      {rows.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <div className="table-scroll">
          <table className="month-stmt">
            <thead><tr>
              <th>Month</th><th className="num">Earned</th><th className="num">Paid</th><th className="num" title="Cut from advance">Adv. cut</th><th className="num">Salary left</th>
              <th className="num hide-sm" title="Advance due at start of month">Adv. b/f</th><th className="num">Adv. given</th><th className="num hide-sm">Returned</th><th className="num" title="Advance due at end of month">Adv. c/f</th><th>Status</th>
            </tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.month} className={`click ${m.month === current ? 'cur-month' : ''}`} onClick={() => onPick?.(m.month)}>
                  <td><b>{monthLabel(m.month, true)}</b></td>
                  <td className="num">{inr(m.earned)}</td>
                  <td className="num">{m.paid ? inr(m.paid) : '—'}</td>
                  <td className="num">{m.cut ? inr(m.cut) : '—'}</td>
                  <td className="num"><b className={m.left > 0 ? 'to-pay' : ''}>{inr(m.left)}</b></td>
                  <td className="num hide-sm">{inr(m.opening)}</td>
                  <td className="num">{m.given ? `+ ${inr(m.given)}` : '—'}</td>
                  <td className="num hide-sm">{m.returned ? `− ${inr(m.returned)}` : '—'}</td>
                  <td className="num"><b className={m.advBalance > 0 ? 'adv-due' : ''}>{inr(m.advBalance)}</b></td>
                  <td>{single ? statusOf(m.rows[0], current)
                    : m.staff === 0 ? <span className="muted small">—</span>
                      : m.paidStaff === m.staff ? <Badge tone="green">✓ Paid</Badge>
                        : <Badge tone={m.paidStaff ? 'amber' : m.month >= monthKey() ? 'gray' : 'red'}>{m.paidStaff}/{m.staff} paid</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
const run = async (p) => { const { error } = await p; if (error) throw error; };

// ---------- Password to open the Staff page ----------
// Asked every time the Staff page is opened. Leaving the page (or 🔒 Lock) locks it again.
export default function Staff(props) {
  const [state, setState] = useState('check'); // check | setup | locked | open | error
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null);
  useEffect(() => { hasStaffPin().then((h) => setState(h ? 'locked' : 'setup')).catch((e) => { setErr(e); setState('error'); }); }, []);

  if (state === 'open') {
    return (
      <>
        <StaffPage {...props} lockBar={(
          <span className="lock-bar">
            <button className="btn small ghost" onClick={() => setState('locked')} title="Lock the Staff page">🔒 Lock</button>
            <button className="link small" onClick={() => setModal('change')}>Change password</button>
          </span>
        )} />
        {modal === 'change' && <Modal title="Change staff password" onClose={() => setModal(null)}><ChangeStaffPin onDone={() => setModal(null)} onCancel={() => setModal(null)} /></Modal>}
      </>
    );
  }
  return (
    <>
      <div className="page-head"><h1>Staff</h1></div>
      <div className="lock-wrap">
        <div className="card lock-card">
          <div className="lock-icon">🔒</div>
          {state === 'check' && <Loading />}
          {state === 'error' && (
            <>
              <h2>One-time setup needed</h2>
              <p className="muted">To put a password on the Staff page, open <b>Supabase → SQL Editor → New query</b>, paste <code>staff-lock-setup.sql</code> and click <b>Run</b>. Then refresh this page.</p>
              <ErrorBox error={err} />
            </>
          )}
          {state === 'setup' && <SetStaffPin onDone={() => setState('open')} />}
          {state === 'locked' && <UnlockStaff onOpen={() => setState('open')} onForgot={() => setModal('forgot')} />}
        </div>
      </div>
      {modal === 'forgot' && <Modal title="Reset staff password" onClose={() => setModal(null)}><ForgotStaffPin onDone={() => { setModal(null); setState('open'); }} /></Modal>}
    </>
  );
}

function UnlockStaff({ onOpen, onForgot }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const go = async (p = pin) => {
    if (p.length !== 4 || busy) return;
    setBusy(true); setMsg('');
    try {
      if (await checkStaffPin(p)) onOpen();
      else { setMsg('Wrong password. Try again.'); setPin(''); }
    } catch (e) { setMsg(e.message || String(e)); setPin(''); }
    setBusy(false);
  };
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); go(); }}>
      <h2>Staff page is locked</h2>
      <p className="muted small">Enter the 4-digit staff password to see attendance, salary and advances.</p>
      <PinInput value={pin} autoFocus onChange={(v) => { setPin(v); setMsg(''); if (v.length === 4) go(v); }} />
      {msg && <div className="error-text">{msg}</div>}
      <button className="btn primary" disabled={busy || pin.length !== 4}>{busy ? 'Checking…' : 'Open Staff page'}</button>
      <button type="button" className="link small" onClick={onForgot}>Forgot password?</button>
    </form>
  );
}

function SetStaffPin({ onDone }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    if (a !== b) { setErr(new Error('The two passwords do not match.')); return; }
    setBusy(true); setErr(null);
    try { await setStaffPin(null, a); onDone(); } catch (x) { setErr(x); setBusy(false); }
  };
  return (
    <form className="form" onSubmit={save}>
      <h2>Set a password for the Staff page</h2>
      <p className="muted small">Choose a 4-digit password. It will be asked every time the Staff page is opened. Keep it different from the bill delete PIN if staff know that one.</p>
      <label>New password<PinInput value={a} autoFocus onChange={setA} /></label>
      <label>Type it again<PinInput value={b} onChange={setB} /></label>
      <ErrorBox error={err} />
      <button className="btn primary" disabled={busy || a.length !== 4 || b.length !== 4}>{busy ? 'Saving…' : 'Set password'}</button>
    </form>
  );
}

function ChangeStaffPin({ onDone, onCancel }) {
  const [f, setF] = useState({ old: '', a: '', b: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(false);
  const save = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (f.a !== f.b) { setErr(new Error('The two new passwords do not match.')); return; }
    setBusy(true); setErr(null);
    try { await setStaffPin(f.old, f.a); setOk(true); setTimeout(onDone, 900); } catch (x) { setErr(x); }
    setBusy(false);
  };
  if (ok) return <p className="ok-text">✓ Staff password changed.</p>;
  return (
    <form className="form" onSubmit={save}>
      <ErrorBox error={err} />
      <label>Current password<PinInput value={f.old} autoFocus onChange={(v) => setF({ ...f, old: v })} /></label>
      <div className="grid2">
        <label>New password<PinInput value={f.a} onChange={(v) => setF({ ...f, a: v })} /></label>
        <label>Type it again<PinInput value={f.b} onChange={(v) => setF({ ...f, b: v })} /></label>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={busy || f.old.length !== 4 || f.a.length !== 4 || f.b.length !== 4}>{busy ? 'Saving…' : 'Change password'}</button>
      </div>
    </form>
  );
}

function ForgotStaffPin({ onDone }) {
  const [step, setStep] = useState('check');
  const [email, setEmail] = useState('');
  const [hint, setHint] = useState('');
  const [code, setCode] = useState('');
  const [p, setP] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const [{ data }, info] = await Promise.all([supabase.auth.getUser(), pinOwnerInfo().catch(() => ({ is_owner: true }))]);
        setEmail(data?.user?.email || '');
        setHint(info?.hint || '');
        setStep(info?.is_owner === false ? 'notowner' : 'send');
      } catch (e) { setErr(e); setStep('send'); }
    })();
  }, []);
  const act = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e); } setBusy(false); };
  return (
    <div className="form">
      <ErrorBox error={err} />
      {step === 'check' && <Loading />}
      {step === 'notowner' && <p>Only the owner can reset the staff password. Please sign in with the owner's account{hint ? <> (<b>{hint}</b>)</> : ''} and try again.</p>}
      {step === 'send' && (
        <>
          <p>We will email a code to <b>{email}</b>.</p>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary" disabled={busy || !email} onClick={() => act(async () => { await sendPinResetCode(email); setStep('code'); })}>{busy ? 'Sending…' : 'Send code'}</button>
          </div>
        </>
      )}
      {step === 'code' && (
        <>
          <p className="muted small">Check your email (and Spam) for the code and type it here.</p>
          <label>Code<input className="pin-input code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <button className="link" style={{ marginRight: 'auto' }} disabled={busy} onClick={() => act(() => sendPinResetCode(email))}>Send again</button>
            <button className="btn primary" disabled={busy || code.length < 6} onClick={() => act(async () => { await verifyPinResetCode(email, code); setStep('new'); })}>{busy ? 'Checking…' : 'Verify code'}</button>
          </div>
        </>
      )}
      {step === 'new' && (
        <>
          <p className="ok-text">✓ Code verified. Choose a new 4-digit staff password.</p>
          <div className="grid2">
            <label>New password<PinInput value={p.a} autoFocus onChange={(v) => setP({ ...p, a: v })} /></label>
            <label>Type it again<PinInput value={p.b} onChange={(v) => setP({ ...p, b: v })} /></label>
          </div>
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary" disabled={busy || p.a.length !== 4 || p.a !== p.b} onClick={() => act(async () => { await resetStaffPin(p.a); onDone(); })}>{busy ? 'Saving…' : 'Save new password'}</button>
          </div>
        </>
      )}
    </div>
  );
}

function StaffPage({ lockBar }) {
  const [tab, setTab] = useState('today');
  const [month, setMonth] = useState(monthKey());
  const [day, setDay] = useState(today());
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const [modal, setModal] = useState(null);
  const [open, setOpen] = useState(null);
  const [, setClock] = useState(0);
  const [place, setPlaceState] = useState(() => { try { return localStorage.getItem('sk-staff-place') || 'shop'; } catch { return 'shop'; } });
  const setPlace = (p) => { setPlaceState(p); try { localStorage.setItem('sk-staff-place', p); } catch { /* ignore */ } };

  const loadKey = tab === 'today' ? day.slice(0, 7) : month;
  useEffect(() => {
    setD(null); setErr(null);
    loadMonth(loadKey).then(setD).catch((e) => setErr(e));
  }, [loadKey, tick]);
  useEffect(() => { const t = setInterval(() => setClock((x) => x + 1), 60000); return () => clearInterval(t); }, []);

  const refresh = () => setTick((t) => t + 1);
  const done = () => { setModal(null); refresh(); };
  const act = async (fn) => { try { await fn(); refresh(); } catch (e) { alert(e.message || String(e)); } };

  if (err) {
    const missing = /staff/.test(err.message || '') && /(does not exist|schema cache|not find)/i.test(err.message || '');
    return (
      <>
        <div className="page-head"><h1>Staff</h1></div>
        {missing ? <div className="card"><h2>One-time setup needed</h2><p>Open <b>Supabase → SQL Editor</b>, paste the contents of <code>staff-setup.sql</code> and click <b>Run</b>. Then refresh this page.</p></div> : <ErrorBox error={err} />}
      </>
    );
  }

  if (open) {
    return <StaffDetail staffId={open} onBack={() => { setOpen(null); refresh(); }} />;
  }

  const hasPlace = d ? d.staff.some((s) => 'place' in s) || d.staff.length === 0 : true;
  const inPlace = (s) => (s.place || 'shop') === place;
  const view = d ? { ...d, staff: d.staff.filter(inPlace) } : null;
  const active = view ? view.staff.filter((s) => s.active) : [];
  const count = (p) => (d ? d.staff.filter((s) => s.active && (s.place || 'shop') === p).length : 0);

  return (
    <>
      <div className="page-head">
        <h1>Staff {lockBar}</h1>
        <div className="place-switch">
          <button className={place === 'shop' ? 'on' : ''} onClick={() => setPlace('shop')}>🏬 Shop staff <span>{count('shop')}</span></button>
          <button className={place === 'home' ? 'on' : ''} onClick={() => setPlace('home')}>🏠 Home staff <span>{count('home')}</span></button>
        </div>
      </div>
      {d && !hasPlace && <div className="notice warn-notice">To keep Home staff separate, run <code>staff-place.sql</code> once in Supabase → SQL Editor. Until then everyone shows under Shop staff.</div>}
      <div className="toolbar staff-toolbar">
        <div className="actions">
          <div className="tabs">
            <button className={tab === 'today' ? 'active' : ''} onClick={() => setTab('today')}>Attendance</button>
            <button className={tab === 'salary' ? 'active' : ''} onClick={() => setTab('salary')}>Salary &amp; advances</button>
            <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>Staff list</button>
          </div>
          {tab === 'today' && <div className="staff-date"><DateInput value={day} onChange={(v) => v && setDay(v)} /></div>}
          {tab === 'salary' && <MonthPicker value={month} onChange={setMonth} />}
        </div>
        <button className="btn primary" onClick={() => setModal({ staff: { place } })}>+ Add {place === 'home' ? 'home' : 'shop'} staff</button>
      </div>

      {!d ? <Loading /> : (
        <>
          {tab === 'today' && (
            <section className="card flush">
              <h2 className="pad">{place === 'home' ? '🏠 Home staff' : '🏬 Shop staff'} · {day === today() ? 'Today' : fmtDate(day)} · {dayName(day)}</h2>
              {active.length === 0 ? <Empty>No {place === 'home' ? 'home' : 'shop'} staff yet. Click “+ Add {place === 'home' ? 'home' : 'shop'} staff”.</Empty> : (
                <table>
                  <thead><tr><th>Staff</th><th>Status</th><th>Time in</th><th>Breaks</th><th>Time out</th><th className="num">Worked</th><th></th></tr></thead>
                  <tbody>
                    {active.map((s) => {
                      const att = d.atts.find((a) => a.staff_id === s.id && a.work_date === day);
                      const brs = d.breaks.filter((b) => b.staff_id === s.id && b.work_date === day);
                      const onBreak = brs.find((b) => !b.break_end);
                      const isToday = day === today();
                      const now = new Date().toISOString();
                      const mark = (status) => act(() => run(supabase.from('staff_attendance').upsert({ staff_id: s.id, work_date: day, status, ...(status === 'absent' || status === 'leave' ? { time_in: null, time_out: null } : {}) }, { onConflict: 'staff_id,work_date' })));
                      return (
                        <tr key={s.id}>
                          <td><button className="link strong" onClick={() => setOpen(s.id)}>{s.name}</button>{s.role && <div className="muted small">{s.role}</div>}</td>
                          <td><StatusTag s={att?.status} />{onBreak && <div><Badge tone="amber">On break since {tm(onBreak.break_start)}</Badge></div>}</td>
                          <td>{tm(att?.time_in)}</td>
                          <td>{brs.length ? <>{brs.length} · {dur(breakMins(brs))}</> : '—'}</td>
                          <td>{tm(att?.time_out)}</td>
                          <td className="num">{dur(workedMins(att, brs))}</td>
                          <td className="row-actions staff-actions">
                            {isToday && !att?.time_in && att?.status !== 'absent' && att?.status !== 'leave' && (
                              <button className="btn small primary" onClick={() => act(() => run(supabase.from('staff_attendance').upsert({ staff_id: s.id, work_date: day, status: att?.status === 'half' ? 'half' : 'present', time_in: now }, { onConflict: 'staff_id,work_date' })))}>Time in</button>
                            )}
                            {isToday && att?.time_in && !att?.time_out && (onBreak
                              ? <button className="btn small" onClick={() => act(() => run(supabase.from('staff_breaks').update({ break_end: now }).eq('id', onBreak.id)))}>End break</button>
                              : <button className="btn small" onClick={() => act(() => run(supabase.from('staff_breaks').insert({ staff_id: s.id, work_date: day, break_start: now })))}>Start break</button>)}
                            {isToday && att?.time_in && !att?.time_out && (
                              <button className="btn small" onClick={() => act(async () => {
                                if (onBreak) await run(supabase.from('staff_breaks').update({ break_end: now }).eq('id', onBreak.id));
                                await run(supabase.from('staff_attendance').update({ time_out: now }).eq('id', att.id));
                              })}>Time out</button>
                            )}
                            {!att && (
                              <>
                                <button className="link" onClick={() => mark('half')}>Half day</button>
                                <button className="link danger" onClick={() => mark('absent')}>Absent</button>
                                <button className="link" onClick={() => mark('leave')}>Leave</button>
                              </>
                            )}
                            <button className="link" onClick={() => setModal({ dayEdit: { staff: s, date: day, att, breaks: brs } })}>Edit</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {tab === 'salary' && <SalaryTable d={view} month={month} onOpen={setOpen} setModal={setModal} place={place} onMonth={setMonth} />}

          {tab === 'list' && (
            <section className="card flush">
              {view.staff.length === 0 ? <Empty>No {place === 'home' ? 'home' : 'shop'} staff yet.</Empty> : (
                <table>
                  <thead><tr><th>Name</th><th>Phone</th><th>Role</th><th className="num">Monthly salary</th><th>Joined</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {view.staff.map((s) => (
                      <tr key={s.id}>
                        <td><button className="link strong" onClick={() => setOpen(s.id)}>{s.name}</button></td>
                        <td>{s.phone || '—'}</td>
                        <td>{s.role || '—'}</td>
                        <td className="num">{inr(s.monthly_salary)}</td>
                        <td>{fmtDate(s.join_date)}</td>
                        <td>{s.active ? <Badge tone="green">Working</Badge> : <Badge>Left</Badge>}</td>
                        <td className="row-actions"><button className="link" onClick={() => setModal({ staff: s })}>Edit</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </>
      )}

      <StaffModals modal={modal} setModal={setModal} done={done} staffList={d?.staff || []} month={month} />
    </>
  );
}

function SalaryTable({ d, month, onOpen, setModal, place, onMonth }) {
  const calc = (s) => salaryFor(s, byStaff(d.atts, s.id), byStaff(d.advances, s.id), byStaff(d.payments, s.id), byStaff(d.allAdv, s.id), byStaff(d.allPays, s.id));
  const rows = d.staff.map((s) => ({ s, x: calc(s) })).filter(({ s, x }) => s.active || x.advBalance || x.paid || x.cut);
  const tot = (k) => rows.reduce((t, r) => t + r.x[k], 0);
  return (
    <>
      <p className="muted small"><b>{place === 'home' ? '🏠 Home staff' : '🏬 Shop staff'}</b> · Salary for {monthLabel(month)}. Day rate = salary ÷ 30 · <b>Absent</b> cuts 1 day, <b>Half day</b> ½ day. Each month is worked out separately. <b>Advance balance</b> is the advance still due at the end of this month. When you pay less salary, the difference is cut from the advance balance.</p>
      <div className="stats">
        <div className="stat"><div className="stat-label">Salary earned · {monthLabel(month, true)}</div><div className="stat-value">{inr(tot('earned'))}</div></div>
        <div className="stat"><div className="stat-label">Salary left to pay (after advance)</div><div className="stat-value">{inr(tot('toPay'))}</div><div className="stat-sub">salary left {inr(tot('left'))} − advance {inr(tot('advBalance'))}</div></div>
        <div className="stat"><div className="stat-label">Salary paid · {monthLabel(month, true)}</div><div className="stat-value">{rows.filter((r) => r.x.fullyPaid).length} of {rows.filter((r) => r.x.earned > 0).length}</div><div className="stat-sub">staff fully paid</div></div>
        <div className="stat warn"><div className="stat-label">Advance balance · end of {monthLabel(month, true)}</div><div className="stat-value">{inr(tot('advBalance'))}</div><div className="stat-sub">still due from staff</div></div>
      </div>
      <section className="card flush">
        {rows.length === 0 ? <Empty>No staff yet.</Empty> : (
          <table>
            <thead><tr><th>Staff</th><th className="num">Salary</th><th className="num">Absent / Half</th><th className="num">Earned</th><th className="num">Paid</th><th className="num">Adv. cut</th><th className="num">Adv. balance</th><th className="num">To pay</th><th></th></tr></thead>
            <tbody>
              {rows.map(({ s, x }) => (
                <tr key={s.id}>
                  <td><button className="link strong" onClick={() => onOpen(s.id)}>{s.name}</button></td>
                  <td className="num">{inr(s.monthly_salary)}</td>
                  <td className="num">{x.absent} / {x.half}</td>
                  <td className="num">{inr(x.earned)}{x.deduction > 0 && <div className="muted small">cut {inr(x.deduction)}</div>}</td>
                  <td className="num">{x.paid ? inr(x.paid) : '—'}</td>
                  <td className="num">{x.cut ? inr(x.cut) : '—'}</td>
                  <td className="num"><b className={x.advBalance > 0 ? 'adv-due' : ''}>{inr(x.advBalance)}</b></td>
                  <td className="num">{x.fullyPaid ? <b className="ok-text">✓ Paid</b> : <><b className="to-pay">{inr(x.toPay)}</b><div className="muted small">{inr(x.left)} − {inr(Math.max(0, x.advBalance))}{x.advAfter > 0 ? ` · ${inr(x.advAfter)} advance stays` : ''}</div></>}</td>
                  <td className="row-actions sal-actions">
                    <button className="link" onClick={() => setModal({ advance: { staff: s } })}>+ Advance</button>
                    <button className="link" onClick={() => setModal({ ret: { staff: s } })}>↩ Return</button>
                    <button className="link" onClick={() => setModal({ reward: { staff: s } })}>🎁 Reward</button>
                    {x.fullyPaid
                      ? <Badge tone="green">✓ Salary paid</Badge>
                      : <button className="link strong" onClick={() => setModal({ pay: { staff: s, left: x.left, advBalance: x.advBalance } })}>Pay{x.paid + x.cut > 0 ? ' rest' : ''}</button>}
                  </td>
                </tr>
              ))}
              <tr className="total-row"><td><b>Total</b></td><td /><td /><td className="num">{inr(tot('earned'))}</td><td className="num">{inr(tot('paid'))}</td><td className="num">{inr(tot('cut'))}</td><td className="num"><b>{inr(tot('advBalance'))}</b></td><td className="num"><b>{inr(tot('toPay'))}</b></td><td /></tr>
            </tbody>
          </table>
        )}
      </section>
      {d.advances.filter((a) => notReward(a) && d.staff.some((s) => s.id === a.staff_id)).length > 0 && (
        <section className="card flush">
          <h2 className="pad">Advances in {monthLabel(month)}</h2>
          <table>
            <thead><tr><th>Date &amp; time</th><th>Staff</th><th>Type</th><th className="num">Amount</th><th>Note</th></tr></thead>
            <tbody>
              {[...d.advances].filter((a) => notReward(a) && d.staff.some((s) => s.id === a.staff_id)).reverse().map((a) => (
                <tr key={a.id}><td>{dtm(a.given_at)}</td><td>{d.staff.find((s) => s.id === a.staff_id)?.name || '—'}</td><td><AdvType a={a} /></td><td className="num"><AdvAmount a={a} /></td><td>{a.note || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <RewardsCard rewards={d.advances.filter((a) => isReward(a) && d.staff.some((s) => s.id === a.staff_id))} staffList={d.staff} month={month} />
      <MonthlyStatement staffList={d.staff} current={month} onPick={onMonth} />
      
    </>
  );
}

// ---------- One staff member: month view ----------
function StaffDetail({ staffId, onBack }) {
  const [month, setMonth] = useState(monthKey());
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const [modal, setModal] = useState(null);
  useEffect(() => { setD(null); loadMonth(month).then(setD).catch(setErr); }, [month, tick]);
  const done = () => { setModal(null); setTick((t) => t + 1); };
  const del = async (table, id, what) => {
    if (!window.confirm(`Delete this ${what}?`)) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) alert(error.message); else setTick((t) => t + 1);
  };

  const days = useMemo(() => {
    const [ms, me] = monthRange(month);
    const out = [];
    const end = me > today() ? today() : me;
    for (let x = new Date(ms + 'T00:00:00'); ; x.setDate(x.getDate() + 1)) {
      const iso = `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
      if (iso >= me || iso > end) break;
      out.push(iso);
    }
    return out.reverse();
  }, [month]);

  if (err) return <><button className="btn ghost small" onClick={onBack}>← Back</button><ErrorBox error={err} /></>;
  if (!d) return <Loading />;
  const s = d.staff.find((x) => x.id === staffId);
  if (!s) return <><button className="btn ghost small" onClick={onBack}>← Back</button><Empty>Staff not found.</Empty></>;
  const atts = byStaff(d.atts, s.id);
  const brs = byStaff(d.breaks, s.id);
  const allAdv = byStaff(d.advances, s.id);
  const advs = allAdv.filter(notReward);
  const rws = allAdv.filter(isReward);
  const pays = byStaff(d.payments, s.id);
  const x = salaryFor(s, atts, allAdv, pays, byStaff(d.allAdv, s.id), byStaff(d.allPays, s.id));
  const totalWorked = atts.reduce((t, a) => t + workedMins(a, brs.filter((b) => b.work_date === a.work_date)), 0);

  return (
    <>
      <button className="btn ghost small" onClick={onBack}>← Back</button>
      <div className="page-head">
        <h1>{s.name} <Badge tone={(s.place || 'shop') === 'home' ? 'blue' : 'gray'}>{(s.place || 'shop') === 'home' ? '🏠 Home' : '🏬 Shop'}</Badge> {!s.active && <Badge>Left</Badge>}</h1>
        <div className="actions">
          <MonthPicker value={month} onChange={setMonth} />
          <button className="btn" onClick={() => setModal({ staff: s })}>Edit</button>
          <button className="btn" onClick={() => setModal({ advance: { staff: s } })}>+ Advance</button>
          <button className="btn" onClick={() => setModal({ ret: { staff: s } })}>↩ Advance returned</button>
          <button className="btn" onClick={() => setModal({ reward: { staff: s } })}>🎁 Reward</button>
          {x.fullyPaid
            ? <span className="paid-pill">✓ Salary paid · {monthLabel(month, true)}</span>
            : <button className="btn primary" onClick={() => setModal({ pay: { staff: s, left: x.left, advBalance: x.advBalance } })}>{x.paid + x.cut > 0 ? 'Pay rest of salary' : 'Pay salary'}</button>}
        </div>
      </div>
      <div className="stats">
        <div className="stat"><div className="stat-label">Monthly salary</div><div className="stat-value">{inr(s.monthly_salary)}</div><div className="stat-sub">{s.role || ''}{s.phone ? ` · ${s.phone}` : ''}</div></div>
        <div className="stat"><div className="stat-label">Attendance · {monthLabel(month, true)}</div><div className="stat-value">{x.present + x.half}</div><div className="stat-sub">present {x.present} · half {x.half} · absent {x.absent} · leave {x.leave}</div></div>
        <div className="stat"><div className="stat-label">Hours worked</div><div className="stat-value">{dur(totalWorked)}</div></div>
        <div className="stat"><div className="stat-label">Earned</div><div className="stat-value">{inr(x.earned)}</div><div className="stat-sub">{x.deduction ? `cut ${inr(x.deduction)} for absence` : 'no cut'}</div></div>
        <div className="stat warn"><div className="stat-label">Advance balance · end of {monthLabel(month, true)}</div><div className="stat-value">{inr(x.advBalance)}</div><div className="stat-sub">this month: given {inr(x.given)}{x.returned ? ` · returned ${inr(x.returned)}` : ''}{x.cut ? ` · cut ${inr(x.cut)}` : ''}</div></div>
        <div className="stat reward-stat"><div className="stat-label">🎁 Rewards</div><div className="stat-value">{inr(x.rewards)}</div><div className="stat-sub">gifts · not cut from salary</div></div>
        <div className={`stat to-pay-stat ${x.fullyPaid ? 'paid-stat' : ''}`}><div className="stat-label">{x.fullyPaid ? `Salary for ${monthLabel(month, true)}` : 'Salary left to pay (after advance)'}</div><div className="stat-value">{x.fullyPaid ? '✓ Paid' : inr(x.toPay)}</div><div className="stat-sub">{x.fullyPaid ? `paid ${inr(x.paid)}${x.cut ? ` + cut from advance ${inr(x.cut)}` : ''}` : <>salary left {inr(x.left)} − advance {inr(Math.max(0, x.advBalance))}{x.advAfter > 0 ? ` · ${inr(x.advAfter)} advance stays` : ''}</>}</div></div>
      </div>

      <div className="cols">
        <section className="card flush">
          <h2 className="pad">Advances</h2>
          {advs.length === 0 ? <Empty>No advances this month.</Empty> : (
            <table>
              <thead><tr><th>Date &amp; time</th><th>Type</th><th className="num">Amount</th><th>Note</th><th></th></tr></thead>
              <tbody>{[...advs].reverse().map((a) => (
                <tr key={a.id}><td>{dtm(a.given_at)}</td><td><AdvType a={a} /></td><td className="num"><AdvAmount a={a} /></td><td>{a.note || '—'}</td>
                  <td className="row-actions"><button className="link danger" onClick={() => del('staff_advances', a.id, isReturn(a) ? 'return entry' : 'advance')}>Delete</button></td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
        <section className="card flush">
          <h2 className="pad">Salary paid</h2>
          {pays.length === 0 ? <Empty>No salary paid for this month yet.</Empty> : (
            <table>
              <thead><tr><th>Date &amp; time</th><th className="num">Paid</th><th className="num">Cut from advance</th><th>Note</th><th></th></tr></thead>
              <tbody>{[...pays].reverse().map((p) => (
                <tr key={p.id}><td>{dtm(p.paid_at)}</td><td className="num">{inr(p.amount)}</td><td className="num">{Number(p.adv_cut) ? inr(p.adv_cut) : '—'}</td><td>{p.note || '—'}</td>
                  <td className="row-actions"><button className="link danger" onClick={() => del('staff_payments', p.id, 'payment')}>Delete</button></td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </div>

      <RewardsCard rewards={rws} staffList={d.staff} month={month} single onDelete={(a) => del('staff_advances', a.id, 'reward')} />
      <MonthlyStatement staffList={d.staff} staffId={s.id} current={month} onPick={setMonth} />

      <section className="card flush">
        <h2 className="pad">Daily attendance · {monthLabel(month)}</h2>
        {days.length === 0 ? <Empty>No days yet.</Empty> : (
          <table>
            <thead><tr><th>Date</th><th>Status</th><th>In</th><th>Breaks</th><th>Out</th><th className="num">Worked</th><th></th></tr></thead>
            <tbody>
              {days.map((day) => {
                const att = atts.find((a) => a.work_date === day);
                const b = brs.filter((y) => y.work_date === day);
                return (
                  <tr key={day}>
                    <td>{fmtDate(day)} <span className="muted small">{dayName(day)}</span></td>
                    <td><StatusTag s={att?.status} /></td>
                    <td>{tm(att?.time_in)}</td>
                    <td>{b.length ? `${b.length} · ${dur(breakMins(b))}` : '—'}</td>
                    <td>{tm(att?.time_out)}</td>
                    <td className="num">{dur(workedMins(att, b))}</td>
                    <td className="row-actions"><button className="link" onClick={() => setModal({ dayEdit: { staff: s, date: day, att, breaks: b } })}>Edit</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <StaffModals modal={modal} setModal={setModal} done={done} staffList={d.staff} month={month} />
    </>
  );
}

function RewardsCard({ rewards, staffList, month, single, onDelete }) {
  if (!rewards.length) return null;
  const total = rewards.reduce((t, a) => t + Number(a.amount || 0), 0);
  return (
    <section className="card flush reward-card">
      <h2 className="pad">🎁 Rewards in {monthLabel(month)} <span className="muted small">· {inr(total)} · gifts, not counted in salary or advances</span></h2>
      <table>
        <thead><tr><th>Date &amp; time</th>{!single && <th>Staff</th>}<th className="num">Amount</th><th>Occasion / note</th>{onDelete && <th />}</tr></thead>
        <tbody>
          {[...rewards].reverse().map((a) => (
            <tr key={a.id}>
              <td>{dtm(a.given_at)}</td>
              {!single && <td>{staffList.find((s) => s.id === a.staff_id)?.name || '—'}</td>}
              <td className="num"><b>{inr(a.amount)}</b></td>
              <td>{a.note || '—'}</td>
              {onDelete && <td className="row-actions"><button className="link danger" onClick={() => onDelete(a)}>Delete</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------- Forms ----------
function StaffModals({ modal, setModal, done, staffList, month }) {
  if (!modal) return null;
  const close = () => setModal(null);
  if (modal.staff) return <Modal title={modal.staff.id ? 'Edit staff' : 'Add staff'} onClose={close}><StaffForm s={modal.staff} onSaved={done} onCancel={close} /></Modal>;
  if (modal.advance) return <Modal title={`Advance · ${modal.advance.staff.name}`} onClose={close}><MoneyForm kind="advance" staff={modal.advance.staff} onSaved={done} onCancel={close} /></Modal>;
  if (modal.reward) return <Modal title={`🎁 Reward · ${modal.reward.staff.name}`} onClose={close}><MoneyForm kind="reward" staff={modal.reward.staff} onSaved={done} onCancel={close} /></Modal>;
  if (modal.ret) return <Modal title={`Advance returned · ${modal.ret.staff.name}`} onClose={close}><MoneyForm kind="return" staff={modal.ret.staff} onSaved={done} onCancel={close} /></Modal>;
  if (modal.pay) return <Modal title={`Pay salary · ${modal.pay.staff.name}`} onClose={close}><PayForm staff={modal.pay.staff} month={month} left={modal.pay.left} advBalance={modal.pay.advBalance} onSaved={done} onCancel={close} /></Modal>;
  if (modal.dayEdit) return <Modal title={`${modal.dayEdit.staff.name} · ${fmtDate(modal.dayEdit.date)}`} onClose={close}><DayForm {...modal.dayEdit} onSaved={done} onCancel={close} /></Modal>;
  return null;
}

function Buttons({ busy, onCancel, label }) {
  return (
    <div className="actions" style={{ justifyContent: 'flex-end' }}>
      <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : label}</button>
    </div>
  );
}

function StaffForm({ s, onSaved, onCancel }) {
  const [f, setF] = useState({ place: s.place || 'shop', name: s.name || '', phone: s.phone || '', role: s.role || '', monthly_salary: s.monthly_salary ?? '', join_date: s.join_date || today(), active: s.active ?? true, notes: s.notes || '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault(); e.stopPropagation();
    setBusy(true); setErr(null);
    const row = { ...f, name: f.name.trim(), monthly_salary: Number(f.monthly_salary || 0), join_date: f.join_date || null };
    const write = (r) => (s.id ? supabase.from('staff').update(r).eq('id', s.id) : supabase.from('staff').insert(r));
    let { error } = await write(row);
    if (error && /place/.test(error.message || '')) {
      // "place" column not added yet in Supabase: save without it
      const { place: _p, ...rest } = row;
      ({ error } = await write(rest));
    }
    setBusy(false);
    if (error) setErr(error); else onSaved();
  };
  return (
    <form className="form" onSubmit={submit}>
      <ErrorBox error={err} />
      <div className="place-pick">
        <button type="button" className={f.place === 'shop' ? 'on' : ''} onClick={() => setF({ ...f, place: 'shop' })}>🏬 Shop staff</button>
        <button type="button" className={f.place === 'home' ? 'on' : ''} onClick={() => setF({ ...f, place: 'home' })}>🏠 Home staff</button>
      </div>
      <label>Name<input value={f.name} onChange={set('name')} required autoFocus /></label>
      <div className="grid2">
        <label>Phone<input value={f.phone} onChange={set('phone')} inputMode="numeric" /></label>
        <label>Role<input value={f.role} onChange={set('role')} placeholder={f.place === 'home' ? 'e.g. Cook, Maid, Driver' : 'e.g. Sales girl, Helper'} /></label>
      </div>
      <div className="grid2">
        <label>Monthly salary (₹)<input type="number" min="0" value={f.monthly_salary} onChange={set('monthly_salary')} required /></label>
        <label>Joining date<DateInput value={f.join_date} onChange={(v) => setF({ ...f, join_date: v })} /></label>
      </div>
      <label>Notes<textarea rows={2} value={f.notes} onChange={set('notes')} /></label>
      <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Currently working (untick if they left)</label>
      <Buttons busy={busy} onCancel={onCancel} label={s.id ? 'Update' : 'Add staff'} />
    </form>
  );
}

function PayForm({ staff, month, left, advBalance, onSaved, onCancel }) {
  const maxCut = Math.min(left, Math.max(0, advBalance));
  const [cash, setCash] = useState(String(left - maxCut));
  const [cutOn, setCutOn] = useState(maxCut > 0);
  const [when, setWhen] = useState(localDT());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const c = Math.max(0, Number(cash || 0));
  const cut = cutOn ? Math.min(Math.max(0, advBalance), Math.max(0, left - c)) : 0;
  const submit = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!(c > 0) && !(cut > 0)) { setErr({ message: 'Enter the amount you are paying.' }); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.from('staff_payments').insert({ staff_id: staff.id, month, amount: c, adv_cut: cut, paid_at: new Date(when).toISOString(), note: note.trim() || null });
    setBusy(false);
    if (error) setErr(/adv_cut|amount_check/.test(error.message || '') ? { message: 'One-time setup needed: run advance-balance.sql in Supabase → SQL Editor, then try again.' } : error);
    else onSaved();
  };
  return (
    <form className="form" onSubmit={submit}>
      <ErrorBox error={err} />
      <div className="pay-summary">
        <div><span>Salary left for {monthLabel(month)}</span><b>{inr(left)}</b></div>
        <div><span>Advance balance (all months)</span><b className="adv-due">{inr(advBalance)}</b></div>
      </div>
      <label>Cash / UPI paying now (₹)<input type="number" min="0" value={cash} onChange={(e) => setCash(e.target.value)} autoFocus /></label>
      {advBalance > 0 && (
        <label className="check"><input type="checkbox" checked={cutOn} onChange={(e) => setCutOn(e.target.checked)} /> Cut the rest from advance</label>
      )}
      <div className="pay-after">
        <div>Cut from advance: <b>{inr(cut)}</b></div>
        <div>After this → salary left <b>{inr(Math.max(0, left - c - cut))}</b> · advance balance <b>{inr(Math.max(0, advBalance - cut))}</b></div>
      </div>
      <label>Date &amp; time<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required /></label>
      <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid by UPI" /></label>
      <Buttons busy={busy} onCancel={onCancel} label="Save payment" />
    </form>
  );
}

function MoneyForm({ kind, staff, month, amount, onSaved, onCancel }) {
  const [amt, setAmt] = useState(amount ? String(amount) : '');
  const [when, setWhen] = useState(localDT());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!(Number(amt) > 0)) { setErr({ message: 'Enter an amount.' }); return; }
    setBusy(true); setErr(null);
    const ts = new Date(when).toISOString();
    let { error } = kind === 'advance'
      ? await supabase.from('staff_advances').insert({ staff_id: staff.id, amount: Number(amt), given_at: ts, note: note.trim() || null })
      : kind === 'return' || kind === 'reward'
        ? await supabase.from('staff_advances').insert({ staff_id: staff.id, kind, amount: Number(amt), given_at: ts, note: note.trim() || null })
        : await supabase.from('staff_payments').insert({ staff_id: staff.id, month, amount: Number(amt), paid_at: ts, note: note.trim() || null });
    if (error && (kind === 'return' || kind === 'reward') && /kind/.test(error.message || '')) error = { message: 'One-time setup needed: run advance-return.sql in Supabase → SQL Editor, then try again.' };
    setBusy(false);
    if (error) setErr(error); else onSaved();
  };
  return (
    <form className="form" onSubmit={submit}>
      <ErrorBox error={err} />
      {kind === 'pay' && <p className="muted small">Salary for <b>{monthLabel(month)}</b>. The amount below is the balance after cuts and advances.</p>}
      {kind === 'advance' && <p className="muted small">This is added to {staff.name}’s advance balance. It comes off when they return money or when you pay them less salary.</p>}
      {kind === 'reward' && <p className="muted small">A gift for {staff.name} (tea, help, festival, bonus, good work). It is recorded separately and is <b>not</b> added to advances or cut from salary.</p>}
      {kind === 'reward' && <div className="chips">{FESTIVALS.map((f) => <button type="button" key={f} className={`chip ${note === f ? 'on' : ''}`} onClick={() => setNote(f)}>{f}</button>)}</div>}
      {kind === 'return' && <p className="muted small">Use this when {staff.name} gives back advance money. It reduces their advance balance.</p>}
      <label>Amount (₹)<input type="number" min="1" value={amt} onChange={(e) => setAmt(e.target.value)} autoFocus required /></label>
      <label>Date &amp; time<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required /></label>
      <label>{kind === 'reward' ? 'Occasion / note' : 'Note'}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'advance' ? 'e.g. cash for festival' : kind === 'return' ? 'e.g. returned in cash' : kind === 'reward' ? 'e.g. Diwali gift' : 'e.g. paid by UPI'} /></label>
      <Buttons busy={busy} onCancel={onCancel} label={kind === 'advance' ? 'Save advance' : kind === 'return' ? 'Save returned amount' : kind === 'reward' ? 'Save reward' : 'Save payment'} />
    </form>
  );
}

function DayForm({ staff, date, att, breaks, onSaved, onCancel }) {
  const [status, setStatus] = useState(att?.status || 'present');
  const [tin, setTin] = useState(hhmm(att?.time_in));
  const [tout, setTout] = useState(hhmm(att?.time_out));
  const [notes, setNotes] = useState(att?.notes || '');
  const [brs, setBrs] = useState(breaks.map((b) => ({ id: b.id, s: hhmm(b.break_start), e: hhmm(b.break_end) })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const working = status === 'present' || status === 'half';
  const submit = async (e) => {
    e.preventDefault(); e.stopPropagation();
    setBusy(true); setErr(null);
    try {
      await run(supabase.from('staff_attendance').upsert({
        staff_id: staff.id, work_date: date, status, notes: notes.trim() || null,
        time_in: working ? toTs(date, tin) : null, time_out: working ? toTs(date, tout) : null,
      }, { onConflict: 'staff_id,work_date' }));
      const keep = brs.filter((b) => working && b.s);
      const gone = breaks.filter((b) => !keep.some((k) => k.id === b.id));
      for (const b of gone) await run(supabase.from('staff_breaks').delete().eq('id', b.id));
      for (const b of keep) {
        const row = { staff_id: staff.id, work_date: date, break_start: toTs(date, b.s), break_end: toTs(date, b.e) };
        if (b.id) await run(supabase.from('staff_breaks').update(row).eq('id', b.id));
        else await run(supabase.from('staff_breaks').insert(row));
      }
      onSaved();
    } catch (x) { setErr(x); setBusy(false); }
  };
  const clearDay = async () => {
    if (!window.confirm('Clear attendance for this day?')) return;
    try {
      for (const b of breaks) await run(supabase.from('staff_breaks').delete().eq('id', b.id));
      if (att?.id) await run(supabase.from('staff_attendance').delete().eq('id', att.id));
      onSaved();
    } catch (x) { setErr(x); }
  };
  return (
    <form className="form" onSubmit={submit}>
      <ErrorBox error={err} />
      <label>Status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {working && (
        <>
          <div className="grid2">
            <label>Time in<input type="time" value={tin} onChange={(e) => setTin(e.target.value)} /></label>
            <label>Time out<input type="time" value={tout} onChange={(e) => setTout(e.target.value)} /></label>
          </div>
          <div className="item-box">
            <b className="small">Breaks</b>
            {brs.length === 0 && <span className="muted small">No breaks.</span>}
            {brs.map((b, i) => (
              <div className="grid2 break-row" key={i}>
                <label>Start<input type="time" value={b.s} onChange={(e) => setBrs(brs.map((y, j) => (j === i ? { ...y, s: e.target.value } : y)))} /></label>
                <label>End<div className="break-end"><input type="time" value={b.e} onChange={(e) => setBrs(brs.map((y, j) => (j === i ? { ...y, e: e.target.value } : y)))} /><button type="button" className="link danger" onClick={() => setBrs(brs.filter((_, j) => j !== i))}>Remove</button></div></label>
              </div>
            ))}
            <button type="button" className="btn small" onClick={() => setBrs([...brs, { s: '', e: '' }])}>+ Add break</button>
          </div>
        </>
      )}
      <label>Note<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        {att ? <button type="button" className="link danger" onClick={clearDay}>Clear this day</button> : <span />}
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </form>
  );
}
