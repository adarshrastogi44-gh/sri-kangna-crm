import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { Empty, ErrorBox, Loading, Tags } from '../components';
import { addDays, billPoints, fetchAll, fmtDate, loadCustomers, loadSettings, redeemedOf, today, waLink } from '../utils';

const AUDIENCES = [
  ['all', 'All customers'],
  ['points', 'Customers with loyalty points'],
  ['inactive30', 'Not visited in 30+ days'],
  ['inactive90', 'Not visited in 90+ days'],
  ['recent30', 'Visited in last 30 days'],
  ['repeat', 'Repeat customers (2+ visits)'],
  ['bday', 'Birthday this month'],
  ['anniv', 'Anniversary this month'],
  ['tag', 'Customers with a tag…'],
];

const TEMPLATES = [
  ['Loyalty points reminder', 'Hi {name}, you have {points} loyalty points at {shop} (1 point = Rs. 1). Use them as a discount on your next purchase!'],
  ['New collection', 'Hi {name}, our new collection has just arrived at {shop}! Visit us soon to see it first.'],
  ['Festive offer', 'Hi {name}, wishing you a happy festive season from {shop}! Enjoy special offers in store this week.'],
  ['We miss you', 'Hi {name}, we miss you at {shop}! Drop by to see what\'s new. You have {points} loyalty points waiting for you.'],
  ['Write my own', ''],
];

const fill = (msg, c, shopName) => msg
  .replace(/\{name\}/gi, (c.name || '').split(' ')[0] || 'there')
  .replace(/\{fullname\}/gi, c.name || '')
  .replace(/\{points\}/gi, String(c.points || 0))
  .replace(/\{shop\}/gi, shopName);

