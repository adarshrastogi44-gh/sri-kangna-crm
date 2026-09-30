import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Every request gives up after 25 seconds instead of waiting forever
const fetchWithTimeout = (input, init = {}) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  if (init.signal) init.signal.addEventListener('abort', () => ctrl.abort());
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
};

export const configOk = Boolean(url && key);
export const supabase = configOk
  ? createClient(url, key, {
    // With the CRM open in more than one tab, the browser's login "lock" can get stuck and pages stay on "Loading…".
    // Skipping that lock fixes it (each tab still keeps you signed in).
    auth: { persistSession: true, autoRefreshToken: true, lock: async (_name, _timeout, fn) => fn() },
    global: { fetch: fetchWithTimeout },
  })
  : null;
