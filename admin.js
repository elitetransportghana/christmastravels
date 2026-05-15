(function () {
  const API_BASE = 'https://realeliteweb-app.elitetransportghana.workers.dev/api';
  const toastEl = document.getElementById('toast');
  const adminMetaEl = document.getElementById('admin-meta');
  const adminSyncChipEl = document.getElementById('admin-sync-chip');
  const adminUserChipEl = document.getElementById('admin-user-chip');
  const adminOverviewCopyEl = document.getElementById('admin-overview-copy');
  const routeSelect = document.getElementById('f-route');
  const dateFromInput = document.getElementById('f-date-from');
  const dateToInput = document.getElementById('f-date-to');
  const statusSelect = document.getElementById('f-status');
  const filtersForm = document.getElementById('filters-form');
  const resetFiltersBtn = document.getElementById('reset-filters');
  const manualForm = document.getElementById('manual-form');
  const addBusForm = document.getElementById('add-bus-form');
  const createTripForm = document.getElementById('create-trip-form');
  const dispatchCenterForm = document.getElementById('dispatch-center-form');
  const municipalityForm = document.getElementById('municipality-form');
  const activeTripsEls = Array.from(document.querySelectorAll('[data-trip-slot="active"], #active-trips'));
  const recentTripsEls = Array.from(document.querySelectorAll('[data-trip-slot="recent"], #recent-trips'));
  const adminBookingDeskEl = document.getElementById('admin-booking-desk');
  const adminBookingsTableBody = document.getElementById('admin-bookings-table-body');
  const manualRouteListEl = document.getElementById('manual-route-list');
  const manualSeatmapEl = document.getElementById('manual-seatmap');
  const manualSummaryEl = document.getElementById('manual-selected-summary');
  const fleetListEl = document.getElementById('fleet-list');
  const dispatchCenterListEl = document.getElementById('dispatch-center-list');
  const municipalityListEl = document.getElementById('municipality-list');
  const tabButtons = Array.from(document.querySelectorAll('[data-tab]'));
  const tabPanels = Array.from(document.querySelectorAll('[data-panel]'));
  const GOVERNANCE_TABS = new Set(['overview', 'bookings', 'trips', 'reference', 'operators', 'commissions']);
  const TICKET_STORAGE_KEY = 'latestConfirmedTicket';

  let fleetSnapshot = { routes: [], buses: [], activeTrips: [], recentTrips: [] };
  let referenceSnapshot = { dispatchCenters: [], municipalities: [] };
  let manualState = {
    selectedRoute: null,
    selectedBus: null,
    selectedSeat: null,
    available: [],
    locked: [],
    booked: []
  };

  function notify(message, ok = true) {
    toastEl.textContent = message;
    toastEl.style.background = ok ? '#184040' : '#a62525';
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function clearAdminSession(redirect = false) {
    localStorage.removeItem('authToken');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    localStorage.removeItem('eliteAuthStorageMode');
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('eliteAuthStorageMode');

    if (redirect) {
      window.location.replace('./login.html');
    }
  }

  function readToken() {
    const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    const token = hash.get('token') || localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || '';
    return String(token || '').trim();
  }

  async function ensureAdminToken() {
    const token = readToken();
    if (!token) return '';

    try {
      const res = await fetch(`${API_BASE}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.valid) {
        throw new Error(data?.error || 'Invalid session');
      }
      if (!data?.user?.isAdmin) {
        throw new Error('Admin access required');
      }
      return token;
    } catch (_err) {
      clearAdminSession(true);
      return '';
    }
  }

  async function api(path, token, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {})
      },
      body: options.body || undefined
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  function fillSelect(selectEl, items, mapFn, placeholder) {
    const options = [`<option value="">${placeholder}</option>`].concat(items.map(mapFn));
    selectEl.innerHTML = options.join('');
  }

  function renderSummary(summary) {
    const visibleBookings = Number(summary.visibleBookings ?? summary.totalBookings ?? 0);
    const matchingBookings = Number(summary.matchingBookings ?? visibleBookings);

    document.getElementById('m-total-bookings').textContent = visibleBookings;
    document.getElementById('m-total-routes').textContent = summary.totalRoutes ?? 0;
    document.getElementById('m-total-buses').textContent = summary.totalBuses ?? 0;
    document.getElementById('m-total-revenue').textContent = Number(summary.totalRevenue || 0).toFixed(2);
    adminMetaEl.textContent = 'Filtered marketplace demand, operator inventory, and confirmed revenue across the current admin view.';

    const totalRoutes = Number(summary.totalRoutes || 0);
    const totalBuses = Number(summary.totalBuses || 0);
    const totalRevenue = Number(summary.totalRevenue || 0);

    if (adminSyncChipEl) {
      adminSyncChipEl.textContent = `Synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${visibleBookings} in view${matchingBookings !== visibleBookings ? ` · ${matchingBookings} matching` : ''}`;
    }
    if (adminOverviewCopyEl) {
      adminOverviewCopyEl.textContent = `Platform snapshot: ${visibleBookings} bookings in the current view, ${totalRoutes} public routes, ${totalBuses} buses, and GHS ${totalRevenue.toFixed(2)} in confirmed marketplace revenue.`;
    }
  }

  function renderAdminUser(admin) {
    if (!adminUserChipEl) return;
    const label = admin?.name || admin?.email || 'Marketplace admin';
    adminUserChipEl.textContent = label;
  }

  function renderRouteFilter(availableRoutes) {
    const current = routeSelect.value;
    fillSelect(routeSelect, availableRoutes || [], (r) => `<option value="${r.id}">${r.name}</option>`, 'All routes');
    if (current && routeSelect.querySelector(`option[value="${current}"]`)) routeSelect.value = current;
  }

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

  function escapeAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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

  function passengerCard(p) {
    const fullName = `${p.firstName || ''} ${p.lastName || ''}`.trim();
    const departure = [p.departureDate, p.departureTime].filter(Boolean).join(' ');
    const ticketPayload = buildTicketPayloadFromBooking(p);
    const ticketUrl = ticketPayload ? buildTicketPageUrl(ticketPayload) : '';
    const ticketData = ticketPayload ? escapeAttr(JSON.stringify(ticketPayload)) : '';
    const receipt = ticketPayload
      ? `<a class="receipt-link js-admin-ticket-link" href="${ticketUrl}" data-ticket-payload="${ticketData}" target="_blank" rel="noopener noreferrer">View styled receipt</a>${p.receiptUrl ? ` <a class="receipt-link" href="${p.receiptUrl}" target="_blank" rel="noopener noreferrer">Raw file</a>` : ''}`
      : '<span style="color:#879;">No receipt</span>';

    return `
      <article class="passenger-item">
        <div class="line"><strong>${fullName || 'Passenger'}</strong></div>
        <div class="line">Bus: ${p.busName || '-'} | Seat: ${p.seat || '-'}</div>
        <div class="line">Phone: ${p.phone || '-'}</div>
        <div class="line">Email: ${p.email || '-'}</div>
        <div class="line">NOK: ${p.nextOfKinName || '-'} (${p.nextOfKinPhone || '-'})</div>
        <div class="line">Status: ${p.status || '-'}</div>
        <div class="line">Fare: GHS ${Number(p.pricePaid || 0).toFixed(2)}</div>
        <div class="line">Departure: ${departure || '-'}</div>
        <div class="line">${receipt}</div>
      </article>
    `;
  }

  function renderGroupedRoutes(groups) {
    const host = document.getElementById('route-groups');
    if (!groups || !groups.length) {
      host.innerHTML = '<div class="meta">No matching bookings found.</div>';
      return;
    }
    host.innerHTML = groups.map((group) => `
      <section class="route-card">
        <div class="route-head">
          <h3>${group.routeName || 'Route'}</h3>
          <span class="pill">${group.bookings || 0} bookings</span>
        </div>
        <div class="passenger-list">
          ${(group.passengers || []).map(passengerCard).join('')}
        </div>
      </section>
    `).join('');
  }

  function renderAdminBookingsTable(bookings) {
    if (!adminBookingsTableBody) return;
    const rows = bookings || [];
    if (!rows.length) {
      adminBookingsTableBody.innerHTML = '<tr><td colspan="7">No bookings match the current filters.</td></tr>';
      return;
    }

    adminBookingsTableBody.innerHTML = rows.map((booking) => {
      const passengerName = `${booking.first_name || ''} ${booking.last_name || ''}`.trim() || 'Passenger';
      const departure = [booking.departure_date, booking.departure_time].filter(Boolean).join(' · ') || 'No departure';
      const rawSeat = booking.seat_number;
      const seat = Number.isFinite(Number(rawSeat)) ? String(rawSeat).padStart(2, '0') : '—';
      return `
        <tr>
          <td><strong>${passengerName}</strong><div class="meta-line">${booking.phone || booking.email || 'No contact'}</div></td>
          <td>${booking.operator_name || 'Operator'}</td>
          <td>${booking.route_name || 'Route'}</td>
          <td>${departure}</td>
          <td>${seat}</td>
          <td>GHS ${Number(booking.price_paid || 0).toFixed(2)}</td>
          <td>${String(booking.payment_method || 'online').toUpperCase()}</td>
        </tr>
      `;
    }).join('');
  }

  function renderTripSummary(activeTrips, recentTrips) {
    const visibleTrips = [...activeTrips, ...recentTrips];
    const booked = visibleTrips.reduce((sum, trip) => sum + Number(trip.bookedCount || 0), 0);
    const boarded = visibleTrips.reduce((sum, trip) => sum + Number(trip.boardedCount || 0), 0);
    const revenue = visibleTrips.reduce((sum, trip) => sum + Number(trip.revenueTotal || 0), 0);

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    setText('at-active', String(activeTrips.length));
    setText('at-visible', String(visibleTrips.length));
    setText('at-booked', String(booked));
    setText('at-boarded', String(boarded));
    setText('at-revenue', `GHS ${revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }

  function renderTrips() {
    const activeTrips = fleetSnapshot.activeTrips || [];
    const recentTrips = fleetSnapshot.recentTrips || [];
    renderTripSummary(activeTrips, recentTrips);

    const renderHost = (hosts, html) => {
      hosts.forEach((host) => {
        if (host) host.innerHTML = html;
      });
    };

    const paymentMixLabel = (trip) => {
      const parts = [];
      const cash = Number(trip.cashCount || 0);
      const momo = Number(trip.momoCount || 0);
      const card = Number(trip.cardCount || 0);
      const online = Number(trip.onlineCount || 0);
      if (cash) parts.push(`Cash ${cash}`);
      if (momo) parts.push(`MoMo ${momo}`);
      if (card) parts.push(`Card ${card}`);
      if (online) parts.push(`Online ${online}`);
      return parts.join(' · ') || 'No payment mix yet';
    };

    const tripCard = (trip, isRecent = false) => {
      const departure = [trip.departureDate, trip.departureTime].filter(Boolean).join(' ') || 'No departure set';
      const revised = [trip.revisedDepartureDate, trip.revisedDepartureTime].filter(Boolean).join(' ');
      const stations = [trip.departureStationName, trip.arrivalStationName].filter(Boolean).join(' to ') || 'Stations not assigned';
      const revenueText = `GHS ${Number(trip.revenueTotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return `
        <div class="trip-item">
          <div>
            <strong>${trip.routeName || 'Route'}</strong>
            <div class="meta-line">${trip.operatorName || 'Operator'} | ${trip.busName || 'Bus'} | Trip #${trip.id}</div>
          </div>
          <div class="meta-line">${departure}</div>
          <div class="meta-line">Driver: ${trip.driverName || 'Unassigned'}${trip.driverPhone ? ` · ${trip.driverPhone}` : trip.driverEmail ? ` · ${trip.driverEmail}` : ''}</div>
          <div class="meta-line">${stations}</div>
          <div class="meta-line">Booked: ${Number(trip.bookedCount || 0)} · Boarded: ${Number(trip.boardedCount || 0)} · Seats left: ${Number(trip.seatLeft || 0)} · Occupancy: ${Number(trip.occupancyPercent || 0)}%</div>
          <div class="meta-line">Revenue: ${revenueText} · ${paymentMixLabel(trip)}</div>
          ${revised ? `<div class="meta-line">Revised departure: ${revised}</div>` : ''}
          ${isRecent && trip.cancelReason ? `<div class="meta-line">Cancellation: ${trip.cancelReason}</div>` : ''}
          <div class="trip-item__actions">
            <button class="trip-action-btn trip-action-btn--sms" data-view-trip-manifest="${trip.id}"><i class="fa-solid fa-users"></i> Passengers</button>
          </div>
        </div>
      `;
    };

    if (!activeTrips.length) {
      renderHost(activeTripsEls, '<div class="meta">No active trips.</div>');
    } else {
      renderHost(activeTripsEls, activeTrips.map((trip) => tripCard(trip)).join(''));
    }

    if (!recentTrips.length) {
      renderHost(recentTripsEls, '<div class="meta">No recent completed trips.</div>');
    } else {
      renderHost(recentTripsEls, recentTrips.map((trip) => tripCard(trip, true)).join(''));
    }
  }

  function renderFleetList() {
    if (!fleetListEl) return;
    const routesById = new Map((fleetSnapshot.routes || []).map((route) => [Number(route.id), route.name]));
    const buses = fleetSnapshot.buses || [];

    const countPill = document.getElementById('fleet-count-pill');
    if (countPill) countPill.textContent = `${buses.length} buses`;

    if (!buses.length) {
      fleetListEl.innerHTML = '<div class="meta">No buses available yet.</div>';
      return;
    }

    fleetListEl.innerHTML = buses.map((bus) => `
      <article class="fleet-item">
        <div class="fleet-item__row">
          <div>
            <div class="fleet-item__title">${bus.name || 'Bus'}</div>
            <div class="fleet-item__meta">${bus.plate_number || 'No plate'} · ${routesById.get(Number(bus.route_id)) || 'Unassigned route'}</div>
          </div>
          <span class="pill">${Number(bus.available_seats ?? bus.availableSeats ?? 0)}/${Number(bus.capacity || 0)} seats</span>
        </div>
        <div class="fleet-item__meta">Default price: GHS ${Number(bus.price || 0).toFixed(2)}${bus.amenities_json ? ' · ' + JSON.parse(bus.amenities_json).join(', ') : ''}</div>
        <div class="fleet-item__actions">
          <button class="fleet-btn-edit" data-edit-bus='${JSON.stringify({ id: bus.id, name: bus.name, plate_number: bus.plate_number, route_id: bus.route_id, capacity: bus.capacity, available_seats: bus.available_seats ?? bus.availableSeats, price: bus.price, amenities_json: bus.amenities_json }).replace(/'/g, '&apos;')}'><i class="fa-solid fa-pen"></i> Edit</button>
          <button class="fleet-btn-delete" data-delete-bus="${bus.id}" data-bus-name="${(bus.name || 'Bus').replace(/"/g, '&quot;')}"><i class="fa-solid fa-trash"></i> Delete</button>
        </div>
      </article>
    `).join('');
  }

  function renderReferenceList(host, items, emptyText, mapFn) {
    if (!host) return;
    if (!items || !items.length) {
      host.innerHTML = `<div class="meta">${emptyText}</div>`;
      return;
    }

    host.innerHTML = items.map(mapFn).join('');
  }

  function renderReferenceData() {
    renderReferenceList(
      dispatchCenterListEl,
      referenceSnapshot.dispatchCenters,
      'No dispatch centers yet.',
      (center) => `
        <article class="reference-item">
          <div class="reference-item__row">
            <div>
              <div class="reference-item__title">${center.name || 'Dispatch center'}</div>
              <div class="reference-item__meta">${center.region || 'No region set'}</div>
            </div>
            <span class="pill">Dispatch</span>
          </div>
        </article>
      `
    );

    renderReferenceList(
      municipalityListEl,
      referenceSnapshot.municipalities,
      'No municipalities yet.',
      (municipality) => `
        <article class="reference-item">
          <div class="reference-item__row">
            <div>
              <div class="reference-item__title">${municipality.name || 'Municipality'}</div>
              <div class="reference-item__meta">${municipality.region || 'No region'}${municipality.capital ? ` · Capital: ${municipality.capital}` : ''}</div>
            </div>
            <span class="pill">Municipal</span>
          </div>
        </article>
      `
    );
  }

  function activateTab(tabName) {
    tabButtons.forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tabName));
    tabPanels.forEach((p) => p.classList.toggle('active', p.getAttribute('data-panel') === tabName));
  }

  function setupTabs() {
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (!tab) return;
        activateTab(tab);
      });
    });
    activateTab('overview');
  }

  function renderGovernanceOverviewNote() {
    if (adminOverviewCopyEl) {
      adminOverviewCopyEl.textContent = 'Watch marketplace performance, operator health, and trip movement here. Platform Trips is read-only and operator operations stay tenant-owned.';
    }
  }

  function applyGovernanceMode() {
    tabButtons.forEach((btn) => {
      const tab = btn.getAttribute('data-tab');
      const isAllowed = GOVERNANCE_TABS.has(tab);
      btn.hidden = !isAllowed;
      btn.disabled = !isAllowed;
    });

    tabPanels.forEach((panel) => {
      const tab = panel.getAttribute('data-panel');
      const isAllowed = GOVERNANCE_TABS.has(tab);
      panel.hidden = !isAllowed;
      if (!isAllowed) panel.classList.remove('active');
    });

    if (adminMetaEl) {
      adminMetaEl.textContent = 'Govern approvals, subscriptions, trips, reference data, operators, and settlement workflows from one platform console.';
    }
    if (adminOverviewCopyEl) {
      adminOverviewCopyEl.textContent = 'Watch marketplace performance, tenant health, and trip activity here. Platform Trips is read-only while route, fleet, and check-in actions stay in each operator workspace.';
    }

    renderGovernanceOverviewNote();
  }

  function syncFleetDropdowns() {
    const routes = fleetSnapshot.routes || [];
    const buses = fleetSnapshot.buses || [];
    const activeTrips = fleetSnapshot.activeTrips || [];
    const busyBusIds = new Set(activeTrips.map((t) => Number(t.busId)));

    fillSelect(document.getElementById('b-route'), routes, (r) => `<option value="${r.id}">${r.name}</option>`, 'Select route');
    fillSelect(document.getElementById('t-route'), routes, (r) => `<option value="${r.id}">${r.name}</option>`, 'Select route');
    fillSelect(
      document.getElementById('t-bus'),
      buses.filter((b) => !busyBusIds.has(Number(b.id))),
      (b) => `<option value="${b.id}">${b.name} (${b.plate_number || 'no plate'}) seats ${b.available_seats}/${b.capacity}</option>`,
      'Select available bus'
    );
  }

  function seatNumToBackendLabel(seatNum) {
    return String(seatNum);
  }

  function seatLayoutRows() {
    return [
      [0, 1, 0, 0, 0],
      [2, 3, 'aisle', 4, 5],
      [6, 7, 'aisle', 8, 9],
      [10, 11, 'aisle', 12, 13],
      [14, 15, 'aisle', 16, 17],
      [18, 19, 'aisle', 20, 21],
      [22, 23, 'aisle', 24, 25],
      [26, 27, 'aisle', 'stairs', 'stairs'],
      [28, 29, 'aisle', 30, 31],
      [32, 33, 'aisle', 34, 35],
      [36, 37, 'aisle', 38, 39],
      [40, 41, 'aisle', 42, 43],
      [44, 45, 'aisle', 'void', 'void'],
      [46, 47, 48, 49, 50]
    ];
  }

  function renderManualSummary() {
    if (!manualState.selectedBus) {
      manualSummaryEl.textContent = 'No bus selected.';
      return;
    }
    const b = manualState.selectedBus;
    const r = manualState.selectedRoute;
    const seat = manualState.selectedSeat || '-';
    manualSummaryEl.innerHTML = `
      <strong>${r?.name || 'Route'}</strong><br>
      ${b.name} (${b.plate_number || 'no plate'})<br>
      Trip: ${b.tripId || '-'} | Price: GHS ${Number(b.price || 0).toFixed(2)}<br>
      Selected seat: <strong>${seat}</strong>
    `;
    document.getElementById('m-seat').value = manualState.selectedSeat || '';
  }

  async function loadManualSeatmap() {
    if (!manualState.selectedBus) {
      manualSeatmapEl.innerHTML = '<div class="meta">Select a bus to view seats.</div>';
      return;
    }
    try {
      const tripQ = manualState.selectedBus.tripId ? `?tripId=${encodeURIComponent(manualState.selectedBus.tripId)}` : '';
      const data = await fetch(`${API_BASE}/bus/${manualState.selectedBus.id}/seats${tripQ}`, { cache: 'no-store' }).then((r) => r.json());
      manualState.available = data.available || [];
      manualState.locked = data.locked || [];
      manualState.booked = data.booked || [];

      const rows = seatLayoutRows();
      manualSeatmapEl.innerHTML = rows.map((row) => {
        const slots = row.map((slot) => {
          if (slot === 0 || slot === 'void') return '<div class="seat-slot void"></div>';
          if (slot === 'aisle') return '<div class="seat-slot aisle"></div>';
          if (slot === 'stairs') return '<div class="seat-slot stairs"></div>';

          const seatLabel = seatNumToBackendLabel(Number(slot));
          const text = String(slot).padStart(2, '0');
          const isBooked = manualState.booked.includes(seatLabel);
          const isLocked = manualState.locked.includes(seatLabel);
          const isSelected = manualState.selectedSeat === seatLabel;
          const cls = [
            'seat-btn',
            isBooked ? 'booked' : '',
            isLocked ? 'locked' : '',
            isSelected ? 'selected' : ''
          ].join(' ').trim();
          const disabled = isBooked || isLocked ? 'disabled' : '';
          return `<div class="seat-slot"><button type="button" class="${cls}" data-seat="${seatLabel}" ${disabled}>${text}</button></div>`;
        }).join('');
        return `<div class="seat-row">${slots}</div>`;
      }).join('');
    } catch (err) {
      manualSeatmapEl.innerHTML = '<div class="meta">Failed to load seat map.</div>';
      notify(`Seat map load failed: ${err.message}`, false);
    }
  }

  function renderManualRoutes(routeData) {
    const sections = [];
    Object.values(routeData || {}).forEach((routes) => {
      (routes || []).forEach((route) => {
        const buses = (route.buses || []).filter((b) => Number(b.availableSeats ?? b.available_seats ?? 0) > 0);
        if (!buses.length) return;
        sections.push(`
          <section class="manual-route-card">
            <h4 class="manual-route-title">${route.name}</h4>
            ${buses.map((bus) => `
              <div class="manual-bus-item">
                <div>
                  <strong>${bus.name}</strong>
                  <div class="meta-line">${bus.route || route.name}</div>
                </div>
                <div class="meta-line">${Number(bus.availableSeats ?? bus.available_seats ?? 0)} seats</div>
                <button type="button" data-select-bus='${JSON.stringify({ route, bus }).replace(/'/g, '&apos;')}'>Select</button>
              </div>
            `).join('')}
          </section>
        `);
      });
    });

    manualRouteListEl.innerHTML = sections.length ? sections.join('') : '<div class="meta">No active trips with available seats.</div>';
  }

  async function loadManualRoutes() {
    try {
      const data = await fetch(`${API_BASE}/routes`, { cache: 'no-store' }).then((r) => r.json());
      renderManualRoutes(data);
    } catch (err) {
      manualRouteListEl.innerHTML = '<div class="meta">Failed to load routes.</div>';
      notify(`Manual routes load failed: ${err.message}`, false);
    }
  }

  function buildFilterQuery() {
    const q = new URLSearchParams();
    q.set('limit', '300');
    if (routeSelect.value) q.set('routeId', routeSelect.value);
    if (dateFromInput.value) q.set('dateFrom', dateFromInput.value);
    if (dateToInput.value) q.set('dateTo', dateToInput.value);
    if (statusSelect.value) q.set('status', statusSelect.value);
    return q.toString();
  }

  async function loadFleet() {
    const token = await ensureAdminToken();
    if (!token) return;
    fleetSnapshot = await api('/admin/fleet/options', token);
    syncFleetDropdowns();
    renderTrips();
    renderFleetList();
    loadManifestTrips();
  }

  async function loadReferenceData() {
    try {
      const [dispatchCenters, municipalities] = await Promise.all([
        fetch(`${API_BASE}/specials/dispatch-centers`, { cache: 'no-store' }).then((res) => res.json()),
        fetch(`${API_BASE}/specials/municipalities`, { cache: 'no-store' }).then((res) => res.json())
      ]);

      referenceSnapshot.dispatchCenters = Array.isArray(dispatchCenters) ? dispatchCenters : [];
      referenceSnapshot.municipalities = Array.isArray(municipalities) ? municipalities : [];
      renderReferenceData();
    } catch (err) {
      referenceSnapshot.dispatchCenters = [];
      referenceSnapshot.municipalities = [];
      renderReferenceData();
      notify(`Reference data load failed: ${err.message}`, false);
    }
  }

  async function loadBookings() {
    const token = await ensureAdminToken();
    if (!token) return;
    const data = await api(`/admin/bookings/upcoming?${buildFilterQuery()}`, token);
    renderSummary(data.summary || {});
    renderAdminUser(data.admin || null);
    renderRouteFilter(data.availableRoutes || []);
    renderGroupedRoutes(data.groupedByRoute || []);
    renderAdminBookingsTable(data.bookings || []);
  }

  let adminBookingDesk = null;

  function mountAdminBookingDesk() {
    if (!adminBookingDeskEl || !window.DashboardBookingDesk?.mount) return;
    adminBookingDesk = window.DashboardBookingDesk.mount(adminBookingDeskEl, {
      context: 'admin',
      apiBase: API_BASE,
      getAuthToken: readToken,
      bookingEndpoint: '/admin/bookings/manual',
      notify: (type, message) => notify(message, type !== 'error'),
      onBookingCreated: async (data, bookingContext) => {
        const ticketPayload = bookingContext?.ticketPayload || buildTicketPayloadFromBooking(data);
        if (ticketPayload) {
          storeTicketPayload(ticketPayload, true);
          window.open(buildTicketPageUrl(ticketPayload), '_blank', 'noopener');
        }
        await Promise.all([loadBookings(), loadFleet()]);
      }
    });
    return adminBookingDesk;
  }

  async function loadAll() {
    const token = await ensureAdminToken();
    if (!token) {
      return;
    }
    document.getElementById('back-link').href = '/';
    mountAdminBookingDesk();

    try {
      await Promise.all([loadBookings(), loadReferenceData(), loadOperators(), loadCommissions(), loadFleet()]);
      renderGovernanceOverviewNote();
    } catch (err) {
      notify(`Admin load failed: ${err.message}`, false);
    }
  }

  async function submitManualBooking(e) {
    e.preventDefault();
    if (!manualState.selectedBus) {
      notify('Select a bus first.', false);
      return;
    }
    if (!manualState.selectedSeat) {
      notify('Select a seat from seat map.', false);
      return;
    }



    const token = await ensureAdminToken();
    if (!token) {
      notify('Admin sign-in is required.', false);
      return;
    }
    const body = {
      firstName: document.getElementById('m-first').value.trim(),
      lastName: document.getElementById('m-last').value.trim(),
      email: document.getElementById('m-email').value.trim(),
      phone: document.getElementById('m-phone').value.trim(),
      nokName: document.getElementById('m-nok-name').value.trim() || null,
      nokPhone: document.getElementById('m-nok-phone').value.trim() || null,
      busId: Number(manualState.selectedBus.id),
      tripId: manualState.selectedBus.tripId ? Number(manualState.selectedBus.tripId) : null,
      seat: manualState.selectedSeat,
      pricePaid: document.getElementById('m-price').value ? Number(document.getElementById('m-price').value) : Number(manualState.selectedBus.price || 0)
    };

    try {
      const result = await api('/admin/bookings/manual', token, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      notify(`Booking created: ${result.booking_id}`);
      manualForm.reset();
      manualState.selectedSeat = null;
      renderManualSummary();
      await Promise.all([loadFleet(), loadBookings(), loadManualRoutes(), loadManualSeatmap()]);
    } catch (err) {
      notify(`Manual booking failed: ${err.message}`, false);
      await loadManualSeatmap();
    }
  }

  async function submitAddBus(e) {
    e.preventDefault();
    const token = await ensureAdminToken();
    if (!token) {
      notify('Admin sign-in is required.', false);
      return;
    }
    const body = {
      name: document.getElementById('b-name').value.trim(),
      plateNumber: document.getElementById('b-plate').value.trim() || null,
      routeId: Number(document.getElementById('b-route').value),
      capacity: Number(document.getElementById('b-capacity').value),
      availableSeats: document.getElementById('b-available').value ? Number(document.getElementById('b-available').value) : null,
      price: document.getElementById('b-price').value ? Number(document.getElementById('b-price').value) : null,
      amenitiesJson: document.getElementById('b-amenities').value.trim() ? JSON.stringify(document.getElementById('b-amenities').value.split(',').map(s => s.trim()).filter(Boolean)) : null
    };
    try {
      await api('/admin/buses', token, { method: 'POST', body: JSON.stringify(body) });
      notify('Bus added successfully');
      addBusForm.reset();
      await Promise.all([loadFleet(), loadManualRoutes()]);
    } catch (err) {
      notify(`Add bus failed: ${err.message}`, false);
    }
  }

  async function submitCreateTrip(e) {
    e.preventDefault();
    const token = await ensureAdminToken();
    if (!token) {
      notify('Admin sign-in is required.', false);
      return;
    }
    const body = {
      routeId: Number(document.getElementById('t-route').value),
      busId: Number(document.getElementById('t-bus').value),
      departureDate: document.getElementById('t-date').value || null,
      departureTime: document.getElementById('t-time').value || null,
      price: document.getElementById('t-price').value ? Number(document.getElementById('t-price').value) : null,
      cancellationPolicy: document.getElementById('t-cancel-policy').value || 'flexible',
      luggagePolicy: document.getElementById('t-luggage').value.trim() || null,
      description: document.getElementById('t-description').value.trim() || null,
      departureInstructions: document.getElementById('t-instructions').value.trim() || null
    };
    try {
      await api('/admin/trips', token, { method: 'POST', body: JSON.stringify(body) });
      notify('Trip created and bus assigned');
      createTripForm.reset();
      await loadAll();
    } catch (err) {
      notify(`Create trip failed: ${err.message}`, false);
    }
  }

  async function submitDispatchCenter(e) {
    e.preventDefault();
    const token = await ensureAdminToken();
    if (!token) {
      notify('Admin sign-in is required.', false);
      return;
    }
    const body = {
      name: document.getElementById('dispatch-center-name').value.trim(),
      region: document.getElementById('dispatch-center-region').value.trim() || null
    };

    try {
      await api('/admin/specials/dispatch-centers', token, { method: 'POST', body: JSON.stringify(body) });
      notify('Dispatch center added successfully');
      dispatchCenterForm.reset();
      await loadReferenceData();
    } catch (err) {
      notify(`Dispatch center failed: ${err.message}`, false);
    }
  }

  async function submitMunicipality(e) {
    e.preventDefault();
    const token = await ensureAdminToken();
    if (!token) {
      notify('Admin sign-in is required.', false);
      return;
    }
    const body = {
      name: document.getElementById('municipality-name').value.trim(),
      region: document.getElementById('municipality-region').value.trim() || null,
      capital: document.getElementById('municipality-capital').value.trim() || null
    };

    try {
      await api('/admin/specials/municipalities', token, { method: 'POST', body: JSON.stringify(body) });
      notify('Municipality added successfully');
      municipalityForm.reset();
      await loadReferenceData();
    } catch (err) {
      notify(`Municipality failed: ${err.message}`, false);
    }
  }

  async function maybeEndTrip(e) {
    const btn = e.target.closest('[data-end-trip]');
    if (!btn) return;
    const tripId = Number(btn.getAttribute('data-end-trip'));
    if (!tripId) return;
    const token = await ensureAdminToken();
    if (!token) {
      notify('Admin sign-in is required.', false);
      return;
    }
    try {
      await api(`/admin/trips/${tripId}/end`, token, { method: 'POST' });
      notify(`Trip #${tripId} ended. Bus reset to full capacity.`);
      await loadAll();
    } catch (err) {
      notify(`End trip failed: ${err.message}`, false);
    }
  }

  manualRouteListEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-select-bus]');
    if (!btn) return;
    const payload = JSON.parse(btn.getAttribute('data-select-bus').replace(/&apos;/g, "'"));
    manualState.selectedRoute = payload.route;
    manualState.selectedBus = payload.bus;
    manualState.selectedSeat = null;
    renderManualSummary();
    await loadManualSeatmap();
  });

  manualSeatmapEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-seat]');
    if (!btn || btn.disabled) return;
    manualState.selectedSeat = btn.getAttribute('data-seat');
    renderManualSummary();
    manualSeatmapEl.querySelectorAll('.seat-btn.selected').forEach((x) => x.classList.remove('selected'));
    btn.classList.add('selected');
  });

  filtersForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loadBookings().catch((err) => notify(`Failed to apply filters: ${err.message}`, false));
  });

  resetFiltersBtn.addEventListener('click', () => {
    routeSelect.value = '';
    dateFromInput.value = '';
    dateToInput.value = '';
    statusSelect.value = '';
    loadBookings().catch((err) => notify(`Failed to reset filters: ${err.message}`, false));
  });

  manualForm.addEventListener('submit', submitManualBooking);
  addBusForm.addEventListener('submit', submitAddBus);
  createTripForm.addEventListener('submit', submitCreateTrip);
  dispatchCenterForm?.addEventListener('submit', submitDispatchCenter);
  municipalityForm?.addEventListener('submit', submitMunicipality);
  activeTripsEls.forEach((host) => host?.addEventListener('click', maybeEndTrip));

  // ── Operator management ──
  const addOperatorForm = document.getElementById('add-operator-form');
  const operatorsListEl = document.getElementById('operators-list');
  const btnAddOperator = document.getElementById('btn-add-operator');
  const commissionsSummaryEl = document.getElementById('commissions-summary');
  const commissionsTableEl = document.getElementById('commissions-table');
  const payoutForm = document.getElementById('payout-form');
  const payoutsListEl = document.getElementById('payouts-list');
  const payOperatorSelect = document.getElementById('pay-operator');

  async function loadOperators() {
    const token = await ensureAdminToken();
    if (!token) return;
    try {
      const ops = await api('/admin/operators', token);
      renderOperators(ops);
    } catch (err) { if (operatorsListEl) operatorsListEl.innerHTML = `<p class="meta">Failed to load operators.</p>`; }
  }

  function renderOperators(ops) {
    if (!operatorsListEl) return;
    if (!ops || !ops.length) { operatorsListEl.innerHTML = '<p class="meta">No operators yet.</p>'; return; }
    operatorsListEl.innerHTML = ops.map(op => `
      <article class="operator-card card">
        <div class="operator-card__header">
          ${op.logo_url ? `<img src="${op.logo_url}" class="operator-card__logo" alt="${op.name}" />` : `<div class="operator-card__logo operator-card__logo--placeholder"><i class="fa-solid fa-bus"></i></div>`}
          <div class="operator-card__identity">
            <h3>${op.name}</h3>
            <span class="admin-card__eyebrow">${op.slug} &middot; ${op.city || 'No city'}</span>
          </div>
          <span class="operator-status operator-status--${op.status}">${op.status}</span>
        </div>
        <div class="operator-card__stats">
          <article class="operator-card__stat">
            <strong>${op.bus_count || 0}</strong>
            <span>Buses</span>
          </article>
          <article class="operator-card__stat">
            <strong>${op.booking_count || 0}</strong>
            <span>Bookings</span>
          </article>
          <article class="operator-card__stat">
            <strong>GHS ${Number(op.total_revenue || 0).toLocaleString()}</strong>
            <span>Revenue</span>
          </article>
          <article class="operator-card__stat">
            <strong>${op.avg_rating || '—'} ★</strong>
            <span>Rating</span>
          </article>
        </div>
        <div class="operator-card__details">
          <div class="operator-card__detail">
            <span>Support</span>
            <strong>${op.support_email || op.supportEmail || 'No support email'}</strong>
          </div>
          <div class="operator-card__detail">
            <span>Phone</span>
            <strong>${op.support_phone || op.supportPhone || 'No support phone'}</strong>
          </div>
          <div class="operator-card__detail">
            <span>Region</span>
            <strong>${op.region || 'Unassigned'}</strong>
          </div>
          <div class="operator-card__detail">
            <span>Commission</span>
            <strong>${(Number(op.commission_rate || op.commissionRate || 0) * 100).toFixed(1)}%</strong>
          </div>
        </div>
        <div class="operator-card__actions">
          ${op.status === 'pending' ? `<button class="btn-approve" data-op-action="approve" data-op-id="${op.id}"><i class="fa-solid fa-check"></i> Approve</button>` : ''}
          ${op.status === 'approved' ? `<button class="btn-suspend" data-op-action="suspend" data-op-id="${op.id}"><i class="fa-solid fa-pause"></i> Suspend</button>` : ''}
          ${op.status === 'suspended' ? `<button class="btn-approve" data-op-action="approve" data-op-id="${op.id}"><i class="fa-solid fa-arrow-rotate-left"></i> Re-activate</button>` : ''}
        </div>
      </article>
    `).join('');

    // Populate payout operator select
    if (payOperatorSelect) {
      payOperatorSelect.innerHTML = '<option value="">Select operator</option>' + ops.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
    }
  }

  if (operatorsListEl) {
    operatorsListEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-op-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-op-action');
      const opId = btn.getAttribute('data-op-id');
      const token = await ensureAdminToken();
      if (!token) return;
      try {
        await api(`/admin/operators/${opId}/${action}`, token, { method: 'POST' });
        notify(`Operator ${action}d successfully.`);
        await loadOperators();
      } catch (err) { notify(`Action failed: ${err.message}`, false); }
    });
  }

  if (addOperatorForm) {
    addOperatorForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = await ensureAdminToken();
      if (!token) return;
      const data = {
        name: document.getElementById('op-name').value.trim(),
        slug: document.getElementById('op-slug').value.trim(),
        supportEmail: document.getElementById('op-email').value.trim(),
        supportPhone: document.getElementById('op-phone').value.trim(),
        city: document.getElementById('op-city').value.trim(),
        region: document.getElementById('op-region').value.trim(),
        commissionRate: parseFloat(document.getElementById('op-commission').value) || 0.08,
        description: document.getElementById('op-description').value.trim()
      };
      if (!data.name || !data.slug) { notify('Name and slug are required.', false); return; }
      try {
        await api('/admin/operators', token, { method: 'POST', body: JSON.stringify(data) });
        notify('Operator created!');
        addOperatorForm.reset();
        await loadOperators();
      } catch (err) { notify(`Create failed: ${err.message}`, false); }
    });
  }

  // ── Commissions ──
  async function loadCommissions() {
    const token = await ensureAdminToken();
    if (!token) return;
    try {
      const data = await api('/admin/commissions', token);
      renderCommissions(data);
    } catch (err) { if (commissionsSummaryEl) commissionsSummaryEl.innerHTML = '<p class="meta">Failed to load commissions.</p>'; }
  }

  function renderCommissions(data) {
    if (!data) return;
    const ops = data.operators || [];
    const payouts = data.recentPayouts || [];

    const totalFares = ops.reduce((s, o) => s + Number(o.total_fares || 0), 0);
    const totalCommission = ops.reduce((s, o) => s + Number(o.total_commission || 0), 0);
    const unsettled = ops.reduce((s, o) => s + Number(o.unsettled_amount || 0), 0);

    if (commissionsSummaryEl) {
      commissionsSummaryEl.innerHTML = `
        <article class="metric"><span>Total Fares</span><strong>GHS ${totalFares.toLocaleString()}</strong></article>
        <article class="metric"><span>Platform Commission</span><strong>GHS ${totalCommission.toLocaleString()}</strong></article>
        <article class="metric"><span>Unsettled (Operators)</span><strong>GHS ${unsettled.toLocaleString()}</strong></article>
        <article class="metric"><span>Operators</span><strong>${ops.length}</strong></article>
      `;
    }

    if (commissionsTableEl) {
      commissionsTableEl.innerHTML = ops.length ? `
        <div class="admin-table-shell">
          <table class="admin-table">
            <thead><tr><th>Operator</th><th>Rate</th><th>Fares</th><th>Commission</th><th>Settled</th><th>Unsettled</th></tr></thead>
            <tbody>${ops.map(o => {
              const unsettledAmount = Number(o.unsettled_amount || 0);
              const settledAmount = Number(o.settled_amount || 0);
              return `
                <tr>
                  <td>
                    <div class="admin-table__operator">
                      <strong>${o.operator_name}</strong>
                      <span>${unsettledAmount > 0 ? 'Balance outstanding' : 'Fully settled'}</span>
                    </div>
                  </td>
                  <td><span class="admin-badge admin-badge--neutral">${(Number(o.commission_rate || 0) * 100).toFixed(1)}%</span></td>
                  <td><span class="admin-table__currency">GHS ${Number(o.total_fares || 0).toLocaleString()}</span></td>
                  <td><span class="admin-table__currency">GHS ${Number(o.total_commission || 0).toLocaleString()}</span></td>
                  <td><span class="admin-table__currency">GHS ${settledAmount.toLocaleString()}</span></td>
                  <td><span class="admin-badge ${unsettledAmount > 0 ? 'admin-badge--warning' : 'admin-badge--success'}">GHS ${unsettledAmount.toLocaleString()}</span></td>
                </tr>
              `;
            }).join('')}</tbody>
          </table>
        </div>
      ` : '<p class="meta">No commission entries yet.</p>';
    }

    if (payoutsListEl) {
      payoutsListEl.innerHTML = payouts.length ? payouts.map(p => `
        <article class="reference-item payout-item">
          <div class="payout-item__head">
            <strong>${p.operator_name}</strong>
            <span class="admin-badge admin-badge--success">GHS ${Number(p.amount).toLocaleString()}</span>
          </div>
          <div class="payout-item__meta">${p.period_from} → ${p.period_to} &middot; ${new Date(p.created_at).toLocaleDateString()}</div>
          ${p.notes ? `<div class="payout-item__notes">${p.notes}</div>` : ''}
        </article>
      `).join('') : '<p class="meta">No payouts recorded yet.</p>';
    }
  }

  if (payoutForm) {
    payoutForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = await ensureAdminToken();
      if (!token) return;
      const data = {
        operatorId: parseInt(document.getElementById('pay-operator').value),
        amount: parseFloat(document.getElementById('pay-amount').value),
        periodFrom: document.getElementById('pay-from').value,
        periodTo: document.getElementById('pay-to').value,
        notes: document.getElementById('pay-notes').value.trim()
      };
      if (!data.operatorId || !data.amount || !data.periodFrom || !data.periodTo) {
        notify('All payout fields are required.', false); return;
      }
      try {
        await api('/admin/payouts', token, { method: 'POST', body: JSON.stringify(data) });
        notify('Payout recorded!');
        payoutForm.reset();
        await loadCommissions();
      } catch (err) { notify(`Payout failed: ${err.message}`, false); }
    });
  }

  // Hook into tab switching to lazy-load operator/commission/manifest/sms/email data
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (tab === 'trips') {
        loadFleet();
        loadManifestTrips();
      }
      if (tab === 'operators') loadOperators();
      if (tab === 'commissions') loadCommissions();
      if (tab === 'sms') { loadSmsTrips(); loadSmsLogs(); }
      if (tab === 'email') loadEmailInbox();
    });
  });

  // ── Fleet edit / delete ── 
  const editBusModal = document.getElementById('edit-bus-modal');
  const editBusForm = document.getElementById('edit-bus-form');

  if (fleetListEl) {
    fleetListEl.addEventListener('click', async (e) => {
      // Edit bus
      const editBtn = e.target.closest('[data-edit-bus]');
      if (editBtn) {
        const bus = JSON.parse(editBtn.getAttribute('data-edit-bus').replace(/&apos;/g, "'"));
        document.getElementById('eb-id').value = bus.id;
        document.getElementById('eb-name').value = bus.name || '';
        document.getElementById('eb-plate').value = bus.plate_number || '';
        document.getElementById('eb-capacity').value = bus.capacity || '';
        document.getElementById('eb-available').value = bus.available_seats ?? '';
        document.getElementById('eb-price').value = bus.price || '';
        document.getElementById('eb-amenities').value = bus.amenities_json ? JSON.parse(bus.amenities_json).join(', ') : '';
        // populate route select
        const ebRouteEl = document.getElementById('eb-route');
        fillSelect(ebRouteEl, fleetSnapshot.routes || [], (r) => `<option value="${r.id}">${r.name}</option>`, 'Select route');
        ebRouteEl.value = bus.route_id || '';
        editBusModal.hidden = false;
        return;
      }

      // Delete bus
      const delBtn = e.target.closest('[data-delete-bus]');
      if (delBtn) {
        const busId = delBtn.getAttribute('data-delete-bus');
        const busName = delBtn.getAttribute('data-bus-name');
        if (!confirm(`Delete "${busName}"? This cannot be undone.`)) return;
        const token = await ensureAdminToken();
        if (!token) return;
        try {
          await api(`/admin/buses/${busId}`, token, { method: 'DELETE' });
          notify('Bus deleted successfully');
          await Promise.all([loadFleet(), loadManualRoutes()]);
        } catch (err) {
          notify(`Delete failed: ${err.message}`, false);
        }
      }
    });
  }

  if (editBusForm) {
    editBusForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = await ensureAdminToken();
      if (!token) return;
      const busId = document.getElementById('eb-id').value;
      const body = {
        name: document.getElementById('eb-name').value.trim(),
        plate: document.getElementById('eb-plate').value.trim() || null,
        route: Number(document.getElementById('eb-route').value),
        capacity: Number(document.getElementById('eb-capacity').value),
        seats: document.getElementById('eb-available').value ? Number(document.getElementById('eb-available').value) : null,
        price: document.getElementById('eb-price').value ? Number(document.getElementById('eb-price').value) : null,
        amenitiesJson: document.getElementById('eb-amenities').value.trim() ? JSON.stringify(document.getElementById('eb-amenities').value.split(',').map(s => s.trim()).filter(Boolean)) : null
      };
      try {
        await api(`/admin/buses/${busId}`, token, { method: 'PUT', body: JSON.stringify(body) });
        notify('Bus updated successfully');
        editBusModal.hidden = true;
        await Promise.all([loadFleet(), loadManualRoutes()]);
      } catch (err) {
        notify(`Update failed: ${err.message}`, false);
      }
    });
  }

  // Modal close
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      const modal = document.getElementById(modalId);
      if (modal) modal.hidden = true;
    });
  });

  // ── Manifest ──
  const manifestTripSelect = document.getElementById('manifest-trip-select');
  const manifestRefreshBtn = document.getElementById('manifest-refresh-btn');
  const manifestPassengersEl = document.getElementById('manifest-passengers');

  async function loadManifestTrips() {
    if (!manifestTripSelect) return;
    const trips = [...(fleetSnapshot.activeTrips || []), ...(fleetSnapshot.recentTrips || [])];
    const current = manifestTripSelect.value;
    manifestTripSelect.innerHTML = '<option value="">Select a trip</option>' + trips.map((trip) =>
      `<option value="${trip.id}">${trip.routeName} — ${trip.busName} (${trip.departureDate || 'No date'} ${trip.departureTime || ''}) [${trip.status}]</option>`
    ).join('');
    if (current && Array.from(manifestTripSelect.options).some((option) => option.value === current)) {
      manifestTripSelect.value = current;
    }
  }

  async function loadManifest(tripId) {
    if (!tripId) {
      manifestPassengersEl.innerHTML = '<div class="meta">Select a trip to view the manifest.</div>';
      return;
    }
    const token = await ensureAdminToken();
    if (!token) return;
    try {
      const data = await api(`/admin/trips/${tripId}/manifest`, token);
      const trip = data.trip || {};
      const summary = data.summary || {};
      document.getElementById('ms-confirmed').textContent = summary.confirmed || 0;
      document.getElementById('ms-boarded').textContent = summary.boarded || 0;
      document.getElementById('ms-capacity').textContent = summary.capacity || 0;
      document.getElementById('ms-remaining').textContent = summary.seatsRemaining || 0;

      if (manifestTripSelect) {
        manifestTripSelect.value = String(tripId);
      }

      const passengers = data.passengers || [];
      if (!passengers.length) {
        manifestPassengersEl.innerHTML = `
          <div class="meta">${trip.routeName || 'Trip'} · ${trip.busName || 'Bus'} · ${trip.driverName || 'Driver unassigned'} · Revenue GHS ${Number(summary.revenue || 0).toFixed(2)}</div>
          <div class="meta">No passengers on this trip yet.</div>
        `;
        return;
      }

      manifestPassengersEl.innerHTML = `
        <div class="meta">${trip.routeName || 'Trip'} · ${trip.operatorName || 'Operator'} · ${trip.busName || 'Bus'} · ${trip.driverName || 'Driver unassigned'} · ${trip.departureStationName && trip.arrivalStationName ? `${trip.departureStationName} to ${trip.arrivalStationName}` : 'Stations not assigned'} · Revenue GHS ${Number(summary.revenue || 0).toFixed(2)}</div>
        ${passengers.map((p, i) => {
          const boarded = !!p.boardedAt;
          const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Passenger';
          return `
            <div class="manifest-pax">
              <div class="manifest-pax__num">${i + 1}</div>
              <div>
                <div class="manifest-pax__name">${fullName}</div>
                <div class="manifest-pax__meta">${p.phone || '—'} · Seat ${p.seat || '—'} · ${p.paymentMethod || 'online'}</div>
              </div>
              <div class="manifest-pax__meta">${p.email || '—'} · GHS ${Number(p.pricePaid || 0).toFixed(2)}</div>
              <div>
                <span class="manifest-pax__status manifest-pax__status--${boarded ? 'boarded' : 'pending'}">
                  <i class="fa-solid fa-${boarded ? 'circle-check' : 'clock'}"></i>
                  ${boarded ? 'Boarded' : 'Waiting'}
                </span>
              </div>
              <div>
                <span class="manifest-pax__meta">${boarded && p.boardedAt ? new Date(p.boardedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not boarded'}</span>
              </div>
            </div>
          `;
        }).join('')}
      `;
    } catch (err) {
      manifestPassengersEl.innerHTML = `<div class="meta">Failed to load manifest: ${err.message}</div>`;
    }
  }

  if (manifestTripSelect) {
    manifestTripSelect.addEventListener('change', () => loadManifest(manifestTripSelect.value));
  }
  if (manifestRefreshBtn) {
    manifestRefreshBtn.addEventListener('click', () => loadManifest(manifestTripSelect?.value));
  }

  [...activeTripsEls, ...recentTripsEls].forEach((host) => host?.addEventListener('click', async (e) => {
    const manifestBtn = e.target.closest('[data-view-trip-manifest]');
    if (!manifestBtn) return;
    const tripId = manifestBtn.getAttribute('data-view-trip-manifest');
    if (!tripId) return;
    activateTab('trips');
    await loadManifest(tripId);
    manifestPassengersEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  // ── Verify ──
  const verifyForm = document.getElementById('verify-form');
  const verifyRefInput = document.getElementById('verify-ref');
  const verifyResultEl = document.getElementById('verify-result');
  const verifyStatusEl = document.getElementById('verify-status');
  const verifyDetailsEl = document.getElementById('verify-details');
  const verifyCheckinBtn = document.getElementById('verify-checkin-btn');
  let lastVerifiedBookingId = null;

  if (verifyForm) {
    verifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ref = verifyRefInput.value.trim();
      if (!ref) return;

      try {
        const res = await fetch(`${API_BASE}/booking/verify?ref=${encodeURIComponent(ref)}`);
        const data = await res.json();

        verifyResultEl.hidden = false;
        lastVerifiedBookingId = null;

        if (data.valid) {
          const b = data.booking;
          verifyStatusEl.className = 'verify-result__status valid';
          verifyStatusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> Valid Booking';
          verifyDetailsEl.innerHTML = `
            <div><span class="vr-label">Passenger</span><div class="vr-value">${b.first_name} ${b.last_name}</div></div>
            <div><span class="vr-label">Reference</span><div class="vr-value">${b.booking_ref}</div></div>
            <div><span class="vr-label">Route</span><div class="vr-value">${b.route_name || '—'}</div></div>
            <div><span class="vr-label">Bus</span><div class="vr-value">${b.bus_name || '—'}</div></div>
            <div><span class="vr-label">Seat</span><div class="vr-value">${b.seat || '—'}</div></div>
            <div><span class="vr-label">Status</span><div class="vr-value">${b.status}</div></div>
            <div><span class="vr-label">Departure</span><div class="vr-value">${b.departure_date || '—'} ${b.departure_time || ''}</div></div>
            <div><span class="vr-label">Boarded</span><div class="vr-value">${b.boarded_at ? new Date(b.boarded_at).toLocaleString() : 'Not yet'}</div></div>
          `;

          if (b.status === 'confirmed' && !b.boarded_at) {
            lastVerifiedBookingId = b.id;
            verifyCheckinBtn.hidden = false;
          } else {
            verifyCheckinBtn.hidden = true;
          }
        } else {
          verifyStatusEl.className = 'verify-result__status invalid';
          verifyStatusEl.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Invalid — Booking not found';
          verifyDetailsEl.innerHTML = '';
          verifyCheckinBtn.hidden = true;
        }
      } catch (err) {
        notify(`Verification failed: ${err.message}`, false);
      }
    });
  }

  if (verifyCheckinBtn) {
    verifyCheckinBtn.addEventListener('click', async () => {
      if (!lastVerifiedBookingId) return;
      const token = await ensureAdminToken();
      if (!token) return;
      verifyCheckinBtn.disabled = true;
      verifyCheckinBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Boarding...';
      try {
        await api(`/admin/bookings/${lastVerifiedBookingId}/checkin`, token, { method: 'POST' });
        notify('Passenger marked as boarded!');
        verifyCheckinBtn.hidden = true;
        // Re-run the verify to update the display
        verifyForm.dispatchEvent(new Event('submit'));
      } catch (err) {
        notify(`Check-in failed: ${err.message}`, false);
      } finally {
        verifyCheckinBtn.disabled = false;
        verifyCheckinBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Mark as Boarded';
      }
    });
  }

  // ── Trip Edit Modal ──
  const editTripModal = document.getElementById('edit-trip-modal');
  const editTripForm = document.getElementById('edit-trip-form');
  const restStopsList = document.getElementById('rest-stops-list');
  const addRestStopForm = document.getElementById('add-rest-stop-form');
  const addRestStopBtn = document.getElementById('add-rest-stop-btn');
  let editingTripId = null;

  activeTripsEls.forEach(host => host?.addEventListener('click', async (e) => {
    // Edit Trip
    const editBtn = e.target.closest('[data-edit-trip]');
    if (editBtn) {
      editingTripId = editBtn.getAttribute('data-edit-trip');
      // Reset form
      editTripForm.reset();
      document.getElementById('et-id').value = editingTripId;
      // Try to pre-populate from the trip card data
      const trip = (fleetSnapshot.activeTrips || []).find(t => String(t.id) === String(editingTripId));
      if (trip) {
        document.getElementById('et-date').value = trip.departureDate || '';
        document.getElementById('et-time').value = trip.departureTime || '';
        document.getElementById('et-price').value = trip.price || '';
        document.getElementById('et-cancel-policy').value = trip.cancellationPolicy || 'flexible';
        document.getElementById('et-luggage').value = trip.luggagePolicy || '';
        document.getElementById('et-description').value = trip.description || '';
        document.getElementById('et-instructions').value = trip.departureInstructions || '';
        document.getElementById('et-revised-date').value = trip.revisedDepartureDate || '';
        document.getElementById('et-revised-time').value = trip.revisedDepartureTime || '';
      }
      // Load rest stops
      loadRestStops(editingTripId);
      editTripModal.hidden = false;
      return;
    }

    // Cancel Trip
    const cancelBtn = e.target.closest('[data-cancel-trip]');
    if (cancelBtn) {
      const tripId = cancelBtn.getAttribute('data-cancel-trip');
      const label = cancelBtn.getAttribute('data-trip-label') || `Trip #${tripId}`;
      document.getElementById('ct-id').value = tripId;
      document.getElementById('cancel-trip-info').textContent = `Cancel "${label}"? All confirmed passengers will be notified via SMS.`;
      document.getElementById('cancel-trip-form').reset();
      document.getElementById('ct-id').value = tripId;
      document.getElementById('cancel-trip-modal').hidden = false;
      return;
    }

    // Quick SMS → switch to SMS tab and pre-select trip
    const smsBtn = e.target.closest('[data-notify-trip]');
    if (smsBtn) {
      const tripId = smsBtn.getAttribute('data-notify-trip');
      activateTab('sms');
      await loadSmsTrips();
      const smsTripSelect = document.getElementById('sms-trip-select');
      if (smsTripSelect) smsTripSelect.value = tripId;
      return;
    }
  }));

  // Edit Trip form submit
  if (editTripForm) {
    editTripForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tripId = document.getElementById('et-id').value;
      if (!tripId) return;
      const token = await ensureAdminToken();
      if (!token) return;
      const body = {};
      const date = document.getElementById('et-date').value;
      const time = document.getElementById('et-time').value;
      const price = document.getElementById('et-price').value;
      const cancelPolicy = document.getElementById('et-cancel-policy').value;
      const luggage = document.getElementById('et-luggage').value.trim();
      const desc = document.getElementById('et-description').value.trim();
      const instr = document.getElementById('et-instructions').value.trim();
      const rDate = document.getElementById('et-revised-date').value;
      const rTime = document.getElementById('et-revised-time').value;

      if (date) body.departureDate = date;
      if (time) body.departureTime = time;
      if (price) body.price = Number(price);
      if (cancelPolicy) body.cancellationPolicy = cancelPolicy;
      if (luggage) body.luggagePolicy = luggage;
      if (desc) body.description = desc;
      if (instr) body.departureInstructions = instr;
      if (rDate) body.revisedDepartureDate = rDate;
      if (rTime) body.revisedDepartureTime = rTime;

      try {
        await api(`/admin/trips/${tripId}`, token, { method: 'PUT', body: JSON.stringify(body) });
        notify('Trip updated successfully');
        editTripModal.hidden = true;
        await loadFleet();
      } catch (err) {
        notify(`Update failed: ${err.message}`, false);
      }
    });
  }

  // Cancel Trip form submit
  const cancelTripForm = document.getElementById('cancel-trip-form');
  if (cancelTripForm) {
    cancelTripForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tripId = document.getElementById('ct-id').value;
      if (!tripId) return;
      const token = await ensureAdminToken();
      if (!token) return;
      const reason = document.getElementById('ct-reason').value.trim();
      const message = document.getElementById('ct-message').value.trim();
      if (!reason) { notify('Please provide a cancellation reason.', false); return; }
      try {
        await api(`/admin/trips/${tripId}/cancel`, token, {
          method: 'POST',
          body: JSON.stringify({ reason, notifyMessage: message || undefined })
        });
        notify('Trip cancelled. Passengers have been notified.');
        document.getElementById('cancel-trip-modal').hidden = true;
        await loadFleet();
      } catch (err) {
        notify(`Cancel failed: ${err.message}`, false);
      }
    });
  }

  // ── Rest Stops CRUD ──
  async function loadRestStops(tripId) {
    if (!restStopsList) return;
    restStopsList.innerHTML = '<div class="meta">Loading rest stops...</div>';
    try {
      const token = await ensureAdminToken();
      if (!token) return;
      const data = await api(`/admin/trips/${tripId}/rest-stops`, token);
      const stops = data.stops || data || [];
      if (!stops.length) {
        restStopsList.innerHTML = '<div class="meta">No rest stops yet.</div>';
        return;
      }
      restStopsList.innerHTML = stops.map((s, i) => `
        <div class="reference-item" style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${i + 1}. ${s.name}</strong>
            <div class="meta-line">${s.estimated_time || '—'} · ${s.duration_minutes || 15} min${s.notes ? ' · ' + s.notes : ''}</div>
          </div>
          <button type="button" class="trip-action-btn trip-action-btn--cancel" data-delete-stop="${s.id}" style="padding:4px 10px;font-size:0.75rem;">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `).join('');
    } catch (err) {
      restStopsList.innerHTML = `<div class="meta">Failed: ${err.message}</div>`;
    }
  }

  if (addRestStopBtn) {
    addRestStopBtn.addEventListener('click', () => {
      addRestStopForm.style.display = addRestStopForm.style.display === 'none' ? '' : 'none';
    });
  }

  if (addRestStopForm) {
    addRestStopForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!editingTripId) return;
      const token = await ensureAdminToken();
      if (!token) return;
      const body = {
        name: document.getElementById('rs-name').value.trim(),
        estimatedTime: document.getElementById('rs-time').value.trim() || null,
        durationMinutes: Number(document.getElementById('rs-duration').value) || 15,
        notes: document.getElementById('rs-notes').value.trim() || null
      };
      if (!body.name) { notify('Stop name is required.', false); return; }
      try {
        await api(`/admin/trips/${editingTripId}/rest-stops`, token, { method: 'POST', body: JSON.stringify(body) });
        notify('Rest stop added');
        addRestStopForm.reset();
        addRestStopForm.style.display = 'none';
        await loadRestStops(editingTripId);
      } catch (err) {
        notify(`Add stop failed: ${err.message}`, false);
      }
    });
  }

  if (restStopsList) {
    restStopsList.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-delete-stop]');
      if (!btn) return;
      const stopId = btn.getAttribute('data-delete-stop');
      if (!confirm('Delete this rest stop?')) return;
      const token = await ensureAdminToken();
      if (!token) return;
      try {
        await api(`/admin/rest-stops/${stopId}`, token, { method: 'DELETE' });
        notify('Rest stop deleted');
        if (editingTripId) await loadRestStops(editingTripId);
      } catch (err) {
        notify(`Delete failed: ${err.message}`, false);
      }
    });
  }

  // ── SMS Center ──
  const smsModeButtons = document.querySelectorAll('[data-sms-mode]');
  const smsPanels = document.querySelectorAll('[data-sms-panel]');
  smsModeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-sms-mode');
      smsModeButtons.forEach(b => b.classList.toggle('active', b === btn));
      smsPanels.forEach(p => p.classList.toggle('active', p.getAttribute('data-sms-panel') === mode));
    });
  });

  // Character count for SMS trip message
  const smsTripMsg = document.getElementById('sms-trip-msg');
  const smsTripCharCount = document.getElementById('sms-trip-char-count');
  if (smsTripMsg && smsTripCharCount) {
    smsTripMsg.addEventListener('input', () => {
      const len = smsTripMsg.value.length;
      const segments = Math.ceil(len / 160) || 1;
      smsTripCharCount.textContent = `${len} / 160 chars${segments > 1 ? ` (${segments} segments)` : ''}`;
    });
  }

  async function loadSmsTrips() {
    const token = await ensureAdminToken();
    if (!token) return;
    try {
      const data = await api('/admin/fleet/options', token);
      const trips = [...(data.activeTrips || []), ...(data.recentTrips || [])];
      // SMS trip select
      const smsTripSelect = document.getElementById('sms-trip-select');
      if (smsTripSelect) {
        const current = smsTripSelect.value;
        smsTripSelect.innerHTML = '<option value="">Select a trip</option>' + trips.map(t =>
          `<option value="${t.id}">${t.routeName} — ${t.busName} (${t.departureDate || 'No date'}) [${t.status}]</option>`
        ).join('');
        if (current) smsTripSelect.value = current;
      }
      // Announcement trip select
      const annTripSelect = document.getElementById('ann-trip-id');
      if (annTripSelect) {
        annTripSelect.innerHTML = '<option value="">Select trip</option>' + trips.map(t =>
          `<option value="${t.id}">${t.routeName} — ${t.busName} (${t.departureDate || 'No date'})</option>`
        ).join('');
      }
      // Announcement route select
      const annRouteSelect = document.getElementById('ann-route-id');
      if (annRouteSelect) {
        const routes = data.routes || fleetSnapshot.routes || [];
        annRouteSelect.innerHTML = '<option value="">Select route</option>' + routes.map(r =>
          `<option value="${r.id}">${r.name}</option>`
        ).join('');
      }
    } catch (_) { /* silent */ }
  }

  // Announcement target toggle
  const annTarget = document.getElementById('ann-target');
  if (annTarget) {
    annTarget.addEventListener('change', () => {
      const v = annTarget.value;
      const tripEl = document.getElementById('ann-trip-id');
      const routeEl = document.getElementById('ann-route-id');
      if (tripEl) tripEl.style.display = v === 'trip' ? '' : 'none';
      if (routeEl) routeEl.style.display = v === 'route' ? '' : 'none';
    });
  }

  // SMS trip form submit
  const smsTripForm = document.getElementById('sms-trip-form');
  if (smsTripForm) {
    smsTripForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tripId = document.getElementById('sms-trip-select').value;
      const message = document.getElementById('sms-trip-msg').value.trim();
      if (!tripId || !message) { notify('Select a trip and enter a message.', false); return; }
      const token = await ensureAdminToken();
      if (!token) return;
      try {
        const res = await api(`/admin/trips/${tripId}/notify`, token, {
          method: 'POST',
          body: JSON.stringify({ message })
        });
        notify(`SMS sent to ${res.sent || 0} passengers`);
        smsTripForm.reset();
        if (smsTripCharCount) smsTripCharCount.textContent = '0 / 160 chars';
        await loadSmsLogs();
      } catch (err) {
        notify(`SMS failed: ${err.message}`, false);
      }
    });
  }

  // SMS individual form submit
  const smsIndForm = document.getElementById('sms-individual-form');
  if (smsIndForm) {
    smsIndForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = document.getElementById('sms-ind-phone').value.trim();
      const name = document.getElementById('sms-ind-name').value.trim();
      const message = document.getElementById('sms-ind-msg').value.trim();
      if (!phone || !message) { notify('Phone and message are required.', false); return; }
      const token = await ensureAdminToken();
      if (!token) return;
      try {
        await api('/admin/sms/send', token, {
          method: 'POST',
          body: JSON.stringify({ phone, name: name || undefined, message, category: 'individual' })
        });
        notify('SMS sent!');
        smsIndForm.reset();
        await loadSmsLogs();
      } catch (err) {
        notify(`SMS failed: ${err.message}`, false);
      }
    });
  }

  // Announcement form submit
  const smsAnnounceForm = document.getElementById('sms-announce-form');
  if (smsAnnounceForm) {
    smsAnnounceForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('ann-title').value.trim();
      const target = document.getElementById('ann-target').value;
      const message = document.getElementById('ann-message').value.trim();
      if (!title || !message) { notify('Title and message are required.', false); return; }
      const body = { title, target, message };
      if (target === 'trip') body.targetTripId = Number(document.getElementById('ann-trip-id').value);
      if (target === 'route') body.targetRouteId = Number(document.getElementById('ann-route-id').value);
      if ((target === 'trip' && !body.targetTripId) || (target === 'route' && !body.targetRouteId)) {
        notify('Please select the target trip or route.', false); return;
      }
      const token = await ensureAdminToken();
      if (!token) return;
      try {
        const res = await api('/admin/announcements', token, { method: 'POST', body: JSON.stringify(body) });
        notify(`Announcement sent to ${res.sentCount || 0} passengers`);
        smsAnnounceForm.reset();
        await loadSmsLogs();
      } catch (err) {
        notify(`Announcement failed: ${err.message}`, false);
      }
    });
  }

  // ── SMS Logs ──
  async function loadSmsLogs() {
    const logsEl = document.getElementById('sms-logs-list');
    if (!logsEl) return;
    const token = await ensureAdminToken();
    if (!token) return;
    try {
      const data = await api('/admin/sms/logs?limit=50', token);
      const logs = data.logs || data || [];
      if (!logs.length) {
        logsEl.innerHTML = '<div class="meta">No SMS logs yet.</div>';
        return;
      }
      logsEl.innerHTML = logs.map(l => `
        <div class="sms-log-item">
          <div class="sms-log-item__header">
            <strong>${l.recipient_name || l.recipient_phone}</strong>
            <span class="sms-log-item__badge sms-log-item__badge--${l.status || 'sent'}">${l.status || 'sent'}</span>
          </div>
          <div class="meta-line" style="margin-top:2px;">${(l.message || '').substring(0, 120)}${(l.message || '').length > 120 ? '...' : ''}</div>
          <div class="meta-line" style="margin-top:2px; font-size:0.7rem; opacity:0.6;">${l.category || '—'} · ${l.created_at ? new Date(l.created_at).toLocaleString() : '—'}</div>
        </div>
      `).join('');
    } catch (err) {
      logsEl.innerHTML = `<div class="meta">Failed to load logs: ${err.message}</div>`;
    }
  }

  const smsRefreshBtn = document.getElementById('sms-refresh-logs');
  if (smsRefreshBtn) smsRefreshBtn.addEventListener('click', loadSmsLogs);

  // ── Email ──
  const emailComposeForm = document.getElementById('email-compose-form');
  if (emailComposeForm) {
    emailComposeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const to = document.getElementById('email-to').value.trim();
      const subject = document.getElementById('email-subject').value.trim();
      const body = document.getElementById('email-body').value.trim();
      if (!to || !subject || !body) { notify('All email fields are required.', false); return; }
      const token = await ensureAdminToken();
      if (!token) return;
      try {
        await api('/admin/email/send', token, {
          method: 'POST',
          body: JSON.stringify({ to, subject, body })
        });
        notify('Email sent!');
        emailComposeForm.reset();
        await loadEmailInbox();
      } catch (err) {
        notify(`Email failed: ${err.message}`, false);
      }
    });
  }

  async function loadEmailInbox() {
    const inboxEl = document.getElementById('email-inbox-list');
    if (!inboxEl) return;
    const token = await ensureAdminToken();
    if (!token) return;
    try {
      const data = await api('/admin/email/inbox?limit=30', token);
      const emails = data.emails || data || [];
      if (!emails.length) {
        inboxEl.innerHTML = '<div class="meta">No emails yet.</div>';
        return;
      }
      inboxEl.innerHTML = emails.map(e => `
        <div class="email-item${e.is_read ? '' : ' email-item--unread'}">
          <div class="email-item__header">
            <strong>${e.from_address || e.to_address || '—'}</strong>
            <span class="email-item__date">${e.created_at ? new Date(e.created_at).toLocaleDateString() : '—'}</span>
          </div>
          <div class="email-item__subject">${e.subject || '(no subject)'}</div>
          <div class="meta-line" style="margin-top:2px;">${(e.body_preview || '').substring(0, 100)}${(e.body_preview || '').length > 100 ? '...' : ''}</div>
        </div>
      `).join('');
    } catch (err) {
      inboxEl.innerHTML = `<div class="meta">Failed to load inbox: ${err.message}</div>`;
    }
  }

  const emailRefreshBtn = document.getElementById('email-refresh-inbox');
  if (emailRefreshBtn) emailRefreshBtn.addEventListener('click', loadEmailInbox);

  // ── Logout ──
  const logoutBtn = document.getElementById('admin-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      clearAdminSession(true);
    });
  }

  applyGovernanceMode();
  document.addEventListener('click', (event) => {
    const link = event.target.closest('.js-admin-ticket-link');
    if (!link) return;
    const payloadText = link.getAttribute('data-ticket-payload') || '';
    if (!payloadText) return;
    try {
      storeTicketPayload(JSON.parse(payloadText), false);
    } catch (_err) {
      // Ignore malformed payloads and allow the link to continue normally.
    }
  });

  setupTabs();
  loadAll();
})();
