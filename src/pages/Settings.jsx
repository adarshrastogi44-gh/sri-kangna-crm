import { useEffect, useState } from 'react';
import { ErrorBox, Loading, Modal, PinInput } from '../components';
import { hasDeletePin, loadSettings, must, pinOwnerInfo, resetDeletePin, sendPinResetCode, setDeletePin, verifyPinResetCode } from '../utils';
import { supabase } from '../supabase';

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
      <PinCard />
    </>
  );
}

function PinCard() {
  const [has, setHas] = useState(null);
  const [setupErr, setSetupErr] = useState(null);
  const [f, setF] = useState({ old: '', pin: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState('');
  const [forgot, setForgot] = useState(false);
  useEffect(() => { hasDeletePin().then(setHas).catch(setSetupErr); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setMsg('');
    if (f.pin !== f.again) { setError(new Error('The two new PINs do not match.')); return; }
    setBusy(true);
    try { await setDeletePin(has ? f.old : null, f.pin); setHas(true); setF({ old: '', pin: '', again: '' }); setMsg(has ? 'PIN changed' : 'PIN set'); }
    catch (x) { setError(x); } finally { setBusy(false); }
  };

  return (
    <section className="card narrow-card">
      <h2>Delete PIN</h2>
      <p className="muted small">Bills can only be deleted after entering this 4-digit PIN. Only share it with people allowed to delete bills.</p>
      {setupErr ? <ErrorBox error={setupErr} /> : has === null ? <p className="muted small">Checking…</p> : (
        <form className="form" onSubmit={submit} autoComplete="off">
          {has && <label>Current PIN<PinInput value={f.old} onChange={(v) => setF({ ...f, old: v })} /></label>}
          <div className="grid2">
            <label>{has ? 'New PIN' : 'Choose a 4-digit PIN'}<PinInput value={f.pin} onChange={(v) => setF({ ...f, pin: v })} /></label>
            <label>Type it again<PinInput value={f.again} onChange={(v) => setF({ ...f, again: v })} /></label>
          </div>
          <ErrorBox error={error} />
          <div className="form-actions">
            {msg && <span className="saved-msg">✓ {msg}</span>}
            {has && <button type="button" className="link" style={{ marginRight: 'auto' }} onClick={() => setForgot(true)}>Forgot PIN?</button>}
            <button className="btn primary" disabled={busy || f.pin.length !== 4 || f.again.length !== 4 || (has && f.old.length !== 4)}>{busy ? 'Saving…' : has ? 'Change PIN' : 'Set PIN'}</button>
          </div>
        </form>
      )}
      {forgot && <ForgotPin onClose={() => setForgot(false)} onDone={() => { setForgot(false); setMsg('PIN reset'); }} />}
    </section>
  );
}

function ForgotPin({ onClose, onDone }) {
  const [step, setStep] = useState('check');
  const [info, setInfo] = useState(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ data }, i] = await Promise.all([supabase.auth.getUser(), pinOwnerInfo()]);
        setEmail(data?.user?.email || '');
        setInfo(i);
        setStep(i.is_owner ? 'send' : 'notowner');
      } catch (x) { setError(x); setStep('error'); }
    })();
  }, []);

  const act = async (fn) => { setBusy(true); setError(null); try { await fn(); } catch (x) { setError(x); } finally { setBusy(false); } };

  return (
    <Modal title="Reset delete PIN" onClose={onClose}>
      <div className="form">
        {step === 'check' && <p className="muted">Checking…</p>}
        {step === 'notowner' && (
          <p>Only the owner can reset the PIN. Please sign in with the owner's account{info?.hint ? <> (<b>{info.hint}</b>)</> : ''} and try again.</p>
        )}
        {step === 'send' && (
          <>
            <p>We'll email a one-time code to <b>{email}</b>.</p>
            <div className="form-actions">
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={() => act(async () => { await sendPinResetCode(email); setStep('code'); })}>{busy ? 'Sending…' : 'Send code'}</button>
            </div>
          </>
        )}
        {step === 'code' && (
          <>
            <p>Enter the code from the email sent to <b>{email}</b>. It's valid for a few minutes.</p>
            <label>Code<input className="pin-input code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></label>
            <div className="form-actions">
              <button className="link" style={{ marginRight: 'auto' }} disabled={busy} onClick={() => act(() => sendPinResetCode(email))}>Send again</button>
              <button className="btn primary" disabled={busy || code.length < 6} onClick={() => act(async () => { await verifyPinResetCode(email, code); setStep('newpin'); })}>{busy ? 'Checking…' : 'Verify code'}</button>
            </div>
          </>
        )}
        {step === 'newpin' && (
          <>
            <p className="ok-text">✓ Code verified. Choose a new 4-digit PIN.</p>
            <div className="grid2">
              <label>New PIN<PinInput value={pin.a} onChange={(v) => setPin({ ...pin, a: v })} autoFocus /></label>
              <label>Type it again<PinInput value={pin.b} onChange={(v) => setPin({ ...pin, b: v })} /></label>
            </div>
            <div className="form-actions">
              <button className="btn primary" disabled={busy || pin.a.length !== 4 || pin.a !== pin.b} onClick={() => act(async () => { await resetDeletePin(pin.a); onDone(); })}>{busy ? 'Saving…' : 'Save new PIN'}</button>
            </div>
          </>
        )}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
