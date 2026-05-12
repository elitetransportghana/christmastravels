/* jshint esversion: 8 */
(function () {
  'use strict';

  const API = 'https://realeliteweb-app.elitetransportghana.workers.dev/api';
  const TICKET_STORAGE_KEY = 'latestConfirmedTicket';

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

  /* ── Confirm / Prompt modals (replace native browser dialogs) ── */
  function adminConfirm(msg) {
    return new Promise(resolve => {
      const modal = document.getElementById('adm-confirm-modal');
      const msgEl  = document.getElementById('adm-confirm-msg');
      const okBtn  = document.getElementById('adm-confirm-ok');
      const noBtn  = document.getElementById('adm-confirm-cancel');
      if (!modal) { resolve(window.confirm(msg)); return; }
      msgEl.textContent = msg;
      modal.style.display = 'flex';
      function done(val) {
        modal.style.display = 'none';
        okBtn.removeEventListener('click', yes);
        noBtn.removeEventListener('click', no);
        resolve(val);
      }
      function yes() { done(true); }
      function no()  { done(false); }
      okBtn.addEventListener('click', yes);
      noBtn.addEventListener('click', no);
    });
  }

  function adminPrompt(msg, placeholder = '') {
    return new Promise(resolve => {
      const modal   = document.getElementById('adm-prompt-modal');
      const msgEl   = document.getElementById('adm-prompt-msg');
      const input   = document.getElementById('adm-prompt-input');
      const okBtn   = document.getElementById('adm-prompt-ok');
      const noBtn   = document.getElementById('adm-prompt-cancel');
      if (!modal) { resolve(window.prompt(msg)); return; }
      msgEl.textContent   = msg;
      input.placeholder   = placeholder;
      input.value         = '';
      modal.style.display = 'flex';
      setTimeout(() => input.focus(), 60);
      function done(val) {
        modal.style.display = 'none';
        okBtn.removeEventListener('click', yes);
        noBtn.removeEventListener('click', no);
        input.removeEventListener('keydown', onKey);
        resolve(val);
      }
      function yes()  { done(input.value.trim() || null); }
      function no()   { done(null); }
      function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); yes(); } if (e.key === 'Escape') no(); }
      okBtn.addEventListener('click', yes);
      noBtn.addEventListener('click', no);
      input.addEventListener('keydown', onKey);
    });
  }

  /* ── GHS formatter ── */
  function ghs(n) {
    return 'GH₵ ' + parseFloat(n || 0).toFixed(2);
  }

  /* ── Tab switching ── */
  function splitRouteText(routeText) {
    const text = String(routeText || '').trim();
    if (text.includes('->')) {
      const parts = text.split('->');
      return {
        from: String(parts[0] || '').trim(),
        to: String(parts[1] || '').trim()
      };
    }
    return { from: '', to: '' };
  }

  function buildTicketPageUrl(ticketPayload) {
    const ref = String(ticketPayload?.bookingId || '').trim();
    return `../ticket.html${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  }

  function storeTicketPayload(ticketPayload, markFresh = false) {
    if (!ticketPayload) return;
    sessionStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(ticketPayload));
    if (markFresh) {
      sessionStorage.setItem('_freshBooking', '1');
    } else {
      sessionStorage.removeItem('_freshBooking');
    }
  }

  function buildTicketPayloadFromBooking(booking) {
    if (!booking) return null;
    const bookingId = String(booking.booking_id || booking.ref || `ELITE-${booking.id || ''}`).trim();
    const routeName = String(booking.route_name || booking.routeName || 'Elite Transport Route').trim();
    const routeParts = splitRouteText(routeName);
    const seats = String(booking.seat_number || booking.seat || booking.seats || '')
      .split(',')
      .map((seat) => seat.trim())
      .filter(Boolean);
    const firstName = String(booking.first_name || booking.firstName || '').trim();
    const lastName = String(booking.last_name || booking.lastName || '').trim();
    const fullName = String(booking.passenger_name || booking.passengerName || `${firstName} ${lastName}`).trim() || 'Passenger 1';

    return {
      bookingId,
      bookingIds: [bookingId].filter(Boolean),
      routeName,
      busName: String(booking.bus_name || booking.busName || 'Elite Transport Express').trim(),
      seats,
      seatCount: Number(booking.seat_count || seats.length || 1),
      totalPrice: Number(booking.price_paid || booking.price || booking.totalPrice || 0),
      phone: String(booking.phone || '').trim(),
      email: String(booking.email || '').trim(),
      receiptUrl: booking.receipt_url || booking.receiptUrl || null,
      status: String(booking.status || 'confirmed').trim(),
      createdAt: String(booking.created_at || booking.createdAt || new Date().toISOString()).trim(),
      selection: {
        routeText: routeName,
        coachName: String(booking.bus_name || booking.busName || 'Elite Transport Express').trim(),
        routeGroupLabel: String(booking.route_group_label || booking.routeGroupLabel || 'Intercity').trim(),
        originCity: routeParts.from || '',
        destinationCity: routeParts.to || '',
        departureDate: String(booking.departure_date || booking.departureDate || '').trim(),
        departureTime: String(booking.departure_time || booking.departureTime || '').trim(),
        arrivalTime: String(booking.arrival_time || booking.arrivalTime || '').trim(),
        durationLabel: String(booking.duration_label || booking.durationLabel || '').trim(),
        durationMinutes: Number(booking.duration_minutes || booking.durationMinutes || 0),
        rating: 4.9,
        reviewCount: 94,
        stopSummary: String(booking.stop_summary || booking.stopSummary || 'Direct trip').trim()
      },
      customerAvatar: '',
      passengers: [{
        bookingId,
        seat: seats[0] || String(booking.seat_number || booking.seat || '').trim(),
        firstName: firstName || fullName.split(/\s+/)[0] || '',
        lastName: lastName || fullName.split(/\s+/).slice(1).join(' '),
        fullName,
        avatarUrl: ''
      }]
    };
  }

  function openTicketReceipt(ticketPayload, label) {
    if (!ticketPayload) return;
    storeTicketPayload(ticketPayload, false);
    openReceiptModal(buildTicketPageUrl(ticketPayload), label || `Ticket - ${ticketPayload.bookingId || 'Booking'}`);
  }

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
      if (name === 'overview')   loadOverview();
      if (name === 'book')       initBookTab();
      if (name === 'passengers') loadPassengers();
      if (name === 'trips')      loadTrips();
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
      onBookingCreated: (data, bookingContext) => {
        toast('Booking confirmed.');
        const ticketPayload = bookingContext?.ticketPayload || buildTicketPayloadFromBooking(data);
        if (ticketPayload) {
          storeTicketPayload(ticketPayload, true);
          openReceiptModal(buildTicketPageUrl(ticketPayload), 'Ticket \u2013 ' + (ticketPayload.bookingId || data.booking_id || 'Booking'));
        } else {
          const url = data.drive_url || data.receipt_url;
          if (url) openReceiptModal(url, 'Receipt \u2013 ' + (data.booking_id || 'Booking'));
        }
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

    // Group by trip (departure_date + route_name + departure_time)
    const groups = new Map();
    items.forEach(b => {
      const key = (b.departure_date || '') + '|' + (b.route_name || '') + '|' + (b.departure_time || '');
      if (!groups.has(key)) groups.set(key, { label: b, passengers: [], sortKey: b.departure_date || '' });
      groups.get(key).passengers.push(b);
    });

    const now = new Date().toISOString().slice(0, 10);

    // Sort groups: upcoming (today/future) first sorted ascending; past trips after sorted descending
    const sorted = Array.from(groups.values()).sort((a, b) => {
      const aDate = a.sortKey;
      const bDate = b.sortKey;
      const aUpcoming = aDate >= now;
      const bUpcoming = bDate >= now;
      if (aUpcoming && bUpcoming) return aDate.localeCompare(bDate); // soonest first
      if (!aUpcoming && !bUpcoming) return bDate.localeCompare(aDate); // most recent past first
      return aUpcoming ? -1 : 1; // upcoming before past
    });

    list.innerHTML = sorted.map(group => {
      const lbl = group.label;
      const isPast = (lbl.departure_date || '') < now;

      // Format date nicely
      const depDate = lbl.departure_date
        ? new Date(lbl.departure_date + 'T00:00:00').toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
        : '';
      const depTime = lbl.departure_time ? lbl.departure_time : '';

      const boardedCount = group.passengers.filter(b => !!b.boarded_at).length;
      const totalCount = group.passengers.length;

      const paxHtml = group.passengers.map(b => {
        const name = (b.first_name || '') + ' ' + (b.last_name || '');
        const initials = ((b.first_name || '?')[0] + (b.last_name || '?')[0]).toUpperCase();
        const boarded = !!b.boarded_at;
        const methodBadge = payBadge(b.payment_method);
        const checked = S.selectedPax.has(b.id);

        return `<div class="app-pax-card ${boarded ? 'is-boarded' : ''}" data-id="${b.id}" id="pax-card-${b.id}">
  <div class="app-pax-card__head" onclick="adminApp.togglePaxExpand(${b.id})">
    <input type="checkbox" class="app-pax-checkbox" onclick="event.stopPropagation();adminApp.togglePaxSelect(${b.id},this)"
      ${checked ? 'checked' : ''} aria-label="Select ${name.trim()}"/>
    <div class="app-pax-card__avatar">${initials}</div>
    <div class="app-pax-card__info">
      <div class="app-pax-card__name">${name.trim() || 'Unknown'}</div>
      <div class="app-pax-card__sub">${b.phone || ''} &bull; Seat <strong>${b.seat_number || '—'}</strong></div>
    </div>
    <div class="app-pax-card__meta">
      ${methodBadge}
      <span class="app-badge ${boarded ? 'app-badge--green' : 'app-badge--amber'}">
        ${boarded ? '<i class="fa-solid fa-circle-check" style="margin-right:3px;"></i>Boarded' : 'Pending'}
      </span>
      <span class="app-pax-card__price">${ghs(b.price_paid)}</span>
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
    <div class="app-pax-card__actions">
      ${!boarded ? `<button class="app-btn app-btn--checkin app-btn--sm" id="checkin-btn-${b.id}"
        onclick="adminApp.checkinPassenger(${b.id})">
        <i class="fa-solid fa-clipboard-check"></i> Check In
      </button>` : `<button class="app-btn app-btn--checkin app-btn--sm" disabled>
        <i class="fa-solid fa-circle-check"></i> Boarded ✓
      </button>`}
      <button class="app-btn app-btn--ghost app-btn--sm"
        onclick="adminApp.smsSingle('${b.id}','${(b.phone || '').replace(/'/g,'')}','${name.trim().replace(/'/g,'')}')">
        <i class="fa-solid fa-comment-dots"></i> SMS
      </button>
      <button class="app-btn app-btn--ghost app-btn--sm"
        onclick="adminApp.viewReceipt('${b.id}')">
        <i class="fa-solid fa-ticket"></i> Receipt
      </button>
    </div>
  </div>
</div>`;
      }).join('');

      return `<div class="app-pax-trip-group ${isPast ? 'app-pax-trip-group--past' : ''}">
  <div class="app-pax-trip-group__header">
    <div class="app-pax-trip-group__header-left">
      <span class="app-pax-trip-group__route"><i class="fa-solid fa-route" style="margin-right:6px;opacity:.6;"></i>${lbl.route_name || 'Unknown route'}</span>
      <span class="app-pax-trip-group__datetime"><i class="fa-regular fa-clock" style="margin-right:4px;opacity:.6;"></i>${depDate}${depTime ? ' · ' + depTime : ''}</span>
    </div>
    <div class="app-pax-trip-group__header-right">
      ${isPast ? '<span class="app-badge app-badge--gray" style="font-size:10px;">Past</span>' : '<span class="app-badge app-badge--mint" style="font-size:10px;">Upcoming</span>'}
      <span class="app-pax-trip-group__progress">${boardedCount}/${totalCount} boarded</span>
      <span class="app-pax-trip-group__count">${totalCount} pax</span>
    </div>
  </div>
  <div class="app-pax-trip-group__progress-bar">
    <div class="app-pax-trip-group__progress-fill" style="width:${totalCount ? Math.round(boardedCount/totalCount*100) : 0}%"></div>
  </div>
  ${paxHtml}
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
     OVERVIEW TAB
  ════════════════════════════════════════════════ */
  async function loadOverview() {
    document.getElementById('ov-kpi-trips').textContent    = '…';
    document.getElementById('ov-kpi-booked').textContent   = '…';
    document.getElementById('ov-kpi-revenue').textContent  = '…';
    document.getElementById('ov-kpi-occupancy').textContent = '…';
    document.getElementById('overview-trip-grid').innerHTML =
      '<div class="app-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading…</p></div>';
    try {
      const data = await api('/admin/fleet/options');
      if (!data) return;
      S.routes          = data.routes || [];
      S.operators       = data.operators || [];
      S.trips.active    = data.activeTrips || [];
      S.trips.recent    = data.recentTrips || [];
      populateRouteFilters();
      populateOperatorFilter();
      renderOverview();
    } catch (e) {
      document.getElementById('overview-trip-grid').innerHTML =
        `<div class="app-empty"><i class="fa-solid fa-circle-exclamation"></i><p>${e.message}</p></div>`;
    }
  }

  function renderOverview() {
    const now = new Date();
    const h   = now.getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const dateStr = now.toLocaleDateString('en-GH', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

    const helloEl = document.getElementById('overview-hello');
    const dateEl  = document.getElementById('overview-date');
    if (helloEl) helloEl.textContent = greet + ', Manager';
    if (dateEl)  dateEl.textContent  = dateStr;

    const active = S.trips.active;
    const totalBooked = active.reduce((s, t) => s + (t.bookedCount || 0), 0);
    const totalRev    = active.reduce((s, t) => s + parseFloat(t.revenueTotal || 0), 0);
    const avgOcc      = active.length
      ? Math.round(active.reduce((s, t) => s + (t.occupancyPercent || 0), 0) / active.length)
      : 0;

    document.getElementById('ov-kpi-trips').textContent    = active.length;
    document.getElementById('ov-kpi-booked').textContent   = totalBooked;
    document.getElementById('ov-kpi-revenue').textContent  = ghs(totalRev);
    document.getElementById('ov-kpi-occupancy').textContent = avgOcc + '%';

    const grid = document.getElementById('overview-trip-grid');
    const upcoming = [...active, ...S.trips.recent.filter(t => t.status === 'scheduled')]
      .sort((a, b) => (String(a.departure_date || '') + String(a.departure_time || ''))
        .localeCompare(String(b.departure_date || '') + String(b.departure_time || '')));

    if (upcoming.length === 0) {
      grid.innerHTML = '<div class="app-empty"><i class="fa-solid fa-calendar-xmark"></i><p>No upcoming trips.</p></div>';
      return;
    }
    grid.innerHTML = upcoming.map(t => overviewTripCardHtml(t)).join('');
  }

  function overviewTripCardHtml(t) {
    const occ = Math.round(t.occupancyPercent || 0);
    const seatsLeft = t.seatLeft != null ? t.seatLeft : '—';
    const statusLabel = t.status === 'scheduled' ? '<span class="app-badge app-badge--amber" style="font-size:11px;">Scheduled</span>' : '';
    return `<div class="app-overview-trip-card">
  <div class="app-overview-trip-card__route">${t.routeName || '—'} ${statusLabel}</div>
  <div class="app-overview-trip-card__meta">${t.departureDate || ''} ${t.departureTime || ''} &bull; ${t.busName || '—'}</div>
  <div class="app-overview-trip-card__stats">
    <div class="app-overview-trip-card__stat"><label>Revenue</label><span>${ghs(t.revenueTotal)}</span></div>
    <div class="app-overview-trip-card__stat"><label>Seats left</label><span>${seatsLeft}</span></div>
  </div>
  <div class="app-progress-bar" title="${occ}% occupancy">
    <div class="app-progress-bar__fill" style="width:${occ}%"></div>
  </div>
</div>`;
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
    const occ = Math.round(t.occupancyPercent || 0);
    const statusBadge = statusPill(t.status);
    const dep = t.departureStationName || '—';
    const arr = t.arrivalStationName || '—';

    return `<div class="app-trip-card">
  <div class="app-trip-card__top">
    <div>
      <div class="app-trip-card__route">${t.routeName || '—'}</div>
      <div class="app-trip-card__meta">
        ${t.departureDate || ''} ${t.departureTime || ''}
        &bull; ${t.busName || '—'}
        ${t.operatorName ? '&bull; ' + t.operatorName : ''}
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
      <div class="app-trip-stat__value">${t.bookedCount || 0}</div>
      <div class="app-trip-stat__label">Booked</div>
    </div>
    <div class="app-trip-stat">
      <div class="app-trip-stat__value">${t.boardedCount || 0}</div>
      <div class="app-trip-stat__label">Boarded</div>
    </div>
    <div class="app-trip-stat">
      <div class="app-trip-stat__value">${t.seatLeft != null ? t.seatLeft : '—'}</div>
      <div class="app-trip-stat__label">Seats left</div>
    </div>
    <div class="app-trip-stat">
      <div class="app-trip-stat__value">${ghs(t.revenueTotal)}</div>
      <div class="app-trip-stat__label">Revenue</div>
    </div>
  </div>

  <div class="app-trip-card__actions">
    ${t.status === 'scheduled' ? `<button class="app-btn app-btn--primary app-btn--sm" onclick="adminApp.startTrip('${t.id}')"><i class="fa-solid fa-play"></i> Start Trip</button>` : ''}
    ${t.status === 'active' ? `<button class="app-btn app-btn--danger app-btn--sm" onclick="adminApp.endTrip('${t.id}')"><i class="fa-solid fa-flag-checkered"></i> End Trip</button>` : ''}
    <button class="app-btn app-btn--ghost app-btn--sm"
      onclick="adminApp.notifyTrip('${t.id}')">
      <i class="fa-solid fa-bell"></i> Notify
    </button>
    <button class="app-btn app-btn--ghost app-btn--sm"
      onclick="adminApp.viewTripPassengers('${t.id}','${(t.routeName||'').replace(/'/g,'')}')">
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
    const totalBooked = all.reduce((s, t) => s + (t.bookedCount || 0), 0);
    const totalRev    = all.reduce((s, t) => s + parseFloat(t.revenueTotal || 0), 0);
    const avgOcc = all.length
      ? Math.round(all.reduce((s, t) => s + (t.occupancyPercent || 0), 0) / all.length)
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
     TRIP ACTIONS
  ════════════════════════════════════════════════ */
  async function checkinPassenger(bookingId) {
    const btn = document.getElementById('checkin-btn-' + bookingId);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }
    try {
      await api('/admin/bookings/' + bookingId + '/checkin', { method: 'POST' });
      toast('Passenger checked in.');
      // Update card state without full reload
      const card = document.getElementById('pax-card-' + bookingId);
      if (card) {
        card.classList.add('is-boarded');
        const badgeSpan = card.querySelector('.app-badge.app-badge--amber');
        if (badgeSpan) { badgeSpan.className = 'app-badge app-badge--green'; badgeSpan.textContent = 'Boarded'; }
      }
      if (btn) { btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Boarded ✓'; }
    } catch (e) {
      toast(e.message, false);
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-clipboard-check"></i> Check In'; }
    }
  }

  async function notifyTrip(tripId) {
    const message = await adminPrompt('Message to send to all passengers on this trip:', 'Type your message…');
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
    checkinPassenger(bookingId) {
      checkinPassenger(bookingId);
    },
    async startTrip(id) {
      try {
        await api('/admin/trips/' + id + '/start', { method: 'POST' });
        toast('Trip started.');
        S.loaded.delete('trips');
        loadTrips();
        if (S.loaded.has('overview')) { S.loaded.delete('overview'); loadOverview(); }
      } catch (e) { toast(e.message, false); }
    },
    async endTrip(id) {
      if (!await adminConfirm('End this trip? This will mark it as completed and restore seat capacity.')) return;
      try {
        await api('/admin/trips/' + id + '/end', { method: 'POST' });
        toast('Trip ended.');
        S.loaded.delete('trips');
        loadTrips();
        if (S.loaded.has('overview')) { S.loaded.delete('overview'); loadOverview(); }
      } catch (e) { toast(e.message, false); }
    },
    notifyTrip,
    viewTripPassengers(tripId, routeName) {
      document.getElementById('pax-route-filter').value = '';
      S.passengers.routeId  = '';
      S.passengers.dateFrom = '';
      S.passengers.dateTo   = '';
      S.passengers.status   = '';
      S.passengers.search   = '';
      S.loaded.delete('passengers');
      switchTab('passengers');
    },
    async smsSingle(bookingId, phone, name) {
      const msg = await adminPrompt(`SMS to ${name} (${phone}):`, 'Type your message…');
      if (!msg) return;
      api('/admin/sms/send', {
        method: 'POST',
        body: JSON.stringify({ phone, name, message: msg.trim() })
      }).then(() => toast(`Sent to ${phone}.`)).catch(e => toast(e.message, false));
    },
    viewReceipt(bookingId) {
      const booking = (S.passengers.list || []).find((item) => String(item.id) === String(bookingId));
      if (!booking) {
        toast('Passenger booking could not be found.', false);
        return;
      }
      const ticketPayload = buildTicketPayloadFromBooking(booking);
      if (!ticketPayload) {
        toast('Receipt details are not ready yet.', false);
        return;
      }
      openTicketReceipt(ticketPayload, `Ticket - ${ticketPayload.bookingId || 'Booking'}`);
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
        active = active.filter(t => String(t.routeId) === routeId);
        recent = recent.filter(t => String(t.routeId) === routeId);
      }
      if (opId) {
        active = active.filter(t => String(t.operatorId) === opId);
        recent = recent.filter(t => String(t.operatorId) === opId);
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

    // Overview refresh
    document.getElementById('overview-refresh-btn')?.addEventListener('click', () => {
      S.loaded.delete('overview');
      loadOverview();
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
    // Overview loads first (also populates routes/operators used in other tabs)
    S.loaded.add('overview');
    loadOverview();
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
