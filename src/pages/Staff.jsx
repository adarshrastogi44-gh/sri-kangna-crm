import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, DateInput, Empty, ErrorBox, Loading, Modal, MonthPicker } from '../components';
import { fetchAll, fmtDate, inr, monthKey, monthLabel, monthRange, today } from '../utils';

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
// Present, paid leave and days not marked are paid in full. Advances and payments are subtracted.
export function salaryFor(s, atts, advances, payments) {
  const perDay = Number(s.monthly_salary || 0) / 30;
  const count = (st) => atts.filter((a) => a.status === st).length;
  const absent = count('absent');
  const half = count('half');
  const deduction = Math.round(perDay * absent + perDay * 0.5 * half);
  const earned = Math.max(0, Math.round(Number(s.monthly_salary || 0) - deduction));
  const rewards = advances.filter((a) => a.kind === 'reward').reduce((t, a) => t + Number(a.amount || 0), 0); // gifts: never cut from salary
  const given = advances.filter((a) => a.kind !== 'return' && a.kind !== 'reward').reduce((t, a) => t + Number(a.amount || 0), 0);
  const returned = advances.filter((a) => a.kind === 'return').reduce((t, a) => t + Number(a.amount || 0), 0);
  const adv = given - returned; // advances still to be cut from salary
  const paid = payments.reduce((t, p) => t + Number(p.amount || 0), 0);
  return { present: count('present'), half, absent, leave: count('leave'), deduction, earned, given, returned, rewards, adv, paid, balance: Math.round(earned - adv - paid) };
}

async function loadMonth(month) {
  const [ms, me] = monthRange(month);
  const [staff, atts, breaks, advances, payments] = await Promise.all([
    fetchAll(() => supabase.from('staff').select('*').order('name')),
    fetchAll(() => supabase.from('staff_attendance').select('*').gte('work_date', ms).lt('work_date', me)),
    fetchAll(() => supabase.from('staff_breaks').select('*').gte('work_date', ms).lt('work_date', me).order('break_start')),
    fetchAll(() => supabase.from('staff_advances').select('*').gte('given_at', monthStartTs(month)).lt('given_at', monthEndTs(month)).order('given_at')),
    fetchAll(() => supabase.from('staff_payments').select('*').eq('month', month).order('paid_at')),
  ]);
  return { staff, atts, breaks, advances, payments };
}

const byStaff = (list, id) => list.filter((x) => x.staff_id === id);
const isReturn = (a) => a.kind === 'return';
const isReward = (a) => a.kind === 'reward';
const notReward = (a) => !isReward(a);
const FESTIVALS = ['Tea', 'Help', 'Diwali', 'Holi', 'Raksha Bandhan', 'Dussehra', 'Navratri', 'Karva Chauth', 'Chhath', 'Eid', 'New Year', 'Bonus'];
const AdvAmount = ({ a }) => (isReturn(a) ? <span className="adv-ret">− {inr(a.amount)}</span> : <span>{inr(a.amount)}</span>);
const AdvType = ({ a }) => (isReturn(a) ? <Badge tone="green">↩ Returned</Badge> : <Badge tone="amber">Advance</Badge>);
const ymKey = (ts) => { const x = new Date(ts); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; };

