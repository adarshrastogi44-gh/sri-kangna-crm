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
  settingsCache = { ...DEFAULT_SETTINGS, ...(error ? {} : data || {}), _missing: Boolean(error), _hasTerms: Boolean(data && 'terms' in data) };
  return settingsCache;
}

export const DEFAULT_TERMS = [
  'Goods once sold will not be taken back.',
  'Exchange only within 7 days with this estimate and original tags.',
  'No exchange or return on sale / discounted items.',
  'Subject to local jurisdiction.',
].join('\n');
export const termsLines = (t) => (t || '').split('\n').map((x) => x.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);

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
  { key: 'points', label: 'Loyalty points balance' },
];
export function waText(key, { customer, shop, due = 0, bill, points, earned } = {}) {
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
    case 'points':
      return `Hi ${name}, you have ${points ?? 0} loyalty points at ${s} (1 point = Rs. 1). Use them as a discount on your next purchase!${earned ? ` You earned ${earned} points on your purchase today.` : ''}`;
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

// ---------- PIN-protected bill delete (see delete-pin-setup.sql) ----------
const pinSetupMsg = 'The delete PIN is not set up yet. Run delete-pin-setup.sql in Supabase → SQL Editor.';
const pinErr = (error) => new Error(/function .*does not exist|Could not find the function/i.test(error.message) ? pinSetupMsg : error.message);
export async function hasDeletePin() {
  const { data, error } = await supabase.rpc('has_delete_pin');
  if (error) throw pinErr(error);
  return Boolean(data);
}
export async function setDeletePin(oldPin, newPin) {
  const { error } = await supabase.rpc('set_delete_pin', { old_pin: oldPin || null, new_pin: newPin });
  if (error) throw pinErr(error);
}
export async function deleteBillWithPin(billId, pin) {
  const { error } = await supabase.rpc('delete_bill_with_pin', { p_bill: billId, p_pin: pin });
  if (error) throw pinErr(error);
}

// ---------- PIN recovery by email code (see pin-recovery-setup.sql) ----------
const recoverySetupMsg = 'PIN recovery is not set up yet. Run pin-recovery-setup.sql in Supabase → SQL Editor.';
const recErr = (error) => new Error(/function .*does not exist|Could not find the function/i.test(error.message) ? recoverySetupMsg : error.message);
export async function pinOwnerInfo() {
  const { data, error } = await supabase.rpc('pin_owner_info');
  if (error) throw recErr(error);
  return data || {};
}
export async function sendPinResetCode(email) {
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw error;
}
export async function verifyPinResetCode(email, token) {
  const { error } = await supabase.auth.verifyOtp({ email, token: token.trim(), type: 'email' });
  if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Send a new one.' : error.message);
}
export async function resetDeletePin(newPin) {
  const { error } = await supabase.rpc('reset_delete_pin', { new_pin: newPin });
  if (error) throw recErr(error);
}

// ---------- Loyalty points: 5% of every bill amount (rounded down) ----------
export const LOYALTY_RATE = 0.05;
export const pointsFor = (amount) => Math.floor(Number(amount || 0) * LOYALTY_RATE);
export const redeemedOf = (b) => Number(b.points_redeemed || 0);
// A bill with any discount (manual discount or points redeemed) earns no points
export const hasDiscount = (b) => redeemedOf(b) > 0 || /(^|\n)\s*\d+(\.\d+)?\s*[×x]\s*Discount\s*@/i.test(b.items || '');
export const billPoints = (b) => (hasDiscount(b) ? 0 : pointsFor(b.amount));
export const pointsEarned = (bills) => bills.reduce((s, b) => s + billPoints(b), 0);
export const pointsUsed = (bills) => bills.reduce((s, b) => s + redeemedOf(b), 0);
// Balance = points earned on all bills − points redeemed on bills (1 point = Rs. 1)
export const pointsTotal = (bills) => pointsEarned(bills) - pointsUsed(bills);
export async function customerBills(customerId) {
  return fetchAll(() => supabase.from('bills').select('*').eq('customer_id', customerId));
}
export async function customerPoints(customerId, excludeBillId) {
  const bills = await customerBills(customerId);
  return pointsTotal(bills.filter((b) => b.id !== excludeBillId));
}
let redeemCol = null;
export async function hasRedeemColumn() {
  if (redeemCol !== null) return redeemCol;
  const { error } = await supabase.from('bills').select('points_redeemed').limit(1);
  redeemCol = !error;
  return redeemCol;
}
