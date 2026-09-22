import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { Badge, Empty, ErrorBox, Loading, Modal } from '../components';
import { loadProducts, must } from '../utils';

export default function Items() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { setErr(null); loadProducts().then(setList).catch((e) => { setErr(e); setList([]); }); }, [tick]);

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
      <input className="search" placeholder="Search items or category…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list ? <Loading /> : (
        <section className="card flush">
          {shown.length === 0 ? <Empty>{list.length ? 'No matching items.' : 'No items yet. Add your first item.'}</Empty> : (
            <table>
              <thead><tr><th>Item</th><th>Status</th></tr></thead>
              {groups.map(([cat, items]) => (
                <tbody key={cat}>
                  <tr className="group-row"><td colSpan="2">{cat} <span className="muted">· {items.length}</span></td></tr>
                  {items.map((p) => (
                    <tr key={p.id} className="click" onClick={() => setEdit(p)}>
                      <td><strong>{p.name}</strong></td>
                      <td>{p.active === false ? <Badge>Hidden</Badge> : <Badge tone="green">Active</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          )}
        </section>
      )}
      {edit && <Modal title={edit.id ? 'Edit item' : 'New item'} onClose={() => setEdit(null)}><ItemForm item={edit} cats={[...new Set((list || []).map((p) => p.category).filter(Boolean))].sort()} onSaved={done} onCancel={() => setEdit(null)} /></Modal>}
    </>
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
