/* ============================================================
   admin/add-trip.js  —  Admin Add Trip page
   POST /api/admin/trips → handleAdminCreateTrip
   Fields: routeId*, busId*, departureDate, departureTime, price
============================================================ */
'use strict';

const API_BASE = 'https://realeliteweb-app.elitetransportghana.workers.dev/api';

/* ── Auth guard ── */
const _token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
if (!_token) { location.href = './login.html'; }

/* ── Shared fetch helper ── */
async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + _token,
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: text }; }
  if (!res.ok) throw new Error(json.error || json.message || `HTTP ${res.status}`);
  return json;
}

/* ── State ── */
let _routes = [];
let _buses  = [];

/* ── Init ── */
(async function init() {
  // Set today as default date
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('nt-date').value = today;
  document.getElementById('nt-date').min   = today;

  try {
    await Promise.all([loadAdminName(), loadFleetOptions(), loadOperators()]);
  } catch (e) {
    showError(e.message);
  }
})();

async function loadAdminName() {
  try {
    const data = await api('/admin/profile');
    const name = (data && (data.name || data.email)) || 'Admin';
    const el = document.getElementById('at-admin-name');
    if (el) el.textContent = name;
  } catch (_) {}
}

async function loadFleetOptions() {
  try {
    const data = await api('/admin/fleet/options');
    _routes = data.routes || [];
    _buses  = data.buses  || [];
  } catch (e) {
    // Fleet options endpoint may require admin token — surface the error
    showError('Could not load routes/buses: ' + e.message);
    return;
  }

  const routeSel = document.getElementById('nt-route');
  routeSel.innerHTML = '<option value="">Select route…</option>';
  _routes.forEach(r => {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = r.name || r.id;
    routeSel.appendChild(o);
  });

  routeSel.addEventListener('change', () => populateBuses(routeSel.value));
  populateBuses('');
}

function populateBuses(routeId) {
  const busSel = document.getElementById('nt-bus');
  busSel.disabled = false;
  busSel.innerHTML = '<option value="">Select bus…</option>';

  const list = routeId
    ? _buses.filter(b => !b.route_id || String(b.route_id) === String(routeId))
    : _buses;

  list.forEach(b => {
    const o = document.createElement('option');
    o.value = b.id;
    const label = (b.name || b.plate_number || ('Bus ' + b.id))
      + (b.capacity ? ` · ${b.capacity} seats` : '');
    o.textContent = label;
    busSel.appendChild(o);
  });

  if (list.length === 0) {
    busSel.innerHTML = '<option value="">No buses available for this route</option>';
    busSel.disabled = true;
  }
}

async function loadOperators() {
  try {
    const data = await api('/admin/operators');
    const operators = data.operators || data || [];
    const sel = document.getElementById('nt-operator');
    operators.forEach(op => {
      const o = document.createElement('option');
      o.value = op.id;
      o.textContent = op.name || op.slug || ('Operator ' + op.id);
      sel.appendChild(o);
    });
  } catch (_) {
    // operator list is optional — silently ignore
  }
}

/* ── Submit ── */
async function submitTrip() {
  clearError();

  const routeId = document.getElementById('nt-route').value.trim();
  const busId   = document.getElementById('nt-bus').value.trim();

  if (!routeId) { showError('Please select a route.'); return; }
  if (!busId)   { showError('Please select a bus.'); return; }

  const date  = document.getElementById('nt-date').value  || null;
  const time  = document.getElementById('nt-time').value  || null;
  const price = document.getElementById('nt-price').value;

  const payload = {
    routeId:       routeId,
    busId:         busId,
    departureDate: date,
    departureTime: time,
    price:         price ? parseFloat(price) : undefined
  };

  const btn = document.getElementById('at-submit-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating…';

  try {
    const result = await api('/admin/trips', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    btn.innerHTML = '<i class="fa-solid fa-check"></i> Trip created!';
    btn.style.background = '#1a7a4a';

    // Redirect back to trips tab after short delay
    setTimeout(() => {
      location.href = './app.html?tab=trips';
    }, 1200);
  } catch (e) {
    showError(e.message);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Create trip';
  }
}

function showError(msg) {
  const el = document.getElementById('at-error-msg');
  if (el) el.textContent = msg;
}
function clearError() {
  const el = document.getElementById('at-error-msg');
  if (el) el.textContent = '';
}

/* Expose for inline onclick */
window.submitTrip = submitTrip;
