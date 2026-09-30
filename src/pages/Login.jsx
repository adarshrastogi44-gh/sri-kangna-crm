import { useState } from 'react';
import { supabase } from '../supabase';
import { ErrorBox } from '../components';

export const RESET_FLAG = 'sk-set-password';

export default function Login() {
  const [mode, setMode] = useState('login'); // login | forgot | code
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState('');

  const run = async (fn) => { setBusy(true); setError(null); try { await fn(); } catch (x) { setError(x); } setBusy(false); };

  const signIn = (e) => { e.preventDefault(); run(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }); };

  const sendCode = (e) => { e?.preventDefault(); run(async () => {
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/?reset=1` } });
    if (error) throw (/signups not allowed|not found/i.test(error.message) ? { message: 'No account with this email. Check the spelling.' } : error);
    setMode('code'); setInfo(`Email sent to ${email.trim()}. Open it on this computer and click “Sign in” — the CRM opens and asks for your new password. (Check Spam too.)`);
  }); };

  const verify = (e) => { e.preventDefault(); run(async () => {
    try { sessionStorage.setItem(RESET_FLAG, '1'); } catch { /* ignore */ }
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    if (error) { try { sessionStorage.removeItem(RESET_FLAG); } catch { /* ignore */ } throw (/expired|invalid/i.test(error.message) ? { message: 'Wrong or expired code. Try again or send a new code.' } : error); }
    // signed in → the app now shows the "Set new password" screen
  }); };

  return (
    <div className="center">
      <div className="card narrow">
        <div className="brand big"><span className="logo">SK</span> Sri Kangna CRM</div>

        {mode === 'login' && (
          <form className="form" onSubmit={signIn}>
            <p className="muted">Sign in to continue</p>
            <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
            <label>Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <ErrorBox error={error} />
            <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            <button type="button" className="link forgot-link" onClick={() => { setMode('forgot'); setError(null); }}>Forgot password?</button>
            <p className="muted small">Staff accounts are created by the owner in Supabase → Authentication → Users.</p>
          </form>
        )}

        {mode === 'forgot' && (
          <form className="form" onSubmit={sendCode}>
            <p className="muted">Enter your email. We’ll send a 6-digit code to reset your password.</p>
            <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
            <ErrorBox error={error} />
            <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send code to my email'}</button>
            <button type="button" className="link forgot-link" onClick={() => { setMode('login'); setError(null); }}>← Back to sign in</button>
          </form>
        )}

        {mode === 'code' && (
          <form className="form" onSubmit={verify}>
            <p className="notice">{info}</p>
            <p className="muted small" style={{ margin: 0 }}>If your email shows a 6-digit code instead of a link, type it here:</p>
            <label>Code<input className="pin-input code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus placeholder="••••••" /></label>
            <ErrorBox error={error} />
            <button className="btn primary" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Verify code'}</button>
            <div className="actions" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="link" onClick={sendCode} disabled={busy}>Send code again</button>
              <button type="button" className="link" onClick={() => { setMode('login'); setError(null); setCode(''); }}>← Back to sign in</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// Shown right after the email code is verified
export function SetNewPassword({ email, onDone }) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (p1.length < 6) { setError({ message: 'Password must be at least 6 characters.' }); return; }
    if (p1 !== p2) { setError({ message: 'The two passwords do not match.' }); return; }
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password: p1 });
    setBusy(false);
    if (error) { setError(error); return; }
    try { sessionStorage.removeItem(RESET_FLAG); } catch { /* ignore */ }
    alert('Password changed. Use the new password next time you sign in.');
    onDone();
  };
  return (
    <div className="center">
      <form className="card narrow form" onSubmit={submit}>
        <div className="brand big"><span className="logo">SK</span> Sri Kangna CRM</div>
        <h2 style={{ margin: 0 }}>Set a new password</h2>
        <p className="muted small">For {email}</p>
        <label>New password<input type="password" autoComplete="new-password" required value={p1} onChange={(e) => setP1(e.target.value)} autoFocus /></label>
        <label>Type it again<input type="password" autoComplete="new-password" required value={p2} onChange={(e) => setP2(e.target.value)} /></label>
        <ErrorBox error={error} />
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </div>
  );
}
