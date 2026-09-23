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

// ---------- Bill items ----------
// Stored in bills.items as one line per item: "2 × Cotton Suit @ 1500"
// A discount is stored as "1 × Discount @ -200"
const LINE_RE = /^\s*(\d+(?:\.\d+)?)\s*[×x]\s*(.+?)\s*@\s*(-?\d+(?:\.\d+)?)\s*$/;
export function parseItems(text) {
  if (!text) return { lines: [], ok: true };
  const raw = text.split('\n').map((s) => s.trim()).filter(Boolean);
  const lines = [];
  for (const r of raw) {
    const m = r.match(LINE_RE);
    if (!m) return { lines: [], ok: false };
    lines.push({ qty: Number(m[1]), name: m[2], rate: Number(m[3]) });
  }
  return { lines, ok: true };
}
export const formatItems = (lines) => lines.map((l) => `${l.qty} × ${l.name} @ ${l.rate}`).join('\n');
export const itemsSummary = (text) => {
  const { lines, ok } = parseItems(text);
  if (!ok) return (text || '').split('\n').filter(Boolean).join(', ');
  return lines.filter((l) => l.name !== 'Discount').map((l) => `${l.qty} × ${l.name}`).join(', ');
};
export const billNo = (b) => 'EST-' + String(b.id || '').replace(/-/g, '').slice(0, 6).toUpperCase();

// ---------- Shop settings & products ----------
const DEFAULT_SETTINGS = { shop_name: 'Sri Kangna', address: '', phone: '', gstin: '', bill_footer: 'Thank you for shopping with us!' };
let settingsCache = null;
export async function loadSettings(force = false) {
  if (settingsCache && !force) return settingsCache;
  const { data, error } = await supabase.from('shop_settings').select('*').eq('id', 1).maybeSingle();
  settingsCache = { ...DEFAULT_SETTINGS, ...(error ? {} : data || {}), _missing: Boolean(error) };
  return settingsCache;
}

export async function loadProducts() {
  const { data, error } = await supabase.from('products').select('*').order('name');
  if (error) throw error;
  return data || [];
}

let tagsCol = null;
export async function hasTagsColumn() {
  if (tagsCol !== null) return tagsCol;
  const { error } = await supabase.from('customers').select('tags').limit(1);
  tagsCol = !error;
  return tagsCol;
}
export const TAG_PRESETS = ['VIP', 'Regular', 'Wholesale', 'New'];

// ---------- WhatsApp templates ----------
export const WA_TEMPLATES = [
  { key: 'thanks', label: 'Thank you for shopping' },
  { key: 'due', label: 'Payment reminder' },
  { key: 'birthday', label: 'Birthday wish' },
  { key: 'anniversary', label: 'Anniversary wish' },
  { key: 'collection', label: 'New collection arrived' },
];
export function waText(key, { customer, shop, due = 0, bill } = {}) {
  const name = (customer?.name || '').split(' ')[0] || 'there';
  const s = shop?.shop_name || 'Sri Kangna';
  switch (key) {
    case 'thanks':
      return `Hi ${name}, thank you for shopping at ${s}!${bill ? ` Your estimate ${billNo(bill)} of ${inr(bill.amount)}${dueOf(bill) > 0 ? ` (balance due ${inr(dueOf(bill))})` : ''} is recorded.` : ''} We hope to see you again soon.`;
    case 'due':
      return `Hi ${name}, this is a gentle reminder from ${s} that ${inr(due)} is pending on your account. Please clear it at your convenience. Thank you!`;
    case 'birthday':
      return `Happy Birthday ${name}! 🎉 Wishing you a wonderful year ahead. Visit ${s} this week for a special birthday surprise!`;
    case 'anniversary':
      return `Happy Anniversary ${name}! 💐 Warm wishes from all of us at ${s}.`;
    case 'collection':
      return `Hi ${name}, our new collection has just arrived at ${s}! Drop by to see it before it's gone.`;
    default:
      return '';
  }
}
export function waSend(phone, text) {
  const base = waLink(phone);
  if (!base) return null;
  return `${base}?text=${encodeURIComponent(text)}`;
}

// Insert visits; if the database rejects the visit type (check constraint), retry without it
export async function insertVisits(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  let { error } = await supabase.from('visits').insert(list);
  if (error && (error.code === '23514' || /visit_type/i.test(error.message))) {
    ({ error } = await supabase.from('visits').insert(list.map(({ visit_type, ...r }) => r)));
  }
  if (error) throw error;
}
