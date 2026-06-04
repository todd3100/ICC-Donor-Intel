// import-prospects.mjs
// Reads ./prospects.json and pushes each prospect into the ICC Donor Intel app
// via POST /api/prospects (create) followed by PATCH /api/prospects/:id (enrich).
//
// Auth: the backend (server/middleware/auth.js) only accepts the JWT via the
// cookie named `icc_token`. Bearer headers are NOT supported. Set ICC_TOKEN
// to the raw JWT value and this script will send it as `Cookie: icc_token=...`.

import fs from 'fs';

const API_BASE = (process.env.API_BASE || 'https://iccdonornetwork.up.railway.app').replace(/\/$/, '');
const ICC_TOKEN = (process.env.ICC_TOKEN || '').trim();

if (!ICC_TOKEN) {
  console.error('ERROR: Set ICC_TOKEN to your icc_token JWT value before running.');
  console.error('Example: export ICC_TOKEN=\'eyJhbGciOi...\'');
  process.exit(1);
}

const prospects = JSON.parse(fs.readFileSync('./prospects.json', 'utf8'));

const COOKIE_HEADER = `icc_token=${ICC_TOKEN}`;

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Cookie': COOKIE_HEADER,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`${method} ${url} -> ${res.status} ${detail}`);
  }
  return data;
}

function arr(v) {
  return Array.isArray(v) ? v.filter(Boolean).map(String) : [];
}

let ok = 0, fail = 0;

for (const p of prospects) {
  if (!p?.name) { console.error('Skipping row with no name'); fail++; continue; }
  try {
    // Step 1: create with the minimal modal-compatible payload
    const createPayload = {
      name: p.name,
      status: p.status || 'cold',
      tier: Number(p.tier || 3),
      location: p.location || '',
      netWorth: p.netWorth || '',
      occupation: p.occupation || '',
      undergrad: p.undergrad || '',
      grad: p.grad || '',
      age: p.age ?? null,
    };

    const created = await request('POST', `${API_BASE}/api/prospects`, createPayload);
    const prospectId = created?.prospect?.id || created?.id;
    if (!prospectId) throw new Error(`No prospect ID returned for ${p.name}`);

    // Step 2: PATCH the richer research fields
    const patchPayload = {
      netWorthSource: p.netWorthSource || '',
      previousRoles: arr(p.previousRoles),
      campusConnections: arr(p.campusConnections),
      philanthropicFootprint: arr(p.philanthropicFootprint),
      oct7Signals: p.oct7Signals || '',
      children: p.children || '',
      spouse: p.spouse || '',
      personalConnections: p.personalConnections || '',
      iccNetworkMatches: arr(p.iccNetworkMatches),
      connectionDetail: p.connectionDetail || '',
    };

    await request('PATCH', `${API_BASE}/api/prospects/${prospectId}`, patchPayload);
    console.log(`Imported: ${p.name}`);
    ok++;
  } catch (err) {
    console.error(`Failed: ${p.name} -> ${err.message}`);
    fail++;
  }
}

console.log(`\nDone. Imported ${ok}, failed ${fail}.`);
