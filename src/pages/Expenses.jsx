import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, Empty, ErrorBox, Loading, Modal, MonthPicker } from '../components';
import { downloadCSV, fetchAll, inr, monthKey, monthLabel, monthRange } from '../utils';

const pad = (n) => String(n).padStart(2, '0');
const localDT = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dtm = (ts) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const startTs = (m) => new Date(`${monthRange(m)[0]}T00:00:00`).toISOString();
const endTs = (m) => new Date(`${monthRange(m)[1]}T00:00:00`).toISOString();

export const KINDS = {
  expense: { label: 'Expense', tone: 'red', title: 'Shop expense' },
  deposit: { label: 'Bank deposit', tone: 'blue', title: 'Cash deposited in bank' },
  withdrawal: { label: 'Cash taken', tone: 'amber', title: 'Cash taken from shop' },
};
const EXPENSE_CATS = ['Water', 'Battery rent', 'TV recharge', 'Ration', 'Online orders', 'Electricity', 'Rent', 'Tea / snacks', 'Transport', 'Packing material', 'Repair', 'Cleaning', 'Other'];
const MODES = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank' };

export default function Expenses() {
  const [month, setMonth] = useState(monthKey());
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const [modal, setModal] = useState(null);
  const [kind, setKind] = useState('all');
  const [cat, setCat] = useState('');

  useEffect(() => {
    setRows(null); setErr(null);
    fetchAll(() => supabase.from('expenses').select('*').gte('entry_at', startTs(month)).lt('entry_at', endTs(month)).order('entry_at', { ascending: false }))
      .then(setRows).catch(setErr);
  }, [month, tick]);

  const done = () => { setModal(null); setTick((t) => t + 1); };
  const del = async (r) => {
    if (!window.confirm(`Delete this entry of ${inr(r.amount)}?`)) return;
    const { error } = await supabase.from('expenses').delete().eq('id', r.id);
    if (error) alert(error.message); else setTick((t) => t + 1);
  };

  const sum = (list) => list.reduce((t, r) => t + Number(r.amount || 0), 0);
  const stats = useMemo(() => {
    if (!rows) return null;
    const of = (k) => rows.filter((r) => r.kind === k);
    const group = (list, key) => Object.entries(list.reduce((g, r) => { const k = r[key] || '—'; g[k] = (g[k] || 0) + Number(r.amount || 0); return g; }, {})).sort((a, b) => b[1] - a[1]);
    return {
      expense: sum(of('expense')), deposit: sum(of('deposit')), withdrawal: sum(of('withdrawal')),
      cashOut: sum(rows.filter((r) => r.mode === 'cash' || r.kind !== 'expense')),
      byCat: group(of('expense'), 'category'),
      byPerson: group(of('withdrawal'), 'person'),
    };
  }, [rows]);

  const missing = err && /expenses/.test(err.message || '') && /(does not exist|schema cache|not find)/i.test(err.message || '');
  if (missing) {
    return (
      <>
        <div className="page-head"><h1>Expenses</h1></div>
        <div className="card"><h2>One-time setup needed</h2><p>Open <b>Supabase → SQL Editor</b>, paste the contents of <code>expenses-setup.sql</code> and click <b>Run</b>. Then refresh this page.</p></div>
      </>
    );
  }

  const shown = (rows || []).filter((r) => (kind === 'all' || r.kind === kind) && (!cat || r.category === cat || r.person === cat));
  const exportCSV = () => downloadCSV(`expenses-${month}.csv`, ['Date', 'Time', 'Type', 'Category', 'Amount', 'Person', 'Mode', 'Note'],
    [...shown].reverse().map((r) => { const d = new Date(r.entry_at); return [d.toLocaleDateString('en-IN'), d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }), KINDS[r.kind]?.label || r.kind, r.category, r.amount, r.person || '', MODES[r.mode] || r.mode, r.note || '']; }));

  return (
    <>
      <div className="page-head">
        <h1>Expenses</h1>
        <div className="actions">
          <MonthPicker value={month} onChange={(m) => { setMonth(m); setCat(''); }} />
          <button className="btn" onClick={exportCSV} disabled={!rows?.length}>Download Excel (CSV)</button>
          <button className="btn" onClick={() => setModal({ kind: 'withdrawal' })}>+ Cash taken</button>
          <button className="btn" onClick={() => setModal({ kind: 'deposit' })}>+ Bank deposit</button>
          <button className="btn primary" onClick={() => setModal({ kind: 'expense' })}>+ Expense</button>
        </div>
      </div>
      <ErrorBox error={missing ? null : err} />
      {!rows ? (!err && <Loading />) : (
        <>
          <div className="stats">
            <div className="stat"><div className="stat-label">Shop expenses · {monthLabel(month, true)}</div><div className="stat-value">{inr(stats.expense)}</div><div className="stat-sub">{rows.filter((r) => r.kind === 'expense').length} entries</div></div>
            <div className="stat"><div className="stat-label">Deposited in bank</div><div className="stat-value">{inr(stats.deposit)}</div></div>
            <div className="stat warn"><div className="stat-label">Cash taken from shop</div><div className="stat-value">{inr(stats.withdrawal)}</div><div className="stat-sub">{stats.byPerson.map(([p, a]) => `${p} ${inr(a)}`).join(' · ') || '—'}</div></div>
            <div className="stat"><div className="stat-label">Total cash out of counter</div><div className="stat-value">{inr(stats.cashOut)}</div><div className="stat-sub">cash expenses + deposits + cash taken</div></div>
          </div>

          <div className="cols">
            <section className="card">
              <h2>Expenses by category</h2>
              {stats.byCat.length === 0 ? <p className="muted">No expenses this month.</p> : stats.byCat.map(([c, a]) => (
                <button key={c} className={`exp-cat ${cat === c ? 'on' : ''}`} onClick={() => { setKind('expense'); setCat(cat === c ? '' : c); }}>
                  <span>{c}</span><span className="exp-bar"><span style={{ width: `${(a / stats.byCat[0][1]) * 100}%` }} /></span><b>{inr(a)}</b>
                </button>
              ))}
            </section>
            <section className="card">
              <h2>Cash taken from shop — by person</h2>
              {stats.byPerson.length === 0 ? <p className="muted">No cash taken this month.</p> : stats.byPerson.map(([p, a]) => (
                <button key={p} className={`exp-cat ${cat === p ? 'on' : ''}`} onClick={() => { setKind('withdrawal'); setCat(cat === p ? '' : p); }}>
                  <span>{p}</span><span className="exp-bar amber"><span style={{ width: `${(a / stats.byPerson[0][1]) * 100}%` }} /></span><b>{inr(a)}</b>
                </button>
              ))}
            </section>
          </div>

          <div className="toolbar">
            <div className="tabs">
              {[['all', 'All'], ['expense', 'Expenses'], ['deposit', 'Bank deposits'], ['withdrawal', 'Cash taken']].map(([k, l]) => (
                <button key={k} className={kind === k ? 'active' : ''} onClick={() => { setKind(k); setCat(''); }}>{l}</button>
              ))}
            </div>
            <p className="muted small">{shown.length} entries · {inr(sum(shown))}{cat && <> · filtered by <b>{cat}</b> <button className="link" onClick={() => setCat('')}>clear</button></>}</p>
          </div>
          <section className="card flush">
            {shown.length === 0 ? <Empty>Nothing recorded for {monthLabel(month)} yet.</Empty> : (
              <table>
                <thead><tr><th>Date &amp; time</th><th>Type</th><th>Category</th><th className="num">Amount</th><th>Person</th><th>Mode</th><th className="hide-sm">Note</th><th></th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td>{dtm(r.entry_at)}</td>
                      <td><Badge tone={KINDS[r.kind]?.tone}>{KINDS[r.kind]?.label || r.kind}</Badge></td>
                      <td>{r.category}</td>
                      <td className="num"><b>{inr(r.amount)}</b></td>
                      <td>{r.person || '—'}</td>
                      <td>{MODES[r.mode] || r.mode}</td>
                      <td className="hide-sm">{r.note || '—'}</td>
                      <td className="row-actions">
                        <button className="link" onClick={() => setModal({ row: r, kind: r.kind })}>Edit</button>
                        <button className="link danger" onClick={() => del(r)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
      {modal && (
        <Modal title={modal.row ? 'Edit entry' : 'Add entry'} onClose={() => setModal(null)}>
          <EntryForm kind={modal.kind} row={modal.row} people={[...new Set((rows || []).map((r) => r.person).filter(Boolean))]} cats={[...new Set([...EXPENSE_CATS, ...(rows || []).filter((r) => r.kind === 'expense').map((r) => r.category)])]} onSaved={done} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </>
  );
}

function EntryForm({ kind: initialKind, row, people, cats, onSaved, onCancel }) {
  const [kind, setKind] = useState(initialKind);
  const [f, setF] = useState({
    category: row?.category || (initialKind === 'expense' ? '' : initialKind === 'deposit' ? 'Bank deposit' : 'Cash taken'),
    amount: row?.amount ?? '',
    when: row ? localDT(new Date(row.entry_at)) : localDT(),
    person: row?.person || '',
    mode: row?.mode || (initialKind === 'deposit' ? 'bank' : 'cash'),
    note: row?.note || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const switchKind = (k) => {
    setKind(k);
    setF({ ...f, category: k === 'expense' ? (EXPENSE_CATS.includes(f.category) ? f.category : '') : k === 'deposit' ? 'Bank deposit' : 'Cash taken', mode: k === 'deposit' ? 'bank' : 'cash' });
  };
  const submit = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!(Number(f.amount) > 0)) { setErr({ message: 'Enter an amount.' }); return; }
    if (kind === 'withdrawal' && !f.person.trim()) { setErr({ message: 'Write who took the cash.' }); return; }
    setBusy(true); setErr(null);
    const data = { kind, category: (f.category || 'Other').trim(), amount: Number(f.amount), entry_at: new Date(f.when).toISOString(), person: f.person.trim() || null, mode: f.mode, note: f.note.trim() || null };
    const { error } = row ? await supabase.from('expenses').update(data).eq('id', row.id) : await supabase.from('expenses').insert(data);
    setBusy(false);
    if (error) setErr(error); else onSaved();
  };
  return (
    <form className="form" onSubmit={submit}>
      <ErrorBox error={err} />
      <div className="tabs">
        {Object.entries(KINDS).map(([k, v]) => <button type="button" key={k} className={kind === k ? 'active' : ''} onClick={() => switchKind(k)}>{v.label}</button>)}
      </div>
      {kind === 'expense' && (
        <>
          <label>Category
            <input list="exp-cats" value={f.category} onChange={set('category')} placeholder="Pick or type, e.g. Water" required autoFocus={!row} />
            <datalist id="exp-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <div className="chips">{EXPENSE_CATS.slice(0, 8).map((c) => <button type="button" key={c} className={`chip ${f.category === c ? 'on' : ''}`} onClick={() => setF({ ...f, category: c })}>{c}</button>)}</div>
        </>
      )}
      <div className="grid2">
        <label>Amount (₹)<input type="number" min="1" step="any" value={f.amount} onChange={set('amount')} required autoFocus={kind !== 'expense' && !row} /></label>
        <label>Date &amp; time<input type="datetime-local" value={f.when} onChange={set('when')} required /></label>
      </div>
      <div className="grid2">
        <label>{kind === 'withdrawal' ? 'Who took the cash' : kind === 'deposit' ? 'Deposited by' : 'Paid by (name)'}
          <input list="exp-people" value={f.person} onChange={set('person')} placeholder={kind === 'withdrawal' ? 'Name (required)' : 'Name (optional)'} required={kind === 'withdrawal'} />
          <datalist id="exp-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        {kind === 'expense' ? (
          <label>Payment mode
            <select value={f.mode} onChange={set('mode')}>{Object.entries(MODES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
        ) : <span />}
      </div>
      <label>Note<input value={f.note} onChange={set('note')} placeholder={kind === 'withdrawal' ? 'e.g. for home, for supplier payment' : kind === 'deposit' ? 'e.g. PNB, slip no.' : 'e.g. 2 water cans'} /></label>
      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : row ? 'Update' : 'Save'}</button>
      </div>
    </form>
  );
}
