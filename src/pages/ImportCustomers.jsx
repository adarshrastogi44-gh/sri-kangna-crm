import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { ErrorBox } from '../components';
import { downloadCSV, hasTagsColumn, invalidateCustomers, loadCustomers, must, ymd } from '../utils';

const FIELDS = {
  name: ['name', 'customername', 'fullname', 'customer', 'clientname'],
  phone: ['phone', 'mobile', 'phonenumber', 'mobilenumber', 'mobileno', 'phoneno', 'contact', 'contactnumber', 'whatsapp'],
  email: ['email', 'emailid', 'mail'],
  address: ['address', 'city', 'location'],
  date_of_birth: ['dob', 'dateofbirth', 'birthday', 'birthdate'],
  anniversary: ['anniversary', 'anniversarydate', 'marriageanniversary'],
  notes: ['notes', 'note', 'remarks', 'comment', 'comments'],
  tags: ['tags', 'tag', 'category', 'type', 'group'],
};
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const cleanPhone = (p) => {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d || null;
};
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return ymd(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // DD/MM/YYYY (Indian format)
  if (m) {
    let y = Number(m[3]); if (y < 100) y += y > 30 ? 1900 : 2000;
    const d = Number(m[1]), mo = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}
function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head = [], ...body] = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
async function readFile(file) {
  if (/\.csv$/i.test(file.name)) return parseCSV((await file.text()).replace(/^﻿/, ''));
  const XLSX = await import(/* @vite-ignore */ 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
}

export default function ImportCustomers({ onDone, onCancel }) {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [tagsOk, setTagsOk] = useState(false);
  useEffect(() => { hasTagsColumn().then(setTagsOk); }, []);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setRows(null); setFileName(file.name);
    try {
      const raw = await readFile(file);
      if (!raw.length) throw new Error('No rows found in this file.');
      const headers = Object.keys(raw[0]);
      const map = {};
      for (const [field, names] of Object.entries(FIELDS)) {
        const h = headers.find((x) => names.includes(norm(x)));
        if (h) map[field] = h;
      }
      if (!map.name) throw new Error(`Couldn't find a "Name" column. Columns found: ${headers.join(', ')}`);
      const existing = await loadCustomers();
      const known = new Set(existing.map((c) => cleanPhone(c.phone)).filter(Boolean));
      const seen = new Set();
      const out = raw.map((r) => {
        const name = String(r[map.name] ?? '').trim();
        const phone = map.phone ? cleanPhone(r[map.phone]) : null;
        const c = {
          name,
          phone,
          email: map.email ? String(r[map.email] || '').trim() || null : null,
          address: map.address ? String(r[map.address] || '').trim() || null : null,
          date_of_birth: map.date_of_birth ? toDate(r[map.date_of_birth]) : null,
          anniversary: map.anniversary ? toDate(r[map.anniversary]) : null,
          notes: map.notes ? String(r[map.notes] || '').trim() || null : null,
        };
        if (map.tags) c.tags = String(r[map.tags] || '').split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
        let skip = '';
        if (!name) skip = 'No name';
        else if (phone && known.has(phone)) skip = 'Already exists';
        else if (phone && seen.has(phone)) skip = 'Duplicate in file';
        if (phone) seen.add(phone);
        return { c, skip };
      });
      setRows({ out, map });
    } catch (x) { setError(x); }
  };

  const ok = rows ? rows.out.filter((r) => !r.skip) : [];
  const skipped = rows ? rows.out.filter((r) => r.skip) : [];

  const doImport = async () => {
    setBusy(true); setError(null);
    try {
      const data = ok.map((r) => { const c = { ...r.c }; if (!tagsOk) delete c.tags; return c; });
      for (let i = 0; i < data.length; i += 200) {
        setProgress(`Importing ${Math.min(i + 200, data.length)} of ${data.length}…`);
        must(await supabase.from('customers').insert(data.slice(i, i + 200)));
      }
      invalidateCustomers();
      onDone(data.length);
    } catch (x) { setError(x); setProgress(''); } finally { setBusy(false); }
  };

  return (
    <div className="form">
      <p className="muted small">
        Upload an Excel (.xlsx) or CSV file. The first row should have column names like <b>Name</b>, <b>Phone</b>, Email, Address, Birthday, Anniversary, Notes, Tags.
        Customers whose phone number is already in the CRM are skipped.
      </p>
      <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => downloadCSV('customer-import-template.csv',
        ['Name', 'Phone', 'Email', 'Address', 'Birthday', 'Anniversary', 'Notes', 'Tags'],
        [['Anita Sharma', '9876543210', 'anita@example.com', 'Lajpat Nagar, Delhi', '25/09/1990', '12/02/2015', 'Likes cotton suits', 'VIP']])}>Download sample file</button>
      <label>Choose file<input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} /></label>
      {rows && (
        <>
          <div className="import-summary">
            <div><b>{rows.out.length}</b> rows in {fileName}</div>
            <div className="ok-text"><b>{ok.length}</b> will be imported</div>
            {skipped.length > 0 && <div className="muted"><b>{skipped.length}</b> skipped ({[...new Set(skipped.map((s) => s.skip))].join(', ')})</div>}
            <div className="muted small">Columns matched: {Object.entries(rows.map).map(([k, v]) => `${v} → ${k.replace(/_/g, ' ')}`).join(' · ')}</div>
          </div>
          {ok.length > 0 && (
            <div className="card flush">
              <table>
                <thead><tr><th>Name</th><th>Phone</th><th className="hide-sm">Birthday</th><th className="hide-sm">Tags</th></tr></thead>
                <tbody>
                  {ok.slice(0, 5).map((r, i) => <tr key={i}><td>{r.c.name}</td><td>{r.c.phone || '—'}</td><td className="hide-sm">{r.c.date_of_birth || '—'}</td><td className="hide-sm">{(r.c.tags || []).join(', ') || '—'}</td></tr>)}
                </tbody>
              </table>
              {ok.length > 5 && <div className="empty small">…and {ok.length - 5} more</div>}
            </div>
          )}
        </>
      )}
      <ErrorBox error={error} />
      <div className="form-actions">
        {progress && <span className="muted small">{progress}</span>}
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn primary" disabled={busy || !ok.length} onClick={doImport}>{busy ? 'Importing…' : `Import ${ok.length || ''} customer${ok.length === 1 ? '' : 's'}`}</button>
      </div>
    </div>
  );
}
