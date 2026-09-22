import { supabase } from './supabase';

const pad = (n) => String(n).padStart(2, '0');

export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

// Months are handled as 'YYYY-MM' keys
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + n, 1));
};
// [first day of month, first day of next month]
export const monthRange = (key) => [`${key}-01`, `${addMonths(key, 1)}-01`];
export const monthLabel = (key, short = false) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: short ? 'short' : 'long', year: 'numeric' });
};

export const fmtDate = (s) => {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const dueOf = (b) => Math.max(0, Number(b.amount || 0) - Number(b.paid_amount || 0));
export const statusFor = (amount, paid) =>
  amount > 0 && paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

export const waLink = (phone) => {
  const d = (phone || '').replace(/\D/g, '');
  if (!d) return null;
  return 'https://wa.me/' + (d.length === 10 ? '91' + d : d);
};

// Days from today until the next yearly occurrence of a date (birthday / anniversary)
export const daysUntil = (dateStr) => {
  const [, m, d] = dateStr.split('-').map(Number);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  let t = new Date(now.getFullYear(), m - 1, d);
  if (t < now) t = new Date(now.getFullYear() + 1, m - 1, d);
  return Math.round((t - now) / 86400000);
};

export const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// Supabase returns max 1000 rows per request, so page through everything
export async function fetchAll(build) {
  const size = 1000;
  let from = 0;
  let out = [];
  for (;;) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < size) break;
    from += size;
  }
  return out;
}

export function downloadCSV(filename, header, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Customer list cache shared by pages and pickers
let customerCache = null;
export const invalidateCustomers = () => { customerCache = null; };
export async function loadCustomers() {
  if (!customerCache) customerCache = fetchAll(() => supabase.from('customers').select('*').order('name'));
  try {
    return await customerCache;
  } catch (e) {
    customerCache = null;
    throw e;
  }
}
export async function customerMap() {
  const list = await loadCustomers();
  return Object.fromEntries(list.map((c) => [c.id, c]));
}
