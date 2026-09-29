import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, Empty, ErrorBox, Loading, Modal } from '../components';
import { downloadCSV, fetchAll, inr, monthKey, monthLabel } from '../utils';

const pad = (n) => String(n).padStart(2, '0');
const localDT = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dtm = (ts) => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const ym = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const PAY_MODES = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer', cheque: 'Cheque' };
const sum = (list, kind) => list.filter((e) => e.kind === kind).reduce((t, e) => t + Number(e.amount || 0), 0);

export default function Parties() {
  const [parties, setParties] = useState(null);
  const [entries, setEntries] = useState([]);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const [modal, setModal] = useState(null);
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    Promise.all([
      fetchAll(() => supabase.from('parties').select('*').order('name')),
      fetchAll(() => supabase.from('party_entries').select('*').order('entry_at')),
    ]).then(([p, e]) => { setParties(p); setEntries(e); }).catch(setErr);
  }, [tick]);
  const refresh = () => setTick((t) => t + 1);
  const done = () => { setModal(null); refresh(); };

  const missing = err && /part(ies|y_entries)/.test(err.message || '') && /(does not exist|schema cache|not find)/i.test(err.message || '');
  if (missing) return <div className="card"><h2>One-time setup needed</h2><p>Open <b>Supabase → SQL Editor</b>, paste the contents of <code>parties-setup.sql</code> and click <b>Run</b>. Then refresh this page. Your parties (A.B. Jewellers, Chawla Jewellery, Brite Sales …) are added automatically.</p></div>;
  if (err) return <ErrorBox error={err} />;
  if (!parties) return <Loading />;

  const party = open && parties.find((p) => p.id === open);
  if (party) {
    return (
      <>
        <PartyLedger party={party} entries={entries.filter((e) => e.party_id === party.id)} onBack={() => setOpen(null)}
          onAdd={(kind) => setModal({ kind, party })} onEdit={(e) => setModal({ kind: e.kind, party, entry: e })} onEditParty={() => setModal({ partyForm: party })} onChanged={refresh} />
        <PartyModals modal={modal} setModal={setModal} done={done} parties={parties} />
      </>
    );
  }

  const m = monthKey();
  const rows = parties.map((p) => {
    const es = entries.filter((e) => e.party_id === p.id);
    const mo = es.filter((e) => ym(e.entry_at) === m);
    return { p, purchase: sum(es, 'purchase'), paid: sum(es, 'payment'), mPurchase: sum(mo, 'purchase'), mPaid: sum(mo, 'payment'), last: es.length ? es[es.length - 1].entry_at : null };
  }).map((r) => ({ ...r, due: r.purchase - r.paid }));
  const ql = q.trim().toLowerCase();
  const shown = rows.filter((r) => (r.p.active || r.due) && (!ql || r.p.name.toLowerCase().includes(ql)));
  const tot = (k) => rows.reduce((t, r) => t + r[k], 0);

  return (
    <>
      <div className="stats">
        <div className="stat"><div className="stat-label">Total purchases (all parties)</div><div className="stat-value">{inr(tot('purchase'))}</div><div className="stat-sub">this month {inr(tot('mPurchase'))}</div></div>
        <div className="stat"><div className="stat-label">Total paid to parties</div><div className="stat-value">{inr(tot('paid'))}</div><div className="stat-sub">this month {inr(tot('mPaid'))}</div></div>
        <div className="stat warn"><div className="stat-label">Total balance due to parties</div><div className="stat-value">{inr(tot('due'))}</div><div className="stat-sub">{rows.filter((r) => r.due > 0).length} parties to be paid</div></div>
      </div>
      <div className="toolbar">
        <input className="rent-search" placeholder="Search party…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="actions">
          <button className="btn" onClick={() => setModal({ kind: 'payment' })}>+ Payment to party</button>
          <button className="btn" onClick={() => setModal({ kind: 'purchase' })}>+ Purchase</button>
          <button className="btn primary" onClick={() => setModal({ partyForm: {} })}>+ Add party</button>
        </div>
      </div>
      <section className="card flush">
        {shown.length === 0 ? <Empty>No parties yet.</Empty> : (
          <table>
            <thead><tr><th>Party</th><th className="num">Total purchase</th><th className="num">Total paid</th><th className="num">Balance due</th><th className="num hide-sm">This month</th><th className="hide-sm">Last entry</th><th></th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.p.id} className="click" onClick={() => setOpen(r.p.id)}>
                  <td><strong>{r.p.name}</strong>{r.p.phone && <div className="muted small">{r.p.phone}</div>}</td>
                  <td className="num">{inr(r.purchase)}</td>
                  <td className="num">{inr(r.paid)}</td>
                  <td className="num"><b className={r.due > 0 ? 'adv-due' : r.due < 0 ? 'to-pay' : ''}>{inr(Math.abs(r.due))}</b>{r.due < 0 && <div className="muted small">paid extra</div>}</td>
                  <td className="num hide-sm small">{r.mPurchase || r.mPaid ? <>buy {inr(r.mPurchase)}<br />paid {inr(r.mPaid)}</> : '—'}</td>
                  <td className="hide-sm small">{r.last ? dtm(r.last) : '—'}</td>
                  <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="link" onClick={() => setModal({ kind: 'purchase', party: r.p })}>+ Purchase</button>
                    <button className="link" onClick={() => setModal({ kind: 'payment', party: r.p })}>+ Payment</button>
                  </td>
                </tr>
              ))}
              <tr className="total-row"><td><b>Total</b></td><td className="num"><b>{inr(tot('purchase'))}</b></td><td className="num"><b>{inr(tot('paid'))}</b></td><td className="num"><b>{inr(tot('due'))}</b></td><td className="hide-sm" /><td className="hide-sm" /><td /></tr>
            </tbody>
          </table>
        )}
      </section>
      <PartyModals modal={modal} setModal={setModal} done={done} parties={parties} />
    </>
  );
}

