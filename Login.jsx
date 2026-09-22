import { useState } from 'react';
import { supabase } from '../supabase';
import { ErrorBox } from '../components';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error);
    setBusy(false);
  };

  return (
    <div className="center">
      <form className="card narrow form" onSubmit={submit}>
        <div className="brand big"><span className="logo">SK</span> Sri Kangna CRM</div>
        <p className="muted">Sign in to continue</p>
        <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        <label>Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <ErrorBox error={error} />
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">Staff accounts are created by the owner in Supabase → Authentication → Users.</p>
      </form>
    </div>
  );
}
