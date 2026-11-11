import { useEffect, useState } from 'react';
import { Modal, PinInput } from './components';
import { checkStaffPin, hasStaffPin } from './utils';

// ---------- Sale figures lock (whole CRM) ----------
// Total sale figures are hidden everywhere until the password (same as the Staff page) is entered.
// Once unlocked they stay visible in this tab until: 🔒 Lock is clicked, the page is refreshed,
// or 10 minutes pass.
const AUTO_LOCK_MS = 10 * 60 * 1000;
let unlocked = false;
let timer = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f(unlocked));
export function lockSales() { unlocked = false; clearTimeout(timer); emit(); }
function unlockSales() { unlocked = true; clearTimeout(timer); timer = setTimeout(lockSales, AUTO_LOCK_MS); emit(); }

let opener = null; // set by <SalesLockModal />
export const askSalesPassword = () => { if (unlocked) return; opener?.(); };

export function useSalesUnlocked() {
  const [u, setU] = useState(unlocked);
  useEffect(() => { subs.add(setU); setU(unlocked); return () => { subs.delete(setU); }; }, []);
  return u;
}

// A money figure: shows ●●●●●● until unlocked; click the dots to enter the password
export function Hidden({ children, dots = '●●●●●●' }) {
  const u = useSalesUnlocked();
  if (u) return <>{children}</>;
  return <button type="button" className="hidden-fig" title="Enter password to see" onClick={(e) => { e.stopPropagation(); askSalesPassword(); }}>{dots}</button>;
}

// A whole section (charts, reports, cash counter): locked box until unlocked
export function SalesGate({ title = 'Sale figures are hidden', children }) {
  const u = useSalesUnlocked();
  if (u) return <>{children}</>;
  return (
    <button type="button" className="card charts-locked" onClick={askSalesPassword}>
      🔒 {title} · <b>click and enter password to see</b>
    </button>
  );
}

// 👁 / 🔒 button for page headers
export function SalesEye() {
  const u = useSalesUnlocked();
  return (
    <button type="button" className="btn small sales-eye" onClick={() => (u ? lockSales() : askSalesPassword())} title={u ? 'Hide sale figures' : 'Show sale figures (password)'}>
      {u ? '🔒 Hide sales' : '👁 Show sales'}
    </button>
  );
}

// Mounted once (in App): the password box
export function SalesLockModal() {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [noPin, setNoPin] = useState(false);
  useEffect(() => {
    opener = () => { setPin(''); setMsg(''); setNoPin(false); setOpen(true); hasStaffPin().then((h) => setNoPin(!h)).catch((e) => setMsg(e.message)); };
    return () => { opener = null; };
  }, []);
  if (!open) return null;
  const go = async (p = pin) => {
    if (p.length !== 4 || busy) return;
    setBusy(true); setMsg('');
    try {
      if (await checkStaffPin(p)) { unlockSales(); setOpen(false); } else { setMsg('Wrong password. Try again.'); setPin(''); }
    } catch (e) { setMsg(e.message || String(e)); setPin(''); }
    setBusy(false);
  };
  return (
    <Modal title="🔒 Password to see sales" onClose={() => setOpen(false)}>
      {noPin ? (
        <div className="form">
          <p>No password is set yet. Open the <b>Staff</b> page once and set the 4-digit password there — the same password is used to see sale figures.</p>
          <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => setOpen(false)}>OK</button></div>
        </div>
      ) : (
        <form className="form lock-card-inline" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <p className="muted small">Enter the 4-digit password (same as the Staff page). Sale figures stay visible for 10 minutes, or until you click 🔒 Hide sales.</p>
          <PinInput value={pin} autoFocus onChange={(v) => { setPin(v); setMsg(''); if (v.length === 4) go(v); }} />
          {msg && <div className="error-text">{msg}</div>}
          <div className="actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary" disabled={busy || pin.length !== 4}>{busy ? 'Checking…' : 'Show'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
