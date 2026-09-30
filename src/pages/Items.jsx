import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, Empty, ErrorBox, Loading, Modal } from '../components';
import { customerMap, fetchAll, fmtDate, inr, loadProducts, monthKey, must, parseItems, today, addDays } from '../utils';

// Every sold line from all bills: { name, qty, rate, date, bill, customer }
function soldLines(bills, cmap) {
  const out = [];
  bills.forEach((b) => {
    const { lines, ok } = parseItems(b.items);
    if (!ok) return;
    lines.filter((l) => l.name !== 'Discount').forEach((l) => out.push({ key: l.name.trim().toLowerCase(), name: l.name, qty: l.qty, rate: l.rate, date: b.bill_date, bill: b, c: cmap[b.customer_id] }));
  });
  return out;
}
const PERIODS = [['all', 'All time'], ['month', 'This month'], ['30', 'Last 30 days'], ['today', 'Today']];
const periodStart = (p) => (p === 'today' ? today() : p === 'month' ? `${monthKey()}-01` : p === '30' ? addDays(-29) : '');

export default function Items() {
  const [sales, setSales] = useState(null);
  const [period, setPeriod] = useState('all');
  const [openItem, setOpenItem] = useState(null);
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { setErr(null); loadProducts().then(setList).catch((e) => { setErr(e); setList([]); }); }, [tick]);
  useEffect(() => {
    Promise.all([fetchAll(() => supabase.from('bills').select('id,customer_id,bill_date,items')), customerMap()])
      .then(([bills, cmap]) => setSales(soldLines(bills, cmap))).catch(() => setSales([]));
  }, [tick]);
  const from = periodStart(period);
  const inPeriod = (sales || []).filter((x) => !from || x.date >= from);
  const sold = inPeriod.reduce((g, x) => { (g[x.key] ||= { pcs: 0, amt: 0, last: '' }); g[x.key].pcs += x.qty; g[x.key].amt += x.qty * x.rate; if (x.date > g[x.key].last) g[x.key].last = x.date; return g; }, {});
  const soldOf = (name) => sold[name.trim().toLowerCase()] || { pcs: 0, amt: 0, last: '' };

  const ql = q.trim().toLowerCase();
  const shown = (list || []).filter((p) => !ql || p.name.toLowerCase().includes(ql) || (p.category || '').toLowerCase().includes(ql));
  const groups = Object.entries(shown.reduce((g, p) => { const k = p.category || 'Other'; (g[k] ||= []).push(p); return g; }, {}))
    .sort(([x], [y]) => (x === 'Other') - (y === 'Other') || x.localeCompare(y));
  const done = () => { setEdit(null); setTick((t) => t + 1); };

  return (
    <>
      <div className="page-head">
        <h1>Items <span className="muted light">· {list ? list.length : ''}</span></h1>
        <div className="actions"><button className="btn primary" onClick={() => setEdit({})} disabled={Boolean(err)}>+ New item</button></div>
      </div>
      {err && (
        <div className="error">
          The item list isn't set up yet. Open Supabase → SQL Editor, run the file <b>setup-extra.sql</b> from the download, then refresh this page.
          <div className="small">({err.message})</div>
        </div>
      )}
      <p className="muted small">Items you add here appear in the list (grouped by category) when you create a bill. You enter the quantity and price on each bill.</p>
      <div className="toolbar">
        <input className="search rent-search" placeholder="Search items or category…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="tabs">{PERIODS.map(([k, l]) => <button key={k} className={period === k ? 'active' : ''} onClick={() => setPeriod(k)}>{l}</button>)}</div>
      </div>
      <p className="muted small">Pcs sold are counted from your bills. Click an item to see when it was sold and to whom.</p>
      {!list ? <Loading /> : (
        <section className="card flush">
          {shown.length === 0 ? <Empty>{list.length ? 'No matching items.' : 'No items yet. Add your first item.'}</Empty> : (
            <table>
              <thead><tr><th>Item</th><th className="num">Pcs sold</th><th className="num hide-sm">Sale value</th><th className="hide-sm">Last sold</th><th>Status</th><th></th></tr></thead>
              {groups.map(([cat, items]) => (
                <tbody key={cat}>
                  <tr className="group-row"><td colSpan="6">{cat} <span className="muted">· {items.length} items · {items.reduce((t, p) => t + soldOf(p.name).pcs, 0)} pcs sold</span></td></tr>
                  {items.map((p) => (
                    <tr key={p.id} className="click" onClick={() => setOpenItem(p)}>
                      <td><strong>{p.name}</strong></td>
                      <td className="num"><b className="pcs">{soldOf(p.name).pcs}</b> <span className="muted small">pcs</span></td>
                      <td className="num hide-sm">{inr(soldOf(p.name).amt)}</td>
                      <td className="hide-sm">{soldOf(p.name).last ? fmtDate(soldOf(p.name).last) : '—'}</td>
                      <td>{p.active === false ? <Badge>Hidden</Badge> : <Badge tone="green">Active</Badge>}</td>
                      <td className="row-actions" onClick={(e) => e.stopPropagation()}><button className="link" onClick={() => setEdit(p)}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          )}
        </section>
      )}
      {openItem && (
        <Modal title={`${openItem.name} — sales`} onClose={() => setOpenItem(null)}>
          <ItemSales item={openItem} lines={inPeriod.filter((x) => x.key === openItem.name.trim().toLowerCase())} period={PERIODS.find(([k]) => k === period)[1]} />
        </Modal>
      )}
      {edit && <Modal title={edit.id ? 'Edit item' : 'New item'} onClose={() => setEdit(null)}><ItemForm item={edit} cats={[...new Set((list || []).map((p) => p.category).filter(Boolean))].sort()} onSaved={done} onCancel={() => setEdit(null)} /></Modal>}
    </>
  );
}

function ItemSales({ item, lines, period }) {
  const rows = [...lines].sort((a, b) => b.date.localeCompare(a.date));
  const pcs = rows.reduce((t, x) => t + x.qty, 0);
  const amt = rows.reduce((t, x) => t + x.qty * x.rate, 0);
  return (
    <div className="item-sales">
      <div className="stats">
        <div className="stat"><div className="stat-label">Pcs sold · {period}</div><div className="stat-value">{pcs}</div></div>
        <div className="stat"><div className="stat-label">Sale value</div><div className="stat-value">{inr(amt)}</div></div>
        <div className="stat"><div className="stat-label">Customers</div><div className="stat-value">{new Set(rows.map((x) => x.bill.customer_id)).size}</div></div>
      </div>
      {rows.length === 0 ? <Empty>Not sold {period === 'All time' ? 'yet' : 'in this period'}.</Empty> : (
        <table>
          <thead><tr><th>Date</th><th>Sold to</th><th className="num">Pcs</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {rows.map((x, i) => (
              <tr key={i}>
                <td>{fmtDate(x.date)}</td>
                <td><strong>{x.c?.name || 'Unknown'}</strong>{x.c?.phone && <div className="muted small">{x.c.phone}</div>}</td>
                <td className="num"><b>{x.qty}</b></td>
                <td className="num">{inr(x.rate)}</td>
                <td className="num">{inr(x.qty * x.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">{item.category || 'No category'}</p>
    </div>
  );
}

function ItemForm({ item, cats, onSaved, onCancel }) {
  const [f, setF] = useState({ name: item.name || '', category: item.category || '', active: item.active !== false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const row = { name: f.name.trim().replace(/[@\n]/g, ' '), category: f.category.trim() || null, active: f.active };
      if (item.id) must(await supabase.from('products').update(row).eq('id', item.id));
      else must(await supabase.from('products').insert(row));
      onSaved();
    } catch (x) { setError(x); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${item.name}"? Old bills keep their item text.`)) return;
    const { error } = await supabase.from('products').delete().eq('id', item.id);
    if (error) setError(error); else onSaved();
  };
  return (
    <form className="form" onSubmit={submit}>
      <label>Item name *<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
      <label>Category
        <input list="item-cats" placeholder="e.g. Suits, Sarees, Dupattas" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <datalist id="item-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Show this item when making bills</label>
      <ErrorBox error={error} />
      <div className="form-actions">
        {item.id && <button type="button" className="btn ghost danger-text" onClick={remove}>Delete</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