function loadSent(key) { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
function saveSent(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }

export default function Campaigns({ openCustomer }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [aud, setAud] = useState('points');
  const [tag, setTag] = useState('');
  const [tpl, setTpl] = useState(0);
  const [msg, setMsg] = useState(TEMPLATES[0][1]);
  const [name, setName] = useState(`Campaign ${fmtDate(today())}`);
  const [sent, setSent] = useState({});
  const [skip, setSkip] = useState({}); // customers unticked = will not get the message
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [customers, bills, visits, shop] = await Promise.all([
          loadCustomers(),
          fetchAll(() => supabase.from('bills').select('*')),
          fetchAll(() => supabase.from('visits').select('customer_id,visit_date')),
          loadSettings(),
        ]);
        const st = {};
        const g = (id) => (st[id] ||= { points: 0, visits: 0, last: '' });
        bills.forEach((b) => { const x = g(b.customer_id); x.points += billPoints(b) - redeemedOf(b); if (b.bill_date > x.last) x.last = b.bill_date; });
        visits.forEach((v) => { const x = g(v.customer_id); x.visits += 1; if (v.visit_date > x.last) x.last = v.visit_date; });
        setData({ customers: customers.map((c) => ({ ...c, ...(st[c.id] || { points: 0, visits: 0, last: '' }) })), shop });
      } catch (e) { setErr(e); }
    })();
  }, []);

  const key = `sk-campaign-${name}`;
  useEffect(() => { setSent(loadSent(key)); setSkip(loadSent(`${key}-skip`)); }, [key]);

  const allTags = useMemo(() => (data ? [...new Set(data.customers.flatMap((c) => c.tags || []))].sort() : []), [data]);

  const list = useMemo(() => {
    if (!data) return [];
    const mm = today().slice(5, 7);
    const d30 = addDays(-30), d90 = addDays(-90);
    return data.customers.filter((c) => waLink(c.phone)).filter((c) => {
      switch (aud) {
        case 'points': return c.points > 0;
        case 'inactive30': return !c.last || c.last < d30;
        case 'inactive90': return !c.last || c.last < d90;
        case 'recent30': return c.last && c.last >= d30;
        case 'repeat': return c.visits >= 2;
        case 'bday': return c.date_of_birth && c.date_of_birth.slice(5, 7) === mm;
        case 'anniv': return c.anniversary && c.anniversary.slice(5, 7) === mm;
        case 'tag': return tag && (c.tags || []).includes(tag);
        default: return true;
      }
    }).sort((a, b) => b.points - a.points || (a.name || '').localeCompare(b.name || ''));
  }, [data, aud, tag]);

  if (err) return <ErrorBox error={err} />;
  if (!data) return <Loading />;

  const shopName = data.shop?.shop_name || 'Sri Kangna';
  const chosen = list.filter((c) => !skip[c.id]);
  const sentCount = chosen.filter((c) => sent[c.id]).length;
  const markSent = (id, v = true) => { const n = { ...sent, [id]: v }; setSent(n); saveSent(key, n); };
  const setSkips = (n) => { setSkip(n); saveSent(`${key}-skip`, n); };
  const toggle = (id) => setSkips({ ...skip, [id]: !skip[id] });
  const ql = q.trim().toLowerCase();
  const shown = ql ? list.filter((c) => (c.name || '').toLowerCase().includes(ql) || (c.phone || '').includes(ql)) : list;
  const selectAll = (v) => { const n = { ...skip }; shown.forEach((c) => { n[c.id] = !v; }); setSkips(n); };
  const allShownOn = shown.length > 0 && shown.every((c) => !skip[c.id]);
  const send = (c) => { window.open(`${waLink(c.phone)}?text=${encodeURIComponent(fill(msg, c, shopName))}`, '_blank'); markSent(c.id); };
  const next = chosen.find((c) => !sent[c.id]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Campaigns</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Send a WhatsApp message to a group of customers.</p>
        </div>
      </div>

      <div className="camp-grid">
        <section className="card">
          <h2>1. Who should get it?</h2>
          <div className="form">
            <label>Customers<select value={aud} onChange={(e) => setAud(e.target.value)}>{AUDIENCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {aud === 'tag' && (
              <label>Tag<select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">— choose a tag —</option>{allTags.map((t) => <option key={t}>{t}</option>)}</select></label>
            )}
            <div className="camp-count"><b>{list.length}</b> customers with a mobile number</div>
          </div>

          <h2 style={{ marginTop: 18 }}>2. Message</h2>
          <div className="form">
            <label>Start from<select value={tpl} onChange={(e) => { const i = Number(e.target.value); setTpl(i); if (TEMPLATES[i][1]) setMsg(TEMPLATES[i][1]); }}>
              {TEMPLATES.map(([l], i) => <option key={l} value={i}>{l}</option>)}
            </select></label>
            <label>Message<textarea rows="5" value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
            <div className="muted small">Use <code>{'{name}'}</code> for the first name, <code>{'{points}'}</code> for loyalty points, <code>{'{shop}'}</code> for the shop name.</div>
            {list[0] && <div className="camp-preview"><div className="muted small">Preview for {list[0].name}</div>{fill(msg, list[0], shopName)}</div>}
            <label>Campaign name (to remember who was sent)<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          </div>
        </section>

        <section className="card flush">
          <div className="camp-head">
            <div><h2 style={{ margin: 0 }}>3. Send</h2><div className="muted small"><b>{chosen.length}</b> of {list.length} selected · {sentCount} of {chosen.length} sent</div></div>
            <div className="actions">
              {sentCount > 0 && <button className="btn small ghost" onClick={() => { setSent({}); saveSent(key, {}); }}>Reset</button>}
              <button className="btn primary" disabled={!next || !msg.trim()} onClick={() => send(next)}>{next ? `Send next → ${next.name}` : 'All sent ✓'}</button>
            </div>
          </div>
          <div className="camp-bar"><div style={{ width: `${chosen.length ? (sentCount / chosen.length) * 100 : 0}%` }} /></div>
          <div className="camp-tools">
            <input placeholder="Find a customer in this list…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn small" onClick={() => selectAll(true)}>Select all</button>
            <button className="btn small" onClick={() => selectAll(false)}>Unselect all</button>
          </div>
          {list.length === 0 ? <Empty>No customers in this group.</Empty> : (
            <table>
              <thead><tr><th className="chk"><input type="checkbox" checked={allShownOn} onChange={(e) => selectAll(e.target.checked)} aria-label="Select all" /></th><th>Customer</th><th className="num">Points</th><th className="hide-sm">Last visit</th><th></th></tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className={skip[c.id] ? 'skip-row' : sent[c.id] ? 'sent-row' : ''}>
                    <td className="chk"><input type="checkbox" checked={!skip[c.id]} onChange={() => toggle(c.id)} aria-label={`Send to ${c.name}`} /></td>
                    <td><button className="link strong" onClick={() => openCustomer(c.id)}>{c.name}</button> <Tags tags={c.tags} /><div className="muted small">{c.phone}</div></td>
                    <td className="num"><span className="pts">{c.points}</span></td>
                    <td className="hide-sm">{fmtDate(c.last)}</td>
                    <td className="row-actions">
                      {skip[c.id] ? <span className="muted small">Not sending</span> : sent[c.id]
                        ? <><span className="ok-text small">✓ Sent</span> <button className="link" onClick={() => markSent(c.id, false)}>Undo</button></>
                        : <button className="btn small" disabled={!msg.trim()} onClick={() => send(c)}>WhatsApp</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <p className="muted small">Each click opens WhatsApp with the message ready; press Send in WhatsApp. (Sending to everyone automatically needs the paid WhatsApp Business API.)</p>
    </>
  );
}
