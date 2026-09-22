import { useState } from 'react';
import { supabase } from '../supabase';
import { ErrorBox } from '../components';
import { fetchAll, hasTagsColumn, inr, invalidateCustomers, loadCustomers, must } from '../utils';
import { cleanPhone, parseCSV } from './ImportCustomers';

// Imports the CSV exports of the old "Kangna CRM" (Settings → Export):
//   customers-*.csv : id,name,mobile,birthday,anniversary,area,gender,customerSince,...
//   bills-*.csv     : id,billNo,date,amount,category,customerId,customerName
//   inventory-*.csv : id,name,brand,category,unitType,ratePerUnit,quantity,lowStockThreshold
const day = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const cap = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');
const OLD_BILL = 'Old bill no: ';

function detect(rows) {
  const h = Object.keys(rows[0] || {});
  if (h.includes('mobile') && h.includes('customerSince')) return 'customers';
  if (h.includes('billNo') && h.includes('customerId')) return 'bills';
  if (h.includes('unitType') || (h.includes('brand') && h.includes('category'))) return 'inventory';
  return null;
}

export default function ImportOldCrm({ user, onDone, onCancel }) {
  const [files, setFiles] = useState({});
  const [plan, setPlan] = useState(null);
  const [withItems, setWithItems] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const onFiles = async (e) => {
    setError(null); setPlan(null);
    try {
      const next = { ...files };
      for (const f of e.target.files) {
        const rows = parseCSV((await f.text()).replace(/^﻿/, ''));
        const kind = detect(rows);
        if (!kind) throw new Error(`"${f.name}" doesn't look like an export from the old CRM.`);
        next[kind] = { name: f.name, rows };
      }
      setFiles(next);
      if (next.customers) await buildPlan(next);
    } catch (x) { setError(x); }
  };

  const buildPlan = async (f) => {
    setProgress('Checking what is already in this CRM…');
    invalidateCustomers();
    const existing = await loadCustomers();
    const byPhone = new Map(existing.filter((c) => c.phone).map((c) => [cleanPhone(c.phone), c.id]));
    const oldBills = new Set((await fetchAll(() => supabase.from('bills').select('notes').like('notes', `${OLD_BILL}%`))).map((b) => b.notes.slice(OLD_BILL.length).split('\n')[0].trim()));
    let productNames = null;
    if (f.inventory) {
      try { productNames = new Set((await fetchAll(() => supabase.from('products').select('name'))).map((p) => p.name.trim().toLowerCase())); }
      catch { productNames = null; }
    }

    const newCustomers = []; const matched = {};
    for (const c of f.customers.rows) {
      const phone = cleanPhone(c.mobile);
      if (phone && byPhone.has(phone)) { matched[c.id] = byPhone.get(phone); continue; }
      newCustomers.push(c);
    }
    const oldIds = new Set(f.customers.rows.map((c) => c.id));
    const bills = (f.bills?.rows || []).filter((b) => oldIds.has(b.customerId) && !oldBills.has(b.billNo) && day(b.date));
    const skippedBills = (f.bills?.rows.length || 0) - bills.length;
    const items = f.inventory && productNames
      ? f.inventory.rows.filter((i) => i.name.trim() && !productNames.has(i.name.trim().toLowerCase()))
      : [];
    setPlan({ newCustomers, matched, bills, skippedBills, items, itemsTableMissing: Boolean(f.inventory) && !productNames });
    setProgress('');
  };

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const idMap = { ...plan.matched };
      const tagsOk = await hasTagsColumn();
      // 1) customers
      const rows = plan.newCustomers.map((c) => {
        const notes = [c.gender && `Gender: ${cap(c.gender)}`, 'Imported from old CRM'].filter(Boolean).join(' · ');
        const r = {
          name: c.name.trim(),
          phone: cleanPhone(c.mobile),
          address: c.area?.trim() || null,
          date_of_birth: day(c.birthday),
          anniversary: day(c.anniversary),
          notes,
          created_at: c.customerSince || undefined,
        };
        if (tagsOk) r.tags = [];
        return r;
      });
      for (let i = 0; i < rows.length; i += 200) {
        setProgress(`Customers: ${Math.min(i + 200, rows.length)} of ${rows.length}…`);
        // Phone numbers that already exist are skipped instead of stopping the import
        must(await supabase.from('customers').upsert(rows.slice(i, i + 200), { onConflict: 'phone', ignoreDuplicates: true }));
      }
      invalidateCustomers();
      const all = await loadCustomers();
      const byPhone = new Map(all.filter((c) => c.phone).map((c) => [cleanPhone(c.phone), c.id]));
      let missing = 0;
      for (const c of files.customers.rows) {
        const id = byPhone.get(cleanPhone(c.mobile));
        if (id) idMap[c.id] = id; else missing += 1;
      }
      if (missing > 0 && missing === files.customers.rows.length) {
        throw new Error('The customers could not be read back after saving. Please check that you are signed in, then try again.');
      }

      // 2) bills (old CRM had no separate payment info, so bills are marked paid)
      const billRows = plan.bills.filter((b) => idMap[b.customerId]).map((b) => ({
        customer_id: idMap[b.customerId],
        bill_date: day(b.date),
        amount: Number(b.amount || 0),
        paid_amount: Number(b.amount || 0),
        payment_status: 'paid',
        items: b.category || null,
        notes: `${OLD_BILL}${b.billNo}`,
        created_by: user.id,
      }));
      for (let i = 0; i < billRows.length; i += 200) {
        setProgress(`Bills: ${Math.min(i + 200, billRows.length)} of ${billRows.length}…`);
        must(await supabase.from('bills').insert(billRows.slice(i, i + 200)));
      }

      // 3) visits — in the old CRM every bill was a visit; one visit per customer per day
      const have = new Set((await fetchAll(() => supabase.from('visits').select('customer_id,visit_date'))).map((v) => `${v.customer_id}|${v.visit_date}`));
      const visitRows = [];
      for (const b of billRows) {
        const k = `${b.customer_id}|${b.bill_date}`;
        if (have.has(k)) continue;
        have.add(k);
        visitRows.push({ customer_id: b.customer_id, visit_date: b.bill_date, visit_type: 'Purchase', notes: 'Imported from old CRM', created_by: user.id });
      }
      for (let i = 0; i < visitRows.length; i += 200) {
        setProgress(`Visits: ${Math.min(i + 200, visitRows.length)} of ${visitRows.length}…`);
        must(await supabase.from('visits').insert(visitRows.slice(i, i + 200)));
      }

      // 4) items (name + category only)
      let itemCount = 0;
      if (withItems && plan.items.length) {
        const itemRows = plan.items.map((it) => ({ name: it.name.trim().replace(/[@\n]/g, ' '), category: it.category?.trim() || null, active: true }));
        for (let i = 0; i < itemRows.length; i += 500) {
          setProgress(`Items: ${Math.min(i + 500, itemRows.length)} of ${itemRows.length}…`);
          must(await supabase.from('products').insert(itemRows.slice(i, i + 500)));
        }
        itemCount = itemRows.length;
      }
      setProgress('');
      onDone({ customers: rows.length, bills: billRows.length, visits: visitRows.length, items: itemCount });
    } catch (x) { setError(x); setProgress(''); } finally { setBusy(false); }
  };

  const billTotal = plan ? plan.bills.reduce((s, b) => s + Number(b.amount || 0), 0) : 0;

  return (
    <div className="form">
      <p className="muted small">
        In the old CRM go to <b>Settings → Export</b> and download <b>Customers</b>, <b>Bills</b> and (optional) <b>Inventory</b>.
        Then select all the files here together. Nothing is saved until you click Import. Customers whose phone number is already here,
        and bills already imported before, are skipped, so it is safe to run again.
      </p>
      <label>Choose the exported CSV files<input type="file" accept=".csv" multiple onChange={onFiles} /></label>
      <div className="import-summary">
        {['customers', 'bills', 'inventory'].map((k) => (
          <div key={k} className={files[k] ? 'ok-text' : 'muted'}>{files[k] ? '✓' : '○'} {k[0].toUpperCase() + k.slice(1)}: {files[k] ? `${files[k].name} (${files[k].rows.length} rows)` : k === 'customers' ? 'needed' : 'optional'}</div>
        ))}
      </div>
      {plan && (
        <div className="import-summary">
          <div><b>{plan.newCustomers.length}</b> new customers{Object.keys(plan.matched).length > 0 && <span className="muted"> · {Object.keys(plan.matched).length} already here (their bills will be added to them)</span>}</div>
          {files.bills && <div><b>{plan.bills.length}</b> bills worth <b>{inr(billTotal)}</b> + matching visits{plan.skippedBills > 0 && <span className="muted"> · {plan.skippedBills} already imported, skipped</span>}</div>}
          {files.inventory && (plan.itemsTableMissing
            ? <div className="muted">Items can't be imported yet: run setup-extra.sql in Supabase first.</div>
            : <label className="check"><input type="checkbox" checked={withItems} onChange={(e) => setWithItems(e.target.checked)} /> Add <b>{plan.items.length}</b> inventory items to the Items list (name + category)</label>)}
          <div className="muted small">Old bills are saved as fully paid (the old CRM didn't record dues). Each old bill number is kept in the bill's notes.</div>
        </div>
      )}
      <ErrorBox error={error} />
      <div className="form-actions">
        {progress && <span className="muted small">{progress}</span>}
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy || !plan} onClick={run}>{busy ? 'Importing…' : 'Import'}</button>
      </div>
    </div>
  );
}
