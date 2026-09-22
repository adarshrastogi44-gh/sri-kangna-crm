import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { ErrorBox, Loading } from '../components';
import { loadSettings, must } from '../utils';

export default function Settings() {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { loadSettings(true).then(setF); }, []);
  if (!f) return <Loading />;
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setMsg(''); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const row = { id: 1, shop_name: f.shop_name, address: f.address || null, phone: f.phone || null, bill_footer: f.bill_footer || null };
      must(await supabase.from('shop_settings').upsert(row));
      await loadSettings(true);
      setMsg('Saved');
    } catch (x) { setError(x); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head"><h1>Shop settings</h1></div>
      {f._missing && <div className="error">Settings aren't set up yet. Run <b>setup-extra.sql</b> in Supabase → SQL Editor, then refresh.</div>}
      <section className="card narrow-card">
        <p className="muted small">These details are printed on estimates and used in WhatsApp messages.</p>
        <form className="form" onSubmit={submit}>
          <label>Shop name *<input required value={f.shop_name || ''} onChange={set('shop_name')} /></label>
          <label>Address<textarea rows="2" value={f.address || ''} onChange={set('address')} /></label>
          <label>Phone<input value={f.phone || ''} onChange={set('phone')} /></label>
          <label>Message at the bottom of estimates<input value={f.bill_footer || ''} onChange={set('bill_footer')} /></label>
          <ErrorBox error={error} />
          <div className="form-actions">
            {msg && <span className="saved-msg">✓ {msg}</span>}
            <button className="btn primary" disabled={busy || f._missing}>{busy ? 'Saving…' : 'Save settings'}</button>
          </div>
        </form>
      </section>
    </>
  );
}