// Every month's advances (given, returned, still due) — for all staff in the list, or one person
function MonthlyAdvances({ staffList, staffId, current, onPick }) {
  const [all, setAll] = useState(null);
  useEffect(() => {
    fetchAll(() => supabase.from('staff_advances').select('*').order('given_at', { ascending: false })).then(setAll).catch(() => setAll([]));
  }, [staffId, current]);
  if (!all) return null;
  const ids = new Set(staffId ? [staffId] : staffList.map((s) => s.id));
  const mine = all.filter((a) => ids.has(a.staff_id) && notReward(a));
  const months = {};
  mine.forEach((a) => {
    const k = ymKey(a.given_at);
    const m = (months[k] ||= { given: 0, returned: 0, people: {} });
    const amt = Number(a.amount || 0);
    if (isReturn(a)) m.returned += amt; else m.given += amt;
    const who = staffList.find((s) => s.id === a.staff_id)?.name || '—';
    m.people[who] = (m.people[who] || 0) + (isReturn(a) ? -amt : amt);
  });
  const rows = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0]));
  const tot = rows.reduce((t, [, m]) => ({ given: t.given + m.given, returned: t.returned + m.returned }), { given: 0, returned: 0 });
  return (
    <section className="card flush">
      <h2 className="pad">Advances — month by month</h2>
      {rows.length === 0 ? <Empty>No advances yet.</Empty> : (
        <table>
          <thead><tr><th>Month</th><th className="num">Given</th><th className="num">Returned</th><th className="num">Net advance</th>{!staffId && <th className="hide-sm">By staff (net)</th>}</tr></thead>
          <tbody>
            {rows.map(([k, m]) => (
              <tr key={k} className={`click ${k === current ? 'cur-month' : ''}`} onClick={() => onPick?.(k)}>
                <td><b>{monthLabel(k)}</b>{k === current && <span className="muted small"> · this month</span>}</td>
                <td className="num">{inr(m.given)}</td>
                <td className="num">{m.returned ? `− ${inr(m.returned)}` : '—'}</td>
                <td className="num"><b>{inr(m.given - m.returned)}</b></td>
                {!staffId && <td className="hide-sm small">{Object.entries(m.people).filter(([, v]) => v).map(([n, v]) => `${n} ${inr(v)}`).join(' · ') || '—'}</td>}
              </tr>
            ))}
            <tr className="total-row"><td><b>All months</b></td><td className="num">{inr(tot.given)}</td><td className="num">{tot.returned ? `− ${inr(tot.returned)}` : '—'}</td><td className="num"><b>{inr(tot.given - tot.returned)}</b></td>{!staffId && <td className="hide-sm" />}</tr>
          </tbody>
        </table>
      )}
    </section>
  );
}
const run = async (p) => { const { error } = await p; if (error) throw error; };

