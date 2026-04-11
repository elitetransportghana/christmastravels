/* jshint esversion: 8 */
(function () {
  'use strict';

  const API = 'https://realeliteweb-app.elitetransportghana.workers.dev/api';

  /* ── State ── */
  const S = {
    token: null,
    loaded: new Set(),
    routes: [],
    operators: [],
    trips: { active: [], recent: [] },
    passengers: {
      list: [], offset: 0, limit: 40,
      routeId: '', dateFrom: '', dateTo: '', status: '', search: ''
    },
    commissions: {
      list: [], offset: 0, limit: 50,
      dateFrom: '', dateTo: ''
    },
    selectedPax: new Set()   // booking IDs selected for SMS
  };

  /* ── Auth helpers ── */
  function readToken() {
    return localStorage.getItem('authToken')
      || sessionStorage.getItem('authToken')
      || '';
  }

  function requireAuth() {
    S.token = readToken();
    if (!S.token) {
      window.location.href = './login.html';
      return false;
    }
    return true;
  }

  /* ── Fetch wrapper ── */
  async function api(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + S.token,
        ...(opts.headers || {})
      }
    });
    if (res.status === 401) {
      localStorage.removeItem('authToken');
      sessionStorage.removeItem('authToken');
      window.location.href = './login.html';
      return null;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  /* ── Toast ── */
  function toast(msg, ok = true) {
    const el = document.getElementById('app-toast');
    if (!el) return;
    el.textContent = msg;
    el.style.background = ok ? '#112211' : '#c0392b';
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(20px)';
    }, 3400);
  }

  /* ── GHS formatter ── */
  function ghs(n) {
    return 'GH₵ ' + parseFloat(n || 0).toFixed(2);
  }

  /* ── Tab switching ── */
  function switchTab(name) {
    document.querySelectorAll('.app-tab-btn').forEach(b => {
      const active = b.dataset.tab === name;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.app-tab-panel').forEach(p => {
      p.classList.toggle('is-active', p.id === 'panel-' + name);
    });

    // Lazy load each tab on first visit
    if (!S.loaded.has(name)) {
      S.loaded.add(name);
      if (name === 'passengers') loadPassengers();
      if (name === 'trips')      loadTrips();
      if (name === 'operators')  loadOperators();
      if (name === 'commissions') loadCommissions();
    }
  }

  /* ════════════════════════════════════════════════
     BOOK TAB
  ════════════════════════════════════════════════ */
  function initBookTab() {
    const el = document.getElementById('admin-booking-desk');
    if (!el) return;
    if (typeof window.DashboardBookingDesk === 'undefined') {
      el.innerHTML = '<div class="app-empty"><i class="fa-solid fa-circle-exclamation"></i><p>Booking desk failed to load.</p></div>';
      return;
    }
    window.DashboardBookingDesk.mount(el, {
      context: 'admin',
      bookingEndpoint: '/admin/bookings/manual',
      token: S.token,
      onBookingCreated: (data) => {
        toast('Booking confirmed.');
        const url = data.drive_url || data.receipt_url;
        if (url) openReceiptModal(url, 'Receipt \u2013 ' + (data.booking_id || 'Booking'));
        if (S.loaded.has('passengers')) {
          S.passengers.offset = 0;
          loadPassengers();
        }
      }
    });
  }

  /* ════════════════════════════════════════════════
     PASSENGERS TAB
  ════════════════════════════════════════════════ */
  function buildRouteSelect(selectEl) {
    const existing = selectEl.innerHTML;
    if (S.routes.length === 0) return;
    selectEl.innerHTML = '<option value="">All routes</option>';
    S.routes.forEach(r => {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = r.name || r.route_name || r.id;
      selectEl.appendChild(o);
    });
  }

  async function loadPassengers(reset = false) {
    if (reset) {
      S.passengers.offset = 0;
      S.selectedPax.clear();
      updateSmsBar();
    }

    const p = S.passengers;
    const list = document.getElementById('pax-list');
    list.innerHTML = '<div class="app-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading…</p></div>';

    const params = new URLSearchParams();
    if (p.routeId)  params.set('routeId',  p.routeId);
    if (p.dateFrom) params.set('dateFrom', p.dateFrom);
    if (p.dateTo)   params.set('dateTo',   p.dateTo);
    if (p.status)   params.set('status',   p.status);
    params.set('limit',  String(p.limit));
    params.set('offset', String(p.offset));

    try {
      const data = await api('/admin/bookings/upcoming?' + params.toString());
      if (!data) return;
      p.list = data.bookings || data || [];

      const summary = data.summary || {};
      const total = summary.matchingBookings || p.list.length;
      document.getElementById('pax-summary-text').textContent =
        `${total} passenger${total !== 1 ? 's' : ''}`;

      renderPassengers();
      renderPaxPagination(total);
    } catch (e) {
      list.innerHTML = `<div class="app-empty"><i class="fa-solid fa-circle-exclamation"></i><p>${e.message}</p></div>`;
    }
  }

  function renderPassengers() {
    const p = S.passengers;
    const list = document.getElementById('pax-list');
    const search = p.search.toLowerCase();

    let items = p.list;
    if (search) {
      items = items.filter(b =>
        (b.first_name + ' ' + b.last_name + ' ' + b.phone).toLowerCase().includes(search)
      );
    }

    if (items.length === 0) {
      list.innerHTML = '<div class="app-empty"><i class="fa-solid fa-user-slash"></i><p>No passengers found.</p></div>';
      return;
    }

    list.innerHTML = items.map(b => {
      const name = (b.first_name || '') + ' ' + (b.last_name || '');
      const initials = ((b.first_name || '?')[0] + (b.last_name || '?')[0]).toUpperCase();
      const boarded = !!b.boarded_at;
      const methodBadge = payBadge(b.payment_method);
      const checked = S.selectedPax.has(b.id);

      return `<div class="app-pax-card ${boarded ? 'is-boarded' : ''}" data-id="${b.id}">
  <div class="app-pax-card__head" onclick="adminApp.togglePaxExpand(${b.id})">
    <input type="checkbox" class="app-pax-checkbox" onclick="event.stopPropagation();adminApp.togglePaxSelect(${b.id},this)"
      ${checked ? 'checked' : ''} aria-label="Select ${name.trim()}"/>
    <div class="app-pax-card__avatar">${initials}</div>
    <div class="app-pax-card__info">
      <div class="app-pax-card__name">${name.trim() || 'Unknown'}</div>
      <div class="app-pax-card__sub">${b.phone || ''} &bull; ${b.route_name || ''}</div>
    </div>
    <div class="app-pax-card__meta">
      ${methodBadge}
      <span class="app-badge ${boarded ? 'app-badge--green' : 'app-badge--amber'}">
        ${boarded ? 'Boarded' : 'Pending'}
      </span>
      <span style="font-weight:700;font-size:13px;color:#112211;">${ghs(b.price_paid)}</span>
    </div>
  </div>
  <div class="app-pax-card__body" id="pax-body-${b.id}">
    <div class="app-pax-detail-grid">
      <div class="app-pax-detail-item"><label>Email</label><span>${b.email || '—'}</span></div>
      <div class="app-pax-detail-item"><label>Seat</label><span>${b.seat_number || '—'}</span></div>
      <div class="app-pax-detail-item"><label>Trip date</label><span>${b.departure_date || '—'} ${b.departure_time || ''}</span></div>
      <div class="app-pax-detail-item"><label>Operator</label><span>${b.operator_name || '—'}</span></div>
      <div class="app-pax-detail-item"><label>Payment</label><span>${payLabel(b.payment_method)}</span></div>
      <div class="app-pax-detail-item"><label>Boarded at</label><span>${b.boarded_at ? new Date(b.boarded_at).toLocaleTimeString() : '—'}</span></div>
      <div class="app-pax-detail-item"><label>Booking ID</label><span style="font-size:11px;opacity:.7;">${b.id}</span></div>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;">
      <button class="app-btn app-btn--ghost app-btn--sm"
        onclick="adminApp.smsSingle('${b.id}','${(b.phone || '').replace(/'/g,'')}','${name.trim().replace(/'/g,'')}')">
        <i class="fa-solid fa-comment-dots"></i> SMS
      </button>
    </div>
  </div>
</div>`;
    }).join('');

    // Show/hide select-all and SMS buttons
    const hasPax = items.length > 0;
    document.getElementById('pax-select-all-btn').style.display = hasPax ? '' : 'none';
    document.getElementById('pax-sms-btn').style.display      = hasPax ? '' : 'none';
  }

  function payBadge(method) {
    if (!method) return '';
    const m = (method || '').toLowerCase();
    if (m === 'cash')    return '<span class="app-badge app-badge--cash">Cash</span>';
    if (m === 'momo' || m === 'mobile_money') return '<span class="app-badge app-badge--momo">MoMo</span>';
    if (m === 'card')    return '<span class="app-badge app-badge--card">Card</span>';
    if (m === 'online' || m === 'paystack') return '<span class="app-badge app-badge--online">Paystack</span>';
    return `<span class="app-badge app-badge--gray">${method}</span>`;
  }

  function payLabel(method) {
    const m = (method || '').toLowerCase();
    if (m === 'cash')    return 'Cash';
    if (m === 'momo' || m === 'mobile_money') return 'MoMo';
    if (m === 'card')    return 'Card';
    if (m === 'online' || m === 'paystack') return 'Paystack (Online)';
    return method || '—';
  }

  function renderPaxPagination(total) {
    const p = S.passengers;
    const pages = Math.ceil(total / p.limit);
    const cur = Math.floor(p.offset / p.limit) + 1;
    const cont = document.getElementById('pax-pagination');
    if (pages <= 1) { cont.style.display = 'none'; return; }
    cont.style.display = 'flex';
    const prevDisabled = cur === 1 ? 'disabled' : '';
    const nextDisabled = cur >= pages ? 'disabled' : '';
    cont.innerHTML = `
      <button class="app-btn app-btn--ghost app-btn--sm" ${prevDisabled}
        onclick="adminApp.paxPage(${cur - 2})">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <span style="font-size:13px;font-weight:600;color:#112211;padding:0 8px;">${cur} / ${pages}</span>
      <button class="app-btn app-btn--ghost app-btn--sm" ${nextDisabled}
        onclick="adminApp.paxPage(${cur})">
        <i class="fa-solid fa-chevron-right"></i>
      </button>`;
  }

  /* ════════════════════════════════════════════════
     TRIPS TAB
  ════════════════════════════════════════════════ */
  async function loadTrips() {
    ['trips-active-list', 'trips-recent-list'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="app-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading…</p></div>';
    });

    try {
      const data = await api('/admin/fleet/options');
      if (!data) return;

      // Populate routes + operators into state
      S.routes = data.routes || [];
      S.operators = (data.operators || []);
      S.trips.active = data.activeTrips || [];
      S.trips.recent = data.recentTrips || [];

      populateRouteFilters();
      populateOperatorFilter();

      renderTrips();
      renderTripsKpi();
    } catch (e) {
      document.getElementById('trips-active-list').innerHTML =
        `<div class="app-empty"><i class="fa-solid fa-circle-exclamation"></i><p>${e.message}</p></div>`;
    }
  }

  function populateRouteFilters() {
    ['trip-route-filter', 'pax-route-filter'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '<option value="">All routes</option>';
      S.routes.forEach(r => {
        const o = document.createElement('option');
        o.value = r.id;
        o.textContent = r.name || r.route_name || r.id;
        sel.appendChild(o);
      });
    });
  }

  function populateOperatorFilter() {
    const sel = document.getElementById('trip-operator-filter');
    if (!sel) return;
    sel.innerHTML = '<option value="">All operators</option>';
    S.operators.forEach(op => {
      const o = document.createElement('option');
      o.value = op.id;
      o.textContent = op.name || op.business_name || op.id;
      sel.appendChild(o);
    });
  }

  function renderTrips() {
    renderTripList('trips-active-list', S.trips.active);
    renderTripList('trips-recent-list', S.trips.recent);

    const recentSec = document.getElementById('trips-recent-section');
    if (recentSec) recentSec.style.display = S.trips.recent.length ? '' : 'none';

    document.getElementById('trips-summary-text').textContent =
      `${S.trips.active.length} active · ${S.trips.recent.length} recent`;
  }

  function renderTripList(listId, trips) {
    const el = document.getElementById(listId);
    if (!el) return;
    if (trips.length === 0) {
      el.innerHTML = '<div class="app-empty"><i class="fa-solid fa-ban"></i><p>None.</p></div>';
      return;
    }
    el.innerHTML = trips.map(t => tripCardHtml(t)).join('');
  }

  function tripCardHtml(t) {
    const occ = Math.round(t.occupancy_percent || 0);
    const statusBadge = statusPill(t.status);
    const dep = t.departure_station_name || '—';
    const arr = t.arrival_station_name || '—';

    return `<div class="app-trip-card">
  <div class="app-trip-card__top">
    <div>
      <div class="app-trip-card__route">${t.route_name || '—'}</div>
      <div class="app-trip-card__meta">
        ${t.departure_date || ''} ${t.departure_time || ''}
        &bull; ${t.bus_name || '—'}
        ${t.operator_name ? '&bull; ' + t.operator_name : ''}
      </div>
    </div>
    ${statusBadge}
  </div>

  <div class="app-trip-card__timeline">
    <div class="app-trip-card__station app-trip-card__station--dep">${dep}</div>
    <div class="app-trip-card__arrow"><i class="fa-solid fa-arrow-right"></i></div>
    <div class="app-trip-card__station app-trip-card__station--arr">${arr}</div>
  </div>

  <div class="app-progress-bar" title="${occ}% occupancy">
    <div class="app-progress-bar__fill" style="width:${occ}%"></div>
  </div>

  <div class="app-trip-card__stats">
    <div class="app-trip-stat">
      <div class="app-trip-stat__value">${t.booked_count || 0}</div>
      <div class="app-trip-stat__label">Booked</div>
    </div>
    <div class="app-trip-stat">
      <div class="app-trip-stat__value">${t.boarded_count || 0}</div>
      <div class="app-trip-stat__label">Boarded</div>
    </div>
    <div class="app-trip-stat">
      <div class="app-trip-stat__value">${t.seats_remaining != null ? t.seats_remaining : '—'}</div>
      <div class="app-trip-stat__label">Seats left</div>
    </div>
    <div class="app-trip-stat">
      <div class="app-trip-stat__value">${ghs(t.revenue_total)}</div>
      <div class="app-trip-stat__label">Revenue</div>
    </div>
  </div>

  <div class="app-trip-card__actions">
    <button class="app-btn app-btn--ghost app-btn--sm"
      onclick="adminApp.notifyTrip('${t.id}')">
      <i class="fa-solid fa-bell"></i> Notify
    </button>
    <button class="app-btn app-btn--ghost app-btn--sm"
      onclick="adminApp.viewTripPassengers('${t.id}','${(t.route_name||'').replace(/'/g,'')}')">
      <i class="fa-solid fa-users"></i> Passengers
    </button>
  </div>
</div>`;
  }

  function renderTripsKpi() {
    const strip = document.getElementById('trips-kpi-strip');
    if (!strip) return;
    strip.style.display = '';
    const all = [...S.trips.active, ...S.trips.recent];
    const totalBooked = all.reduce((s, t) => s + (t.booked_count || 0), 0);
    const totalRev    = all.reduce((s, t) => s + parseFloat(t.revenue_total || 0), 0);
    const avgOcc = all.length
      ? Math.round(all.reduce((s, t) => s + (t.occupancy_percent || 0), 0) / all.length)
      : 0;
    document.getElementById('kpi-active-trips').textContent  = S.trips.active.length;
    document.getElementById('kpi-total-booked').textContent  = totalBooked;
    document.getElementById('kpi-revenue').textContent        = ghs(totalRev);
    document.getElementById('kpi-occupancy').textContent      = avgOcc + '%';
  }

  function statusPill(status) {
    const map = {
      active: 'app-badge--green', completed: 'app-badge--mint',
      cancelled: 'app-badge--red', scheduled: 'app-badge--amber'
    };
    const cls = map[(status || '').toLowerCase()] || 'app-badge--gray';
    return `<span class="app-badge ${cls}">${status || 'unknown'}</span>`;
  }

  /* ════════════════════════════════════════════════
     OPERATORS TAB
  ════════════════════════════════════════════════ */
  async function loadOperators() {
    const grid = document.getElementById('operators-grid');
    grid.innerHTML = '<div class="app-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading…</p></div>';

    try {
      const data = await api('/admin/operators');
      if (!data) return;
      S.operators = data.operators || data || [];
      renderOperators();
    } catch (e) {
      grid.innerHTML = `<div class="app-empty"><i class="fa-solid fa-circle-exclamation"></i><p>${e.message}</p></div>`;
    }
  }

  function renderOperators() {
    const filter = document.getElementById('op-status-filter')?.value || '';
    const grid   = document.getElementById('operators-grid');
    let ops = S.operators;
    if (filter) ops = ops.filter(o => (o.status || '').toLowerCase() === filter);

    document.getElementById('operators-summary-text').textContent =
      `${ops.length} operator${ops.length !== 1 ? 's' : ''}`;

    if (ops.length === 0) {
      grid.innerHTML = '<div class="app-empty"><i class="fa-solid fa-building-circle-xmark"></i><p>No operators found.</p></div>';
      return;
    }

    grid.innerHTML = ops.map(op => {
      const active = (op.status || '').toLowerCase() === 'active';
      const pending = (op.status || '').toLowerCase() === 'pending';

      return `<div class="app-operator-card">
  <div class="app-operator-card__name">${op.name || op.business_name || '—'}</div>
  <div class="app-operator-card__email">${op.email || '—'}</div>
  <div class="app-operator-card__row"><span>Status</span><span>${statusPill(op.status)}</span></div>
  <div class="app-operator-card__row"><span>Fleet</span><span>${op.bus_count || op.fleet_count || 0} bus${(op.bus_count || 0) !== 1 ? 'es' : ''}</span></div>
  <div class="app-operator-card__row"><span>Routes</span><span>${op.route_count || 0}</span></div>
  <div class="app-operator-card__row"><span>Commission</span><span>${op.commission_rate != null ? op.commission_rate + '%' : '—'}</span></div>
  <div class="app-operator-card__row"><span>Total bookings</span><span>${op.total_bookings || 0}</span></div>
  <div class="app-operator-card__actions">
    ${pending ? `<button class="app-btn app-btn--primary app-btn--sm" onclick="adminApp.approveOperator('${op.id}')"><i class="fa-solid fa-check"></i> Approve</button>` : ''}
    ${active  ? `<button class="app-btn app-btn--danger  app-btn--sm" onclick="adminApp.suspendOperator('${op.id}')"><i class="fa-solid fa-ban"></i> Suspend</button>` : ''}
    ${!active && !pending ? `<button class="app-btn app-btn--ghost app-btn--sm"  onclick="adminApp.approveOperator('${op.id}')"><i class="fa-solid fa-rotate"></i> Reinstate</button>` : ''}
  </div>
</div>`;
    }).join('');
  }

  /* ════════════════════════════════════════════════
     COMMISSIONS TAB
  ════════════════════════════════════════════════ */
  async function loadCommissions(reset = false) {
    if (reset) S.commissions.offset = 0;
    const c = S.commissions;

    const tbody = document.getElementById('commissions-tbody');
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:rgba(17,34,17,.4);">
      <i class="fa-solid fa-spinner fa-spin" style="margin-right:8px;"></i>Loading…</td></tr>`;

    const params = new URLSearchParams();
    if (c.dateFrom) params.set('dateFrom', c.dateFrom);
    if (c.dateTo)   params.set('dateTo',   c.dateTo);
    params.set('limit',  String(c.limit));
    params.set('offset', String(c.offset));

    try {
      const data = await api('/admin/commissions?' + params.toString());
      if (!data) return;
      c.list = data.commissions || data || [];
      renderCommissions(data);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:#c0392b;">${e.message}</td></tr>`;
    }
  }

  function renderCommissions(data) {
    const c = S.commissions;
    const tbody = document.getElementById('commissions-tbody');
    const strip = document.getElementById('comm-kpi-strip');

    if (c.list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:rgba(17,34,17,.4);">No commission records.</td></tr>';
      if (strip) strip.style.display = 'none';
      return;
    }

    tbody.innerHTML = c.list.map(row => `
      <tr>
        <td>${row.operator_name || '—'}</td>
        <td>${row.route_name    || '—'}</td>
        <td>${row.period_date || row.date || '—'}</td>
        <td>${row.booking_count || 0}</td>
        <td>${ghs(row.gross_revenue || row.total_revenue)}</td>
        <td>${row.commission_rate != null ? row.commission_rate + '%' : '—'}</td>
        <td style="font-weight:700;">${ghs(row.commission_amount || row.commission)}</td>
        <td>${statusPill(row.status || 'calculated')}</td>
      </tr>`).join('');

    // KPI
    if (strip) {
      strip.style.display = '';
      const totalComm  = c.list.reduce((s, r) => s + parseFloat(r.commission_amount || r.commission || 0), 0);
      const totalCount = c.list.reduce((s, r) => s + (r.booking_count || 0), 0);
      const rates      = c.list.map(r => parseFloat(r.commission_rate || 0)).filter(Boolean);
      const avgRate    = rates.length ? (rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1) : '—';

      document.getElementById('kpi-comm-total').textContent = ghs(totalComm);
      document.getElementById('kpi-comm-count').textContent = totalCount;
      document.getElementById('kpi-comm-rate').textContent  = avgRate !== '—' ? avgRate + '%' : '—';
    }

    const total = data.total || c.list.length;
    document.getElementById('commissions-summary-text').textContent =
      `${total} record${total !== 1 ? 's' : ''}`;
    renderCommPagination(total);
  }

  function renderCommPagination(total) {
    const c = S.commissions;
    const pages = Math.ceil(total / c.limit);
    const cur = Math.floor(c.offset / c.limit) + 1;
    const cont = document.getElementById('comm-pagination');
    if (pages <= 1) { cont.style.display = 'none'; return; }
    cont.style.display = 'flex';
    cont.innerHTML = `
      <button class="app-btn app-btn--ghost app-btn--sm" ${cur === 1 ? 'disabled' : ''}
        onclick="adminApp.commPage(${cur - 2})"><i class="fa-solid fa-chevron-left"></i></button>
      <span style="font-size:13px;font-weight:600;padding:0 8px;">${cur} / ${pages}</span>
      <button class="app-btn app-btn--ghost app-btn--sm" ${cur >= pages ? 'disabled' : ''}
        onclick="adminApp.commPage(${cur})"><i class="fa-solid fa-chevron-right"></i></button>`;
  }

  /* ════════════════════════════════════════════════
     SMS / COMPOSE BAR
  ════════════════════════════════════════════════ */
  function updateSmsBar() {
    const count = S.selectedPax.size;
    const countEl = document.getElementById('compose-count');
    if (countEl) countEl.textContent = count;
    const bar = document.getElementById('compose-bar');
    if (bar) bar.classList.toggle('is-open', count > 0);
  }

  async function sendSMS(bookingIds, message) {
    if (!message || !message.trim()) { toast('Please enter a message.', false); return; }
    const btn = document.getElementById('compose-send-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…'; }
    try {
      const res = await api('/admin/sms/send', {
        method: 'POST',
        body: JSON.stringify({ bookingIds: Array.from(bookingIds), message: message.trim() })
      });
      if (!res) return;
      toast(`Sent to ${res.sent || bookingIds.size} / ${res.total || bookingIds.size} passengers.`);
      S.selectedPax.clear();
      updateSmsBar();
      document.getElementById('compose-text').value = '';
    } catch (e) {
      toast(e.message, false);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send'; }
    }
  }

  /* ════════════════════════════════════════════════
     OPERATOR ACTIONS
  ════════════════════════════════════════════════ */
  async function approveOperator(id) {
    try {
      await api('/admin/operators/' + id + '/approve', { method: 'POST' });
      toast('Operator approved.');
      loadOperators();
    } catch (e) { toast(e.message, false); }
  }

  async function suspendOperator(id) {
    if (!confirm('Suspend this operator?')) return;
    try {
      await api('/admin/operators/' + id + '/suspend', { method: 'POST' });
      toast('Operator suspended.');
      loadOperators();
    } catch (e) { toast(e.message, false); }
  }

  async function notifyTrip(tripId) {
    const message = prompt('Message to send to all passengers on this trip:');
    if (!message) return;
    try {
      await api('/admin/trips/' + tripId + '/notify', {
        method: 'POST',
        body: JSON.stringify({ message })
      });
      toast('Notification sent.');
    } catch (e) { toast(e.message, false); }
  }

  /* ════════════════════════════════════════════════
     PUBLIC API (called from HTML onclick)
  ════════════════════════════════════════════════ */
  window.adminApp = {
    togglePaxExpand(id) {
      const body = document.getElementById('pax-body-' + id);
      if (body) body.classList.toggle('is-open');
    },
    togglePaxSelect(id, cb) {
      if (cb.checked) S.selectedPax.add(id);
      else S.selectedPax.delete(id);
      updateSmsBar();
    },
    paxPage(page) {
      S.passengers.offset = page * S.passengers.limit;
      loadPassengers();
    },
    commPage(page) {
      S.commissions.offset = page * S.commissions.limit;
      loadCommissions();
    },
    approveOperator,
    suspendOperator,
    notifyTrip,
    viewTripPassengers(tripId, routeName) {
      // Switch to Passengers tab, filter by trip
      // We use routeId from the trip if available; otherwise just switch tab
      document.getElementById('pax-route-filter').value = '';
      S.passengers.routeId  = '';
      S.passengers.dateFrom = '';
      S.passengers.dateTo   = '';
      S.passengers.status   = '';
      S.passengers.search   = '';
      S.loaded.delete('passengers');
      switchTab('passengers');
    },
    smsSingle(bookingId, phone, name) {
      const msg = prompt(`SMS to ${name} (${phone}):`);
      if (!msg) return;
      api('/admin/sms/send', {
        method: 'POST',
        body: JSON.stringify({ phone, name, message: msg.trim() })
      }).then(r => toast(`Sent to ${phone}.`)).catch(e => toast(e.message, false));
    },
    closeReceiptModal
  };

  function toEmbedUrl(url) {
    if (!url) return '';
    const m = url.match(/drive\.google\.com\/file\/d\/([^/?]+)/);
    if (m) return 'https://drive.google.com/file/d/' + m[1] + '/preview';
    return url;
  }

  function openReceiptModal(url, label) {
    const modal = document.getElementById('app-receipt-modal');
    const iframe = document.getElementById('app-receipt-modal-iframe');
    const openBtn = document.getElementById('app-receipt-modal-open-btn');
    const title = document.getElementById('app-receipt-modal-title');
    if (!modal) { window.open(url, '_blank', 'noopener'); return; }
    if (title) title.textContent = label || 'Booking Receipt';
    if (iframe) iframe.src = toEmbedUrl(url);
    if (openBtn) openBtn.href = url;
    modal.hidden = false;
  }

  function closeReceiptModal() {
    const modal = document.getElementById('app-receipt-modal');
    const iframe = document.getElementById('app-receipt-modal-iframe');
    if (iframe) iframe.src = '';
    if (modal) modal.hidden = true;
  }

  /* ════════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════════ */
  function bindEvents() {
    // Tab buttons
    document.querySelectorAll('.app-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Logout
    document.getElementById('app-admin-logout')?.addEventListener('click', () => {
      localStorage.removeItem('authToken');
      sessionStorage.removeItem('authToken');
      window.location.href = './login.html';
    });

    // Passengers filter
    document.getElementById('pax-apply-filter')?.addEventListener('click', () => {
      S.passengers.routeId  = document.getElementById('pax-route-filter').value;
      S.passengers.dateFrom = document.getElementById('pax-date-from').value;
      S.passengers.dateTo   = document.getElementById('pax-date-to').value;
      S.passengers.status   = document.getElementById('pax-status-filter').value;
      loadPassengers(true);
    });

    document.getElementById('pax-search')?.addEventListener('input', function () {
      S.passengers.search = this.value;
      renderPassengers();
    });

    document.getElementById('pax-refresh-btn')?.addEventListener('click', () => {
      S.loaded.delete('passengers');
      loadPassengers(true);
    });

    document.getElementById('pax-select-all-btn')?.addEventListener('click', () => {
      S.passengers.list.forEach(b => S.selectedPax.add(b.id));
      renderPassengers();
      updateSmsBar();
    });

    document.getElementById('pax-sms-btn')?.addEventListener('click', () => {
      document.getElementById('compose-bar')?.classList.add('is-open');
      document.getElementById('compose-text')?.focus();
    });

    // Trips filter
    document.getElementById('trip-apply-filter')?.addEventListener('click', () => {
      const routeId  = document.getElementById('trip-route-filter').value;
      const opId     = document.getElementById('trip-operator-filter').value;
      const statuses = Array.from(document.querySelectorAll('input[name="trip-status"]:checked'))
                            .map(c => c.value);
      let active = S.trips.active;
      let recent = S.trips.recent;
      if (routeId) {
        active = active.filter(t => String(t.route_id) === routeId);
        recent = recent.filter(t => String(t.route_id) === routeId);
      }
      if (opId) {
        active = active.filter(t => String(t.operator_id) === opId);
        recent = recent.filter(t => String(t.operator_id) === opId);
      }
      if (statuses.length) {
        active = active.filter(t => statuses.includes((t.status || '').toLowerCase()));
        recent = recent.filter(t => statuses.includes((t.status || '').toLowerCase()));
      }
      renderTripList('trips-active-list', active);
      renderTripList('trips-recent-list', recent);
    });

    document.getElementById('trips-refresh-btn')?.addEventListener('click', () => {
      S.loaded.delete('trips');
      loadTrips();
    });

    // Operators filter
    document.getElementById('op-status-filter')?.addEventListener('change', renderOperators);
    document.getElementById('operators-refresh-btn')?.addEventListener('click', () => {
      S.loaded.delete('operators');
      loadOperators();
    });

    // Commissions filter
    document.getElementById('comm-apply-filter')?.addEventListener('click', () => {
      S.commissions.dateFrom = document.getElementById('comm-date-from').value;
      S.commissions.dateTo   = document.getElementById('comm-date-to').value;
      loadCommissions(true);
    });

    document.getElementById('comm-refresh-btn')?.addEventListener('click', () => {
      S.loaded.delete('commissions');
      loadCommissions(true);
    });

    // Compose bar
    document.getElementById('compose-send-btn')?.addEventListener('click', () => {
      const msg = document.getElementById('compose-text').value;
      sendSMS(S.selectedPax, msg);
    });

    document.getElementById('compose-close')?.addEventListener('click', () => {
      S.selectedPax.clear();
      updateSmsBar();
      document.getElementById('compose-text').value = '';
      document.querySelectorAll('.app-pax-checkbox').forEach(cb => { cb.checked = false; });
    });

    document.getElementById('compose-text')?.addEventListener('input', function () {
      const len = this.value.length;
      const charEl = document.getElementById('compose-char');
      if (charEl) charEl.textContent = len + '/480';
    });
  }

  async function loadAdminProfile() {
    try {
      const data = await api('/admin/profile');
      if (data && data.name) {
        const el = document.getElementById('app-admin-name');
        if (el) el.textContent = data.name;
      }
    } catch (_) { /* non-critical */ }
  }

  function init() {
    if (!requireAuth()) return;
    bindEvents();
    loadAdminProfile();
    initBookTab();
    // Trips loads first (also populates route filters used in Passengers tab)
    S.loaded.add('trips');
    loadTrips();
    // Honour ?tab= param (e.g. returning from add-trip.html)
    const paramTab = new URLSearchParams(location.search).get('tab');
    if (paramTab) switchTab(paramTab);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