// ---------- one party: full list of purchases and payments ----------
function PartyLedger({ party, entries, onBack, onAdd, onEdit, onEditParty, onChanged }) {
  const [period, setPeriod] = useState('all');
  const months = useMemo(() => [...new Set(entries.map((e) => ym(e.entry_at)))].sort().reverse(), [entries]);
  let run = 0;
  const withBal = entries.map((e) => { run += e.kind === 'purchase' ? Number(e.amount) : -Number(e.amount); return { ...e, bal: run }; });
  const shown = (period === 'all' ? withBal : withBal.filter((e) => ym(e.entry_at) === period)).slice().reverse();
  const purchase = sum(entries, 'purchase');
  const paid = sum(entries, 'payment');
  const pP = sum(shown, 'purchase');
  const pPaid = sum(shown, 'payment');
  const del = async (e) => {
    if (!window.confirm(`Delete this ${e.kind} of ${inr(e.amount)}?`)) return;
    const { error } = await supabase.from('party_entries').delete().eq('id', e.id);
    if (error) alert(error.message); else onChanged();
  };
  const exportCSV = () => downloadCSV(`${party.name}-account.csv`, ['Date', 'Time', 'Type', 'Bill no', 'Purchase', 'Payment', 'Mode', 'Balance', 'Note'],
    withBal.map((e) => { const d = new Date(e.entry_at); return [d.toLocaleDateString('en-IN'), d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }), e.kind === 'purchase' ? 'Purchase' : 'Payment', e.bill_no || '', e.kind === 'purchase' ? e.amount : '', e.kind === 'payment' ? e.amount : '', PAY_MODES[e.mode] || '', e.bal, e.note || '']; }));
  return (
    <>
      <button className="btn ghost small" onClick={onBack}>← All parties</button>
      <div className="page-head">
        <h1>{party.name} {!party.active && <Badge>Inactive</Badge>}</h1>
        <div className="actions">
          <button className="btn" onClick={onEditParty}>Edit party</button>
          <button className="btn" onClick={exportCSV} disabled={!entries.length}>Download Excel (CSV)</button>
          <button className="btn" onClick={() => onAdd('payment')}>+ Payment</button>
          <button className="btn primary" onClick={() => onAdd('purchase')}>+ Purchase</button>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><div className="stat-label">Total purchase</div><div className="stat-value">{inr(purchase)}</div><div className="stat-sub">{entries.filter((e) => e.kind === 'purchase').length} bills</div></div>
        <div className="stat"><div className="stat-label">Total paid</div><div className="stat-value">{inr(paid)}</div><div className="stat-sub">{entries.filter((e) => e.kind === 'payment').length} payments</div></div>
        <div className={`stat ${purchase - paid > 0 ? 'warn' : 'to-pay-stat'}`}><div className="stat-label">{purchase - paid >= 0 ? 'Balance due to party' : 'Paid extra (advance with party)'}</div><div className="stat-value">{inr(Math.abs(purchase - paid))}</div>{party.phone && <div className="stat-sub">{party.phone}</div>}</div>
      </div>
      <div className="toolbar">
        <div className="tabs">
          <button className={period === 'all' ? 'active' : ''} onClick={() => setPeriod('all')}>All time</button>
          {months.slice(0, 6).map((k) => <button key={k} className={period === k ? 'active' : ''} onClick={() => setPeriod(k)}>{monthLabel(k, true)}</button>)}
        </div>
        <p className="muted small">{period === 'all' ? 'All time' : monthLabel(period)} · purchase {inr(pP)} · paid {inr(pPaid)}</p>
      </div>
      <section className="card flush">
        {shown.length === 0 ? <Empty>No entries yet. Add a purchase or a payment.</Empty> : (
          <table>
            <thead><tr><th>Date &amp; time</th><th>Type</th><th>Bill no.</th><th className="num">Purchase</th><th className="num">Payment</th><th className="num">Balance</th><th className="hide-sm">Note</th><th></th></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td>{dtm(e.entry_at)}</td>
                  <td>{e.kind === 'purchase' ? <Badge tone="red">Purchase</Badge> : <Badge tone="green">Payment{e.mode ? ` · ${PAY_MODES[e.mode] || e.mode}` : ''}</Badge>}</td>
                  <td>{e.bill_no || '—'}</td>
                  <td className="num">{e.kind === 'purchase' ? inr(e.amount) : ''}</td>
                  <td className="num">{e.kind === 'payment' ? inr(e.amount) : ''}</td>
                  <td className="num"><b>{inr(e.bal)}</b></td>
                  <td className="hide-sm">{e.note || '—'}</td>
                  <td className="row-actions"><button className="link" onClick={() => onEdit(e)}>Edit</button><button className="link danger" onClick={() => del(e)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="muted small">Balance = total purchase − total paid, after each entry.</p>
    </>
  );
}

// ---------- forms ----------
function PartyModals({ modal, setModal, done, parties }) {
  if (!modal) return null;
  const close = () => setModal(null);
  if (modal.partyForm) return <Modal title={modal.partyForm.id ? 'Edit party' : 'Add party'} onClose={close}><PartyForm p={modal.partyForm} onSaved={done} onCancel={close} /></Modal>;
  return (
    <Modal title={`${modal.entry ? 'Edit' : 'Add'} ${modal.kind === 'purchase' ? 'purchase' : 'payment to party'}`} onClose={close}>
      <PartyEntryForm kind={modal.kind} party={modal.party} entry={modal.entry} parties={parties} onSaved={done} onCancel={close} />
    </Modal>
  );
}

function PartyForm({ p, onSaved, onCancel }) {
  const [f, setF] = useState({ name: p.name || '', phone: p.phone || '', note: p.note || '', active: p.active ?? true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); e.stopPropagation();
    setBusy(true); setErr(null);
    const row = { ...f, name: f.name.trim(), phone: f.phone.trim() || null, note: f.note.trim() || null };
    const { error } = p.id ? await supabase.from('parties').update(row).eq('id', p.id) : await supabase.from('parties').insert(row);
    setBusy(false);
    if (error) setErr(/duplicate|unique/i.test(error.message) ? { message: 'A party with this name already exists.' } : error); else onSaved();
  };
  return (
    <form className="form" onSubmit={submit}>
      <ErrorBox error={err} />
      <label>Party name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus placeholder="e.g. A.B. Jewellers" /></label>
      <label>Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="numeric" /></label>
      <label>Note<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. address, GST no., what they supply" /></label>
      {p.id && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active party (untick to hide when nothing is due)</label>}
      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : p.id ? 'Update party' : 'Add party'}</button>
      </div>
    </form>
  );
}

export function PartyEntryForm({ kind: kind0, party, entry, parties: parties0, onSaved, onCancel }) {
  const [parties, setParties] = useState(parties0 || []);
  const [newParty, setNewParty] = useState(null);
  useEffect(() => { if (!parties0) supabase.from('parties').select('*').order('name').then(({ data }) => setParties(data || [])); }, [parties0]);
  const [kind, setKind] = useState(kind0);
  const [f, setF] = useState({
    party_id: party?.id || entry?.party_id || '',
    amount: entry?.amount ?? '', when: entry ? localDT(new Date(entry.entry_at)) : localDT(),
    bill_no: entry?.bill_no || '', mode: entry?.mode || 'cash', note: entry?.note || '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!f.party_id) { setErr({ message: 'Choose the party.' }); return; }
    if (!(Number(f.amount) > 0)) { setErr({ message: 'Enter the amount.' }); return; }
    setBusy(true); setErr(null);
    const row = { party_id: f.party_id, kind, amount: Number(f.amount), entry_at: new Date(f.when).toISOString(), bill_no: f.bill_no.trim() || null, mode: kind === 'payment' ? f.mode : null, note: f.note.trim() || null };
    const { error } = entry ? await supabase.from('party_entries').update(row).eq('id', entry.id) : await supabase.from('party_entries').insert(row);
    setBusy(false);
    if (error) setErr(error); else onSaved();
  };
  const active = parties.filter((p) => p.active !== false || p.id === f.party_id);
  const addParty = async () => {
    const name = (newParty || '').trim();
    if (!name) { setNewParty(null); return; }
    const found = parties.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (found) { setF({ ...f, party_id: found.id }); setNewParty(null); return; }
    const { data, error } = await supabase.from('parties').insert({ name }).select().single();
    if (error) { setErr(error); return; }
    setParties([...parties, data].sort((a, b) => a.name.localeCompare(b.name)));
    setF({ ...f, party_id: data.id }); setNewParty(null);
  };
  return (
    <form className="form" onSubmit={submit}>
      <ErrorBox error={err} />
      <div className="place-pick">
        <button type="button" className={kind === 'purchase' ? 'on' : ''} onClick={() => setKind('purchase')}>🧾 Purchase (bill from party)</button>
        <button type="button" className={kind === 'payment' ? 'on' : ''} onClick={() => setKind('payment')}>💸 Payment (I paid party)</button>
      </div>
      <label>Party
        <select value={f.party_id} onChange={set('party_id')} required>
          <option value="">— choose party —</option>
          {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {!party && (newParty === null
        ? <button type="button" className="chip add-chip start" onClick={() => setNewParty('')}>+ Add new party</button>
        : (
          <span className="colour-add">
            <input autoFocus value={newParty} onChange={(e) => setNewParty(e.target.value)} placeholder="New party name"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addParty(); } if (e.key === 'Escape') setNewParty(null); }} />
            <button type="button" className="btn small primary" onClick={addParty}>Add</button>
          </span>
        ))}
      <div className="grid2">
        <label>Amount (₹)<input type="number" min="1" step="any" value={f.amount} onChange={set('amount')} required autoFocus={Boolean(party)} /></label>
        <label>Date &amp; time<input type="datetime-local" value={f.when} onChange={set('when')} required /></label>
      </div>
      <div className="grid2">
        <label>{kind === 'purchase' ? 'Party bill no.' : 'Reference / slip no.'}<input value={f.bill_no} onChange={set('bill_no')} placeholder={kind === 'purchase' ? 'e.g. 1452' : 'e.g. UPI ref'} /></label>
        {kind === 'payment' ? (
          <label>Paid by<select value={f.mode} onChange={set('mode')}>{Object.entries(PAY_MODES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        ) : <span />}
      </div>
      <label>Note<input value={f.note} onChange={set('note')} placeholder={kind === 'purchase' ? 'e.g. 20 bangle sets, earrings' : 'e.g. part payment'} /></label>
      <div className="actions" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : entry ? 'Update' : `Save ${kind}`}</button>
      </div>
    </form>
  );
}