export default function Staff() {
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
        <h1>Staff</h1>
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
  const rows = d.staff.filter((s) => s.active || byStaff(d.advances, s.id).length || byStaff(d.payments, s.id).length)
    .map((s) => ({ s, x: salaryFor(s, byStaff(d.atts, s.id), byStaff(d.advances, s.id), byStaff(d.payments, s.id)) }));
  const tot = (k) => rows.reduce((t, r) => t + r.x[k], 0);
  return (
    <>
      <p className="muted small"><b>{place === 'home' ? '🏠 Home staff' : '🏬 Shop staff'}</b> · Salary for {monthLabel(month)}. Per-day rate = monthly salary ÷ 30. <b>Absent</b> cuts 1 day, <b>Half day</b> cuts ½ day. Present, paid leave and unmarked days are paid. Advances given this month are deducted.</p>
      <section className="card flush">
        {rows.length === 0 ? <Empty>No staff yet.</Empty> : (
          <table>
            <thead><tr><th>Staff</th><th className="num">Salary</th><th className="num">Absent / Half</th><th className="num">Cut</th><th className="num">Earned</th><th className="num">Advances</th><th className="num">Paid</th><th className="num">Balance to pay</th><th></th></tr></thead>
            <tbody>
              {rows.map(({ s, x }) => (
                <tr key={s.id}>
                  <td><button className="link strong" onClick={() => onOpen(s.id)}>{s.name}</button></td>
                  <td className="num">{inr(s.monthly_salary)}</td>
                  <td className="num">{x.absent} / {x.half}</td>
                  <td className="num">{x.deduction ? `− ${inr(x.deduction)}` : '—'}</td>
                  <td className="num">{inr(x.earned)}</td>
                  <td className="num">{x.adv ? `− ${inr(x.adv)}` : '—'}{x.returned > 0 && <div className="muted small">gave {inr(x.given)} · back {inr(x.returned)}</div>}</td>
                  <td className="num">{x.paid ? `− ${inr(x.paid)}` : '—'}</td>
                  <td className="num"><b className={x.balance < 0 ? 'danger-text' : ''}>{inr(x.balance)}</b></td>
                  <td className="row-actions sal-actions">
                    <button className="link" onClick={() => setModal({ advance: { staff: s } })}>+ Advance</button>
                    <button className="link" onClick={() => setModal({ ret: { staff: s } })}>↩ Return</button>
                    <button className="link" onClick={() => setModal({ reward: { staff: s } })}>🎁 Reward</button>
                    <button className="link" onClick={() => setModal({ pay: { staff: s, amount: Math.max(0, x.balance) } })}>Pay</button>
                  </td>
                </tr>
              ))}
              <tr className="total-row"><td><b>Total</b></td><td /><td /><td className="num">{inr(tot('deduction'))}</td><td className="num">{inr(tot('earned'))}</td><td className="num">{inr(tot('adv'))}</td><td className="num">{inr(tot('paid'))}</td><td className="num"><b>{inr(tot('balance'))}</b></td><td /></tr>
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
      <MonthlyAdvances staffList={d.staff} current={month} onPick={onMonth} />
      <p className="muted small">A negative balance means more was given than earned this month.</p>
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
  const x = salaryFor(s, atts, allAdv, pays);
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
          <button className="btn primary" onClick={() => setModal({ pay: { staff: s, amount: Math.max(0, x.balance) } })}>Pay salary</button>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><div className="stat-label">Monthly salary</div><div className="stat-value">{inr(s.monthly_salary)}</div><div className="stat-sub">{s.role || ''}{s.phone ? ` · ${s.phone}` : ''}</div></div>
        <div className="stat"><div className="stat-label">Attendance · {monthLabel(month, true)}</div><div className="stat-value">{x.present + x.half}</div><div className="stat-sub">present {x.present} · half {x.half} · absent {x.absent} · leave {x.leave}</div></div>
        <div className="stat"><div className="stat-label">Hours worked</div><div className="stat-value">{dur(totalWorked)}</div></div>
        <div className="stat"><div className="stat-label">Earned</div><div className="stat-value">{inr(x.earned)}</div><div className="stat-sub">{x.deduction ? `cut ${inr(x.deduction)} for absence` : 'no cut'}</div></div>
        <div className="stat warn"><div className="stat-label">Advances (net)</div><div className="stat-value">{inr(x.adv)}</div><div className="stat-sub">given {inr(x.given)}{x.returned ? ` · returned ${inr(x.returned)}` : ''}</div></div>
        <div className="stat reward-stat"><div className="stat-label">🎁 Rewards</div><div className="stat-value">{inr(x.rewards)}</div><div className="stat-sub">gifts · not cut from salary</div></div>
        <div className={`stat ${x.balance > 0 ? '' : 'warn'}`}><div className="stat-label">Balance to pay</div><div className="stat-value">{inr(x.balance)}</div><div className="stat-sub">already paid {inr(x.paid)}</div></div>
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
              <thead><tr><th>Date &amp; time</th><th className="num">Amount</th><th>Note</th><th></th></tr></thead>
              <tbody>{[...pays].reverse().map((p) => (
                <tr key={p.id}><td>{dtm(p.paid_at)}</td><td className="num">{inr(p.amount)}</td><td>{p.note || '—'}</td>
                  <td className="row-actions"><button className="link danger" onClick={() => del('staff_payments', p.id, 'payment')}>Delete</button></td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
      </div>

      <RewardsCard rewards={rws} staffList={d.staff} month={month} single onDelete={(a) => del('staff_advances', a.id, 'reward')} />
      <MonthlyAdvances staffList={d.staff} staffId={s.id} current={month} onPick={setMonth} />

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
  if (modal.pay) return <Modal title={`Pay salary · ${modal.pay.staff.name}`} onClose={close}><MoneyForm kind="pay" staff={modal.pay.staff} month={month} amount={modal.pay.amount} onSaved={done} onCancel={close} /></Modal>;
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
      {kind === 'advance' && <p className="muted small">This advance will be deducted from {staff.name}’s salary for the month it is given in.</p>}
      {kind === 'reward' && <p className="muted small">A gift for {staff.name} (tea, help, festival, bonus, good work). It is recorded separately and is <b>not</b> added to advances or cut from salary.</p>}
      {kind === 'reward' && <div className="chips">{FESTIVALS.map((f) => <button type="button" key={f} className={`chip ${note === f ? 'on' : ''}`} onClick={() => setNote(f)}>{f}</button>)}</div>}
      {kind === 'return' && <p className="muted small">Use this when {staff.name} gives back advance money. It cancels that much advance, so it will <b>not</b> be cut from salary.</p>}
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
