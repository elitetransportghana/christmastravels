(function () {
  const DEFAULT_API_BASE = 'https://realeliteweb-app.elitetransportghana.workers.dev/api';
  const CITY_OPTIONS = [
    '',
    'Accra',
    'Kumasi',
    'Cape Coast',
    'Tamale',
    'Sunyani',
    'Tema',
    'Koforidua',
    'Ho',
    'Wa',
    'Bolgatanga',
    'Campus',
    'Upper East',
    'Upper West',
    'Kintampo',
    'Banda District',
    'Wenchi Municipal',
    'Nkoranza North District',
    'Techiman Municipal',
    'St. John Bosco',
    'Tumu'
  ];
  const SEAT_ROWS = [
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
  const POLL_INTERVAL_MS = 5000;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatCurrency(value) {
    return `GHS ${Number(value || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatCurrencyWhole(value) {
    return `GHS ${Math.round(Number(value || 0)).toLocaleString('en-GH')}`;
  }

  function roundMoney(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  function formatDate(value) {
    if (!value) return 'No date';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-GH', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatDisplayTime(value) {
    if (!value) return '08:00 am';
    const raw = String(value).trim();
    if (/am|pm/i.test(raw)) return raw.toLowerCase();
    const parts = raw.split(':');
    const hour = Number(parts[0] || 0);
    const minute = Number(parts[1] || 0);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return raw;
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return date.toLocaleTimeString('en-GH', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  }

  function formatDuration(minutesValue) {
    const minutes = Number(minutesValue || 0);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours}h ${remainder}m`;
  }

  function sortSeatLabels(list) {
    return Array.from(new Set((list || []).filter(Boolean).map((value) => String(value).padStart(2, '0'))))
      .sort((left, right) => Number(left) - Number(right));
  }

  function normalizeSeatList(list) {
    return sortSeatLabels((list || []).map((value) => String(value).padStart(2, '0')));
  }

  function createLockId() {
    return `lock_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function amenityIcon(label) {
    const value = String(label || '').toLowerCase();
    if (value.includes('wifi')) return 'fa-wifi';
    if (value.includes('usb') || value.includes('power')) return 'fa-plug-circle-bolt';
    if (value.includes('air')) return 'fa-snowflake';
    if (value.includes('luggage')) return 'fa-suitcase-rolling';
    if (value.includes('accessible')) return 'fa-wheelchair';
    if (value.includes('snack')) return 'fa-mug-hot';
    return 'fa-circle-check';
  }

  function buildOptionsMarkup(selectedValue) {
    return CITY_OPTIONS.map((value) => {
      const label = value || 'All cities';
      const selected = String(selectedValue || '') === value ? ' selected' : '';
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    }).join('');
  }

  function matchesTrip(left, right) {
    if (!left || !right) return false;
    return String(left.busId || '') === String(right.busId || '')
      && String(left.tripId || '') === String(right.tripId || '')
      && String(left.departureDate || '') === String(right.departureDate || '')
      && String(left.departureTime || '') === String(right.departureTime || '');
  }

  function normalizeResult(result) {
    return {
      tripId: result.tripId || result.trip_id || null,
      busId: result.busId || result.bus_id || null,
      operatorId: Number(result.operatorId || result.operator_id || 0) || null,
      operatorName: result.operatorName || result.operator_name || 'Elite Transport',
      operatorLogo: result.operatorLogo || result.operator_logo || null,
      coachName: result.coachName || result.bus_name || result.name || 'Elite Transport Coach',
      routeName: result.routeName || result.route_name || result.routeText || result.route || 'Route',
      routeText: result.routeText || result.route || result.routeName || result.route_name || 'Route',
      originCity: result.originCity || result.from || '',
      destinationCity: result.destinationCity || result.to || '',
      routeGroup: result.routeGroup || result.group || 'intercity',
      routeGroupLabel: result.routeGroupLabel || result.route_group_label || 'Intercity',
      departureDate: result.departureDate || result.departure_date || todayIso(),
      departureTime: result.departureTime || result.departure_time || '08:00 AM',
      arrivalTime: result.arrivalTime || result.arrival_time || '12:00 PM',
      durationMinutes: Number(result.durationMinutes || result.duration_minutes || 0) || 0,
      durationLabel: result.durationLabel || result.duration_label || formatDuration(result.durationMinutes || result.duration_minutes || 0),
      stopSummary: result.stopSummary || result.stop_summary || 'Direct trip',
      price: Number(result.price || 0) || 0,
      seatsLeft: Number(result.seatsLeft || result.availableSeats || result.available_seats || 0) || 0,
      totalSeats: Number(result.totalSeats || result.capacity || 0) || 0,
      departureStationName: result.departureStationName || result.departure_station_name || '',
      arrivalStationName: result.arrivalStationName || result.arrival_station_name || '',
      amenities: Array.isArray(result.amenities) ? result.amenities : []
    };
  }

  function template(options) {
    const scopeLabel = options.context === 'admin' ? 'Marketplace booking desk' : 'Operator booking desk';
    const intro = options.context === 'admin'
      ? 'Use the public trip search and seat flow here for assisted internal bookings across operators.'
      : 'Search your live trips, lock seats, and confirm card, MoMo, or cash bookings without leaving the dashboard.';

    return `
      <div class="dashboard-booking-shell">
        <section class="dashboard-booking-search-shell">
          <div class="dashboard-booking-search-head">
            <div>
              <span class="dashboard-booking-eyebrow">${escapeHtml(scopeLabel)}</span>
              <h3>Search, seat, and confirm on one screen</h3>
              <p>${escapeHtml(intro)}</p>
            </div>
            <div class="dashboard-booking-flash" data-db="flash" hidden></div>
          </div>

          <form class="findbus-search-card dashboard-booking-search-card" data-db="search-form" novalidate>
            <label class="findbus-field findbus-field--route">
              <span>From - To</span>
              <div class="findbus-route-box">
                <select data-db="from">${buildOptionsMarkup('')}</select>
                <button type="button" class="findbus-swap" data-db="swap-route" aria-label="Swap route">
                  <i class="fa-solid fa-arrow-right-arrow-left"></i>
                </button>
                <select data-db="to">${buildOptionsMarkup('')}</select>
              </div>
            </label>

            <label class="findbus-field">
              <span>Depart Date</span>
              <input type="date" data-db="date" value="${escapeHtml(todayIso())}">
            </label>

            <label class="findbus-field">
              <span>Payment</span>
              <select data-db="method-filter">
                <option value="cash">Cash</option>
                <option value="momo">MoMo</option>
                <option value="card">Card</option>
              </select>
            </label>

            ${options.context === 'admin' ? `
            <label class="findbus-field">
              <span>Group</span>
              <select data-db="group-filter">
                <option value="all">All groups</option>
                <option value="intercity">Intercity</option>
                <option value="ttfpp">TTFPP</option>
                <option value="cobes">COBES</option>
              </select>
            </label>` : ''}

            <button type="submit" class="findbus-search-submit" aria-label="Search trips">
              <i class="fa-solid fa-magnifying-glass"></i>
            </button>
          </form>
        </section>

        <div class="dashboard-booking-layout">
          <section class="dashboard-booking-results">
            <div class="dashboard-booking-section-head">
              <div>
                <span class="dashboard-booking-section-head__eyebrow">Live results</span>
                <h4>Trips ready for assisted booking</h4>
              </div>
              <div class="dashboard-booking-sort" data-db="sort-strip">
                <button type="button" class="dashboard-booking-sort__btn is-active" data-sort="recommended">Best</button>
                <button type="button" class="dashboard-booking-sort__btn" data-sort="price">Cheapest</button>
                <button type="button" class="dashboard-booking-sort__btn" data-sort="departure">Earliest</button>
              </div>
            </div>
            <div class="dashboard-booking-results__meta" data-db="results-meta">Loading trips...</div>
            <div class="dashboard-booking-results__list" data-db="results-list"></div>
          </section>

          <section class="dashboard-booking-checkout">
            <div class="dashboard-booking-empty" data-db="checkout-empty">
              <i class="fa-solid fa-ticket"></i>
              <strong>Select a trip to open the booking desk.</strong>
              <span>The seat map, passenger manifest, and payment capture will appear here.</span>
            </div>

            <div class="dashboard-booking-stage" data-db="checkout-stage" hidden>
              <section class="checkout-trip-card">
                <div class="checkout-trip-card__head">
                  <div>
                    <h1 data-db="trip-title">Elite Transport Express</h1>
                    <p data-db="trip-date">Departure Tue, Apr 2</p>
                  </div>
                  <div class="checkout-trip-card__price" data-db="trip-price">GHS 0</div>
                </div>

                <div class="checkout-trip-card__meta">
                  <div class="checkout-brand-block">
                    <div class="checkout-brand-block__logo">
                      <img src="ELITE TRANSPORT.png" alt="Elite Transport logo">
                    </div>
                    <div class="checkout-brand-block__copy">
                      <strong data-db="operator-name">Elite Transport</strong>
                      <span data-db="coach-label">Accra to Kumasi</span>
                    </div>
                  </div>

                  <div class="checkout-amenities" data-db="amenities"></div>
                </div>

                <div class="checkout-trip-card__timeline">
                  <div class="checkout-trip-point">
                    <strong data-db="departure-time">02:45 pm</strong>
                    <span data-db="departure-city">Accra</span>
                  </div>

                  <div class="checkout-trip-line">
                    <span></span>
                    <i class="fa-solid fa-bus-simple" aria-hidden="true"></i>
                    <span></span>
                  </div>

                  <div class="checkout-trip-point checkout-trip-point--end">
                    <strong data-db="arrival-time">07:35 pm</strong>
                    <span data-db="arrival-city">Kumasi</span>
                  </div>
                </div>
              </section>

              <section class="checkout-seat-card">
                <div class="checkout-section-head">
                  <div>
                    <h2>Select Seats</h2>
                    <p>Seats lock instantly for this internal booking desk while you finish passenger details.</p>
                  </div>
                  <div class="checkout-hold-timer" data-db="hold-timer" hidden>
                    <i class="fa-solid fa-clock"></i>
                    <span data-db="hold-text">Seat held</span>
                  </div>
                </div>

                <div class="checkout-seat-stage">
                  <div class="checkout-seat-stage__layout">
                    <div class="checkout-seat-stage__banner">
                      <i class="fa-solid fa-bolt"></i>
                      <span>Choose one or more seats, then assign passenger names below before confirming payment.</span>
                    </div>

                    <div class="checkout-seat-card__bus app-bus">
                      <div class="checkout-seat-card__bus-head">
                        <span>FRONT</span>
                        <span>FRONT</span>
                      </div>

                      <div data-db="bus-layout"></div>

                      <div class="checkout-seat-legend">
                        <span><em class="seat-legend seat-legend--available"></em>Available</span>
                        <span><em class="seat-legend seat-legend--selected"></em>Selected</span>
                        <span><em class="seat-legend seat-legend--pending"></em>Saving</span>
                        <span><em class="seat-legend seat-legend--taken"></em>Taken</span>
                      </div>
                    </div>
                  </div>

                  <aside class="checkout-seat-stage__panel">
                    <div class="checkout-seat-summary">
                      <div class="checkout-seat-summary__count" data-db="selected-count">0 Seats</div>
                      <div class="checkout-seat-summary__list" data-db="selected-visual">Select one or more seats to assign passengers.</div>
                    </div>

                    <div class="checkout-seat-stage__help">
                      <strong>Desk Flow</strong>
                      <div class="checkout-seat-stage__steps">
                        <span>1. Search trip</span>
                        <span>2. Lock seats</span>
                        <span>3. Confirm payment</span>
                      </div>
                    </div>
                  </aside>
                </div>
              </section>

              <section class="checkout-passenger-card">
                <div class="checkout-section-head">
                  <div>
                    <h2>Passenger Details</h2>
                    <p>One booking can cover multiple seats as long as each passenger is named.</p>
                  </div>
                </div>

                <div class="checkout-contact-grid">
                  <div class="checkout-field">
                    <label>Email</label>
                    <input type="email" data-db="contact-email" placeholder="Email (optional – for receipt)">
                  </div>
                  <div class="checkout-field">
                    <label>Phone</label>
                    <input type="tel" data-db="contact-phone" placeholder="024 XXX XXXX">
                  </div>
                  <div class="checkout-field">
                    <label>Next of Kin Name</label>
                    <input type="text" data-db="contact-nok-name" placeholder="Optional">
                  </div>
                  <div class="checkout-field">
                    <label>Next of Kin Phone</label>
                    <input type="tel" data-db="contact-nok-phone" placeholder="Optional">
                  </div>
                </div>

                <div class="checkout-passenger-manifest" data-db="passenger-manifest">
                  <div class="checkout-empty-state">Choose seats to assign passenger names.</div>
                </div>
              </section>

              <section class="checkout-payment-card">
                <div class="checkout-section-head">
                  <div>
                    <h2>Payment Method</h2>
                    <p>Internal bookings are confirmed immediately and the selected payment method is recorded on the booking.</p>
                  </div>
                </div>

                <div class="checkout-payment-account">
                  <span class="checkout-payment-account__avatar"><i class="fa-solid fa-building"></i></span>
                  <div class="checkout-payment-account__copy">
                    <strong>${escapeHtml(scopeLabel)}</strong>
                    <span>Cash, MoMo, and Card are internal capture modes here.</span>
                  </div>
                </div>

                <button type="button" class="checkout-payment-option is-selected" data-payment-method="cash" role="radio" aria-checked="true" aria-pressed="true">
                  <div class="checkout-payment-option__content">
                    <div class="checkout-payment-option__brand">
                      <span class="checkout-card-chip">CASH</span>
                      <strong>Cash</strong>
                    </div>
                    <small>Record payment at the counter or inside the vehicle</small>
                  </div>
                  <span class="checkout-plan-option__radio" aria-hidden="true"></span>
                </button>

                <button type="button" class="checkout-payment-option checkout-payment-option--secondary" data-payment-method="momo" role="radio" aria-checked="false" aria-pressed="false">
                  <div class="checkout-payment-option__add">
                    <span class="checkout-payment-option__plus"><i class="fa-solid fa-mobile-screen-button"></i></span>
                    <div>
                      <strong>Mobile Money</strong>
                      <small>Record a successful MoMo collection against this booking</small>
                    </div>
                  </div>
                  <span class="checkout-plan-option__radio" aria-hidden="true"></span>
                </button>

                <button type="button" class="checkout-payment-option checkout-payment-option--secondary" data-payment-method="card" role="radio" aria-checked="false" aria-pressed="false">
                  <div class="checkout-payment-option__add">
                    <span class="checkout-payment-option__plus"><i class="fa-solid fa-credit-card"></i></span>
                    <div>
                      <strong>Card</strong>
                      <small>Record a card payment already captured at the desk</small>
                    </div>
                  </div>
                  <span class="checkout-plan-option__radio" aria-hidden="true"></span>
                </button>

                <div class="checkout-payment-note">
                  <i class="fa-solid fa-lock"></i>
                  <span>Seat locks still protect this flow. Payment here confirms the booking immediately without the public Paystack step.</span>
                </div>

                <button type="button" class="checkout-pay-btn" data-db="confirm-btn">Select seats to confirm</button>
              </section>

              <aside class="checkout-summary-card dashboard-booking-summary-card">
                <div class="checkout-summary-card__content">
                  <p class="checkout-summary-card__eyebrow" data-db="summary-tier">Intercity</p>
                  <h3 data-db="summary-title">Elite Transport Express</h3>

                  <div class="checkout-summary-card__divider"></div>

                  <div class="checkout-summary-card__pricing">
                    <h4>Booking Summary</h4>
                    <div class="checkout-price-row">
                      <span>Base Fare</span>
                      <strong data-db="summary-base-fare">GHS 0</strong>
                    </div>
                    <div class="checkout-price-row">
                      <span>Seats</span>
                      <strong data-db="summary-seat-count">0 seats selected</strong>
                    </div>
                    <div class="checkout-price-row">
                      <span>Payment Method</span>
                      <strong data-db="summary-payment-method">Cash</strong>
                    </div>
                    <div class="checkout-summary-card__divider"></div>
                    <div class="checkout-price-row checkout-price-row--total">
                      <span>Total</span>
                      <strong data-db="summary-total">GHS 0</strong>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </section>
        </div>
      </div>
    `;
  }

  function createInstance(root, initialOptions) {
    const state = {
      options: { ...initialOptions },
      query: {
        from: '',
        to: '',
        date: todayIso()
      },
      sort: 'recommended',
      group: 'all',
      results: [],
      selectedResult: null,
      selectedSeats: [],
      lockId: '',
      pendingSeatOps: new Map(),
      seatDrafts: {},
      cachedSeatData: null,
      pollTimer: null,
      holdTimer: null,
      holdEndsAt: 0,
      method: initialOptions.defaultPaymentMethod || 'cash',
      loading: false,
      confirming: false
    };

    root.innerHTML = template(state.options);

    const el = (name) => root.querySelector(`[data-db="${name}"]`);
    const elements = {
      flash: el('flash'),
      searchForm: el('search-form'),
      from: el('from'),
      to: el('to'),
      date: el('date'),
      methodFilter: el('method-filter'),
      groupFilter: el('group-filter'),
      swapRoute: el('swap-route'),
      resultsMeta: el('results-meta'),
      resultsList: el('results-list'),
      sortStrip: el('sort-strip'),
      checkoutEmpty: el('checkout-empty'),
      checkoutStage: el('checkout-stage'),
      tripTitle: el('trip-title'),
      tripDate: el('trip-date'),
      tripPrice: el('trip-price'),
      operatorName: el('operator-name'),
      coachLabel: el('coach-label'),
      amenities: el('amenities'),
      departureTime: el('departure-time'),
      departureCity: el('departure-city'),
      arrivalTime: el('arrival-time'),
      arrivalCity: el('arrival-city'),
      holdTimer: el('hold-timer'),
      holdText: el('hold-text'),
      busLayout: el('bus-layout'),
      selectedCount: el('selected-count'),
      selectedVisual: el('selected-visual'),
      contactEmail: el('contact-email'),
      contactPhone: el('contact-phone'),
      contactNokName: el('contact-nok-name'),
      contactNokPhone: el('contact-nok-phone'),
      passengerManifest: el('passenger-manifest'),
      confirmBtn: el('confirm-btn'),
      summaryTier: el('summary-tier'),
      summaryTitle: el('summary-title'),
      summaryBaseFare: el('summary-base-fare'),
      summarySeatCount: el('summary-seat-count'),
      summaryPaymentMethod: el('summary-payment-method'),
      summaryTotal: el('summary-total')
    };

    function notify(type, message) {
      const normalizedType = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
      if (typeof state.options.notify === 'function') {
        state.options.notify(normalizedType, message);
      }

      if (!elements.flash) return;
      elements.flash.hidden = false;
      elements.flash.className = `dashboard-booking-flash is-${normalizedType}`;
      elements.flash.textContent = message;
      window.clearTimeout(notify._timer);
      notify._timer = window.setTimeout(() => {
        elements.flash.hidden = true;
      }, 3500);
    }

    function authHeaders() {
      const token = typeof state.options.getAuthToken === 'function'
        ? state.options.getAuthToken()
        : (state.options.token || '');
      if (!token) return null;
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      };
    }

    function apiBase() {
      return state.options.apiBase || DEFAULT_API_BASE;
    }

    function readContact() {
      return {
        email: String(elements.contactEmail?.value || '').trim(),
        phone: String(elements.contactPhone?.value || '').trim(),
        nokName: String(elements.contactNokName?.value || '').trim(),
        nokPhone: String(elements.contactNokPhone?.value || '').trim()
      };
    }

    function calculateTotal() {
      return roundMoney(Number(state.selectedResult?.price || 0) * state.selectedSeats.length);
    }

    function renderSelectionSummary() {
      if (!state.selectedSeats.length) {
        elements.selectedCount.textContent = '0 Seats';
        elements.selectedVisual.innerHTML = 'Select one or more seats to assign passengers.';
      } else {
        elements.selectedCount.textContent = `${state.selectedSeats.length} Seat${state.selectedSeats.length === 1 ? '' : 's'} Selected`;
        elements.selectedVisual.innerHTML = `${state.selectedSeats.map((seat) => `<span class="checkout-seat-pill">Seat ${escapeHtml(seat)}</span>`).join('')}<span class="checkout-seat-summary__hint">Add passenger names for every selected seat before confirming.</span>`;
      }

      elements.summarySeatCount.textContent = `${state.selectedSeats.length} seat${state.selectedSeats.length === 1 ? '' : 's'} selected`;
      elements.summaryPaymentMethod.textContent = state.method === 'cash' ? 'Cash' : state.method === 'momo' ? 'MoMo' : 'Card';
      elements.summaryBaseFare.textContent = formatCurrency(state.selectedResult?.price || 0);
      elements.summaryTotal.textContent = formatCurrency(calculateTotal());
      syncConfirmButton();
    }

    function ensurePassengerDrafts() {
      state.selectedSeats.forEach((seat) => {
        if (!state.seatDrafts[seat]) {
          state.seatDrafts[seat] = { firstName: '', lastName: '' };
        }
      });
    }

    function renderPassengerManifest() {
      if (!state.selectedSeats.length) {
        elements.passengerManifest.innerHTML = '<div class="checkout-empty-state">Choose seats to assign passenger names.</div>';
        return;
      }

      ensurePassengerDrafts();

      // Clear empty-state placeholder if present
      if (elements.passengerManifest.querySelector('.checkout-empty-state')) {
        elements.passengerManifest.innerHTML = '';
      }

      // Remove rows for seats that are no longer selected
      elements.passengerManifest.querySelectorAll('.checkout-passenger-seat[data-seat-id]').forEach((row) => {
        if (!state.selectedSeats.includes(row.getAttribute('data-seat-id'))) row.remove();
      });

      // Add rows for newly selected seats (never touch existing ones = preserves focus)
      state.selectedSeats.forEach((seat, index) => {
        let row = elements.passengerManifest.querySelector(`.checkout-passenger-seat[data-seat-id="${seat}"]`);
        const draft = state.seatDrafts[seat] || { firstName: '', lastName: '' };

        if (!row) {
          row = document.createElement('article');
          row.className = 'checkout-passenger-seat';
          row.setAttribute('data-seat-id', seat);
          row.innerHTML = `
            <div class="checkout-passenger-seat__head">
              <div class="checkout-passenger-seat__identity">
                <div class="checkout-passenger-seat__meta">
                  <strong data-pax-label></strong>
                  <span data-pax-sub></span>
                </div>
              </div>
              <div class="checkout-passenger-seat__side">
                <span class="checkout-passenger-seat__badge">Seat ${escapeHtml(seat)}</span>
              </div>
            </div>
            <div class="checkout-passenger-seat__fields">
              <div class="checkout-field">
                <label>First Name</label>
                <input type="text" data-seat="${escapeHtml(seat)}" data-field="firstName" value="${escapeHtml(draft.firstName || '')}" placeholder="First name">
              </div>
              <div class="checkout-field">
                <label>Last Name</label>
                <input type="text" data-seat="${escapeHtml(seat)}" data-field="lastName" value="${escapeHtml(draft.lastName || '')}" placeholder="Last name">
              </div>
            </div>
          `;
          row.querySelectorAll('input[data-seat][data-field]').forEach((input) => {
            input.addEventListener('input', () => {
              const s = input.getAttribute('data-seat');
              const f = input.getAttribute('data-field');
              if (!s || !f) return;
              if (!state.seatDrafts[s]) state.seatDrafts[s] = { firstName: '', lastName: '' };
              state.seatDrafts[s][f] = input.value;
            });
          });
          elements.passengerManifest.appendChild(row);
        }

        // Always update the ordinal label (Passenger 1, 2…) without touching inputs
        const lbl = row.querySelector('[data-pax-label]');
        const sub = row.querySelector('[data-pax-sub]');
        if (lbl) lbl.textContent = `Passenger ${index + 1}`;
        if (sub) sub.textContent = index === 0 ? 'Primary passenger for this booking' : 'Additional passenger';

        // Keep DOM order in sync with selectedSeats order
        if (elements.passengerManifest.children[index] !== row) {
          elements.passengerManifest.insertBefore(row, elements.passengerManifest.children[index] || null);
        }
      });
    }

    function paintBusMap(lockedSeats, ownLockedSeats, bookedSeats) {
      if (!elements.busLayout) return;
      elements.busLayout.innerHTML = '';

      SEAT_ROWS.forEach((rowDef) => {
        const row = document.createElement('div');
        row.className = 'app-bus-row';

        rowDef.forEach((slot) => {
          const slotEl = document.createElement('div');
          slotEl.className = 'app-seat';

          if (slot === 0 || slot === 'void' || slot === 'stairs') {
            slotEl.style.opacity = '0';
            row.appendChild(slotEl);
            return;
          }

          if (slot === 'aisle') {
            slotEl.classList.add('aisle');
            row.appendChild(slotEl);
            return;
          }

          const seatLabel = String(slot).padStart(2, '0');
          const isPending = state.pendingSeatOps.has(seatLabel);
          const isSelected = state.selectedSeats.includes(seatLabel);
          const isOwnLock = ownLockedSeats.includes(seatLabel);
          const isTaken = bookedSeats.includes(seatLabel) || (lockedSeats.includes(seatLabel) && !isOwnLock);

          slotEl.textContent = seatLabel;
          if (isTaken) {
            slotEl.classList.add('occupied');
          } else {
            if (isSelected) slotEl.classList.add('selected');
            if (isPending) slotEl.classList.add('is-pending');
            slotEl.style.cursor = 'pointer';
            slotEl.addEventListener('click', () => toggleSeat(seatLabel));
          }

          row.appendChild(slotEl);
        });

        elements.busLayout.appendChild(row);
      });
    }

    function syncHoldTimer(expiresAt) {
      const parsed = Date.parse(expiresAt || '');
      state.holdEndsAt = Number.isFinite(parsed) ? parsed : 0;
      window.clearInterval(state.holdTimer);
      if (!state.holdEndsAt) {
        elements.holdTimer.hidden = true;
        return;
      }

      elements.holdTimer.hidden = false;
      const tick = () => {
        const remaining = state.holdEndsAt - Date.now();
        if (remaining <= 0) {
          window.clearInterval(state.holdTimer);
          state.holdTimer = null;
          state.selectedSeats = [];
          state.lockId = '';
          state.seatDrafts = {};
          renderSelectionSummary();
          renderPassengerManifest();
          elements.holdTimer.hidden = true;
          loadSeatMap(true).catch(() => {});
          notify('info', 'Seat hold expired. Choose your seats again.');
          return;
        }

        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        elements.holdText.textContent = `Seats held for ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      };

      tick();
      state.holdTimer = window.setInterval(tick, 1000);
    }

    function renderTripSelection() {
      const trip = state.selectedResult;
      if (!trip) {
        elements.checkoutEmpty.hidden = false;
        elements.checkoutStage.hidden = true;
        return;
      }

      elements.checkoutEmpty.hidden = true;
      elements.checkoutStage.hidden = false;
      elements.tripTitle.textContent = trip.coachName;
      elements.tripDate.textContent = `Departure ${formatDate(trip.departureDate)}`;
      elements.tripPrice.textContent = formatCurrencyWhole(trip.price);
      elements.operatorName.textContent = trip.operatorName;
      elements.coachLabel.textContent = trip.routeText;
      elements.departureTime.textContent = formatDisplayTime(trip.departureTime);
      elements.departureCity.textContent = trip.originCity || trip.departureStationName || 'Departure';
      elements.arrivalTime.textContent = formatDisplayTime(trip.arrivalTime);
      elements.arrivalCity.textContent = trip.destinationCity || trip.arrivalStationName || 'Arrival';
      elements.summaryTier.textContent = trip.routeGroupLabel;
      elements.summaryTitle.textContent = trip.coachName;
      elements.amenities.innerHTML = (trip.amenities || []).slice(0, 5).map((amenity) => `
        <span title="${escapeHtml(amenity)}" aria-label="${escapeHtml(amenity)}">
          <i class="fa-solid ${amenityIcon(amenity)}" aria-hidden="true"></i>
        </span>
      `).join('');
      renderSelectionSummary();
      renderPassengerManifest();
    }

    function syncPaymentButtons() {
      root.querySelectorAll('[data-payment-method]').forEach((button) => {
        const selected = button.getAttribute('data-payment-method') === state.method;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
      renderSelectionSummary();
    }

    function syncConfirmButton() {
      if (!state.selectedSeats.length) {
        elements.confirmBtn.textContent = 'Select seats to confirm';
        elements.confirmBtn.disabled = true;
        return;
      }
      if (state.confirming) {
        elements.confirmBtn.textContent = 'Confirming booking...';
        elements.confirmBtn.disabled = true;
        return;
      }
      const methodLabel = state.method === 'cash' ? 'Cash' : state.method === 'momo' ? 'MoMo' : 'Card';
      elements.confirmBtn.textContent = `Confirm ${state.selectedSeats.length} seat${state.selectedSeats.length === 1 ? '' : 's'} with ${methodLabel}`;
      elements.confirmBtn.disabled = false;
    }

    async function loadSeatMap(silent) {
      const trip = state.selectedResult;
      if (!trip) return;
      const params = new URLSearchParams();
      if (trip.tripId) params.set('tripId', String(trip.tripId));
      if (state.lockId) params.set('lockId', state.lockId);

      const response = await fetch(`${apiBase()}/bus/${trip.busId}/seats${params.toString() ? `?${params.toString()}` : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Failed to load seat map');
      const data = await response.json();
      state.cachedSeatData = data;

      const lockedSeats = normalizeSeatList(data.locked || []);
      const ownLockedSeats = normalizeSeatList(data.own_locked || []);
      const bookedSeats = normalizeSeatList(data.booked || []);
      const pendingLocks = Array.from(state.pendingSeatOps.entries()).filter(([, action]) => action === 'lock').map(([seatLabel]) => seatLabel);
      const pendingUnlocks = new Set(Array.from(state.pendingSeatOps.entries()).filter(([, action]) => action === 'unlock').map(([seatLabel]) => seatLabel));

      const merged = sortSeatLabels([...ownLockedSeats, ...pendingLocks]).filter((seatLabel) => !pendingUnlocks.has(seatLabel));
      state.selectedSeats = merged;

      if (!state.selectedSeats.length && !state.pendingSeatOps.size) {
        state.lockId = '';
        window.clearInterval(state.holdTimer);
        elements.holdTimer.hidden = true;
      }

      renderSelectionSummary();
      renderPassengerManifest();
      paintBusMap(lockedSeats, ownLockedSeats, bookedSeats);

      if (!silent && Array.isArray(data.own_locked) && data.own_locked.length && data.expires_at) {
        syncHoldTimer(data.expires_at);
      }
    }

    function paintOptimisticSeatMap() {
      const cached = state.cachedSeatData;
      if (!cached) return;
      paintBusMap(normalizeSeatList(cached.locked || []), normalizeSeatList(cached.own_locked || []), normalizeSeatList(cached.booked || []));
    }

    async function acquireSeat(seatLabel) {
      const trip = state.selectedResult;
      if (!trip) return;
      if (!state.lockId) state.lockId = createLockId();
      state.pendingSeatOps.set(seatLabel, 'lock');
      state.selectedSeats = sortSeatLabels([...state.selectedSeats, seatLabel]);
      renderSelectionSummary();
      renderPassengerManifest();
      paintOptimisticSeatMap();

      try {
        const response = await fetch(`${apiBase()}/bus/${trip.busId}/lock-seat`, {
          method: 'POST',
          headers: authHeaders() || { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seat: seatLabel, tripId: trip.tripId, lockId: state.lockId })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Failed to lock seat');
        state.lockId = data.lock_id || state.lockId;
        syncHoldTimer(data.expires_at);
      } finally {
        state.pendingSeatOps.delete(seatLabel);
        await loadSeatMap(true);
      }
    }

    async function releaseSeat(seatLabel) {
      const trip = state.selectedResult;
      if (!trip || !state.lockId) return;
      state.pendingSeatOps.set(seatLabel, 'unlock');
      state.selectedSeats = state.selectedSeats.filter((value) => value !== seatLabel);
      delete state.seatDrafts[seatLabel];
      renderSelectionSummary();
      renderPassengerManifest();
      paintOptimisticSeatMap();

      try {
        await fetch(`${apiBase()}/bus/${trip.busId}/unlock-seat`, {
          method: 'POST',
          headers: authHeaders() || { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seat: seatLabel, tripId: trip.tripId, lockId: state.lockId })
        });
      } finally {
        state.pendingSeatOps.delete(seatLabel);
        await loadSeatMap(true);
      }
    }

    function toggleSeat(seatLabel) {
      if (state.confirming || state.pendingSeatOps.has(seatLabel)) return;
      const action = state.selectedSeats.includes(seatLabel) ? releaseSeat(seatLabel) : acquireSeat(seatLabel);
      action.catch((error) => {
        notify('error', error.message || 'Seat action failed');
      });
    }

    async function releaseAllSeats() {
      const trip = state.selectedResult;
      if (!trip || !state.lockId || !state.selectedSeats.length) return;
      const seats = [...state.selectedSeats];
      for (const seatLabel of seats) {
        try {
          await fetch(`${apiBase()}/bus/${trip.busId}/unlock-seat`, {
            method: 'POST',
            headers: authHeaders() || { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seat: seatLabel, tripId: trip.tripId, lockId: state.lockId })
          });
        } catch (_err) {
          // Ignore release errors here.
        }
      }
      state.selectedSeats = [];
      state.lockId = '';
      state.seatDrafts = {};
      state.cachedSeatData = null;
      state.pendingSeatOps.clear();
      window.clearInterval(state.holdTimer);
      state.holdTimer = null;
      elements.holdTimer.hidden = true;
    }

    function renderResults() {
      const sorted = [...state.results].sort((left, right) => {
        if (state.sort === 'price') return Number(left.price || 0) - Number(right.price || 0);
        if (state.sort === 'departure') return String(left.departureTime || '').localeCompare(String(right.departureTime || ''));
        if (Number(right.seatsLeft || 0) !== Number(left.seatsLeft || 0)) return Number(right.seatsLeft || 0) - Number(left.seatsLeft || 0);
        return Number(left.price || 0) - Number(right.price || 0);
      });

      if (!sorted.length) {
        elements.resultsMeta.textContent = 'No trips match the current search.';
        elements.resultsList.innerHTML = '<div class="dashboard-booking-empty dashboard-booking-empty--results"><i class="fa-solid fa-route"></i><strong>No matching trips.</strong><span>Try another route, date, or operator scope.</span></div>';
        return;
      }

      elements.resultsMeta.textContent = `${sorted.length} trip${sorted.length === 1 ? '' : 's'} available for assisted booking.`;
      elements.resultsList.innerHTML = sorted.map((trip, index) => {
        const selected = matchesTrip(trip, state.selectedResult);
        return `
          <article class="bus-result-card dashboard-booking-result${selected ? ' is-selected' : ''}">
            <div class="bus-result-card__brand">
              <img src="${escapeHtml(trip.operatorLogo || 'ELITE TRANSPORT.png')}" alt="${escapeHtml(trip.operatorName)} logo" onerror="this.src='ELITE TRANSPORT.png'">
              <span class="bus-result-card__brand-name">${escapeHtml(trip.operatorName)}</span>
            </div>

            <div class="bus-result-card__body">
              <div class="bus-result-card__top">
                <div class="bus-result-card__rating">
                  <span class="bus-result-card__rating-badge">${escapeHtml(trip.routeGroupLabel)}</span>
                  <strong>${escapeHtml(trip.originCity || trip.departureStationName || 'Departure')} to ${escapeHtml(trip.destinationCity || trip.arrivalStationName || 'Arrival')}</strong>
                  <span class="bus-result-card__review-count">${escapeHtml(trip.stopSummary || 'Direct trip')}</span>
                </div>
                <div class="bus-result-card__price">
                  <small>per seat</small>
                  <strong>${formatCurrencyWhole(trip.price)}</strong>
                </div>
              </div>

              <div class="bus-result-card__options">
                <div class="bus-result-card__option is-selected">
                  <span>
                    <strong>${escapeHtml(formatDisplayTime(trip.departureTime))} - ${escapeHtml(formatDisplayTime(trip.arrivalTime))}</strong>
                    <small>${escapeHtml(trip.coachName)}</small>
                  </span>
                  <span class="bus-result-card__option-meta">
                    ${escapeHtml(trip.departureDate)}
                    <small>${escapeHtml(`${trip.seatsLeft} seats left`)}</small>
                  </span>
                  <span class="bus-result-card__option-duration">
                    ${escapeHtml(trip.durationLabel || formatDuration(trip.durationMinutes))}
                    <small>${escapeHtml(trip.routeText)}</small>
                  </span>
                </div>
              </div>

              <div class="bus-result-card__actions">
                <button type="button" class="bus-result-card__cta dashboard-booking-result__cta" data-result-index="${index}" ${trip.seatsLeft <= 0 ? 'disabled' : ''}>${selected ? 'Booking Desk Open' : 'Open Booking Desk'}</button>
              </div>
            </div>
          </article>
        `;
      }).join('');
    }

    async function performSearch(preserveSelection) {
      if (state.query.from && state.query.to && state.query.from === state.query.to) {
        notify('error', 'Choose two different cities to continue.');
        return;
      }

      if (!preserveSelection) {
        await releaseAllSeats();
        state.selectedResult = null;
        renderTripSelection();
      }

      elements.resultsMeta.textContent = 'Loading trips...';
      elements.resultsList.innerHTML = '';
      const params = new URLSearchParams({
        from: state.query.from,
        to: state.query.to,
        date: state.query.date,
        passengers: '1',
        sort: 'recommended',
        group: state.group || 'all'
      });

      const response = await fetch(`${apiBase()}/search/buses?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Failed to load trips');
      const payload = await response.json();

      let results = (payload.results || []).map(normalizeResult);
      // In admin context show all trips (incl. 0 seats for TTFPP/fully booked)
      if (state.options.context !== 'admin') {
        results = results.filter((trip) => Number(trip.seatsLeft || 0) > 0);
      }
      if (state.options.operatorId) {
        const operatorId = Number(state.options.operatorId || 0);
        results = results.filter((trip) => Number(trip.operatorId || 0) === operatorId);
      }

      state.results = results;
      if (state.selectedResult) {
        const updated = state.results.find((trip) => matchesTrip(trip, state.selectedResult));
        state.selectedResult = updated || null;
      }
      renderResults();
      renderTripSelection();
    }

    function buildPayload() {
      if (!state.selectedResult) {
        notify('error', 'Select a trip first.');
        return null;
      }
      if (!state.selectedSeats.length) {
        notify('error', 'Select at least one seat before confirming.');
        return null;
      }
      if (!state.lockId) {
        notify('error', 'Seat hold expired. Choose the seats again.');
        return null;
      }

      const contact = readContact();
      if (contact.email && !contact.email.includes('@')) {
        notify('error', 'Email address is invalid. Fix it or leave it blank.');
        return null;
      }
      if (!contact.phone) {
        notify('error', 'Enter a contact phone number before confirming.');
        return null;
      }

      ensurePassengerDrafts();
      const passengers = state.selectedSeats.map((seat) => {
        const draft = state.seatDrafts[seat] || {};
        const firstName = String(draft.firstName || '').trim();
        const lastName = String(draft.lastName || '').trim();
        if (!firstName || !lastName) {
          throw new Error(`Enter first and last name for seat ${seat}.`);
        }
        return {
          seat,
          firstName,
          lastName,
          email: contact.email,
          phone: contact.phone,
          nokName: contact.nokName || null,
          nokPhone: contact.nokPhone || null
        };
      });

      return {
        firstName: passengers[0].firstName,
        lastName: passengers[0].lastName,
        email: contact.email,
        phone: contact.phone,
        nokName: contact.nokName || null,
        nokPhone: contact.nokPhone || null,
        busId: state.selectedResult.busId,
        tripId: state.selectedResult.tripId || null,
        seats: state.selectedSeats,
        passengers,
        lockId: state.lockId,
        unitPrice: Number(state.selectedResult.price || 0),
        pricePaid: calculateTotal(),
        paymentMethod: state.method
      };
    }

    function buildConfirmedTicketPayload(bookingPayload, bookingData, selectedResult) {
      const bookingIds = Array.isArray(bookingData?.booking_ids) && bookingData.booking_ids.length
        ? bookingData.booking_ids.map((bookingId) => String(bookingId || '').trim()).filter(Boolean)
        : [String(bookingData?.booking_id || '').trim()].filter(Boolean);
      const seats = Array.isArray(bookingData?.seats) && bookingData.seats.length
        ? bookingData.seats.map((seat) => String(seat || '').trim()).filter(Boolean)
        : Array.isArray(bookingPayload?.seats)
          ? bookingPayload.seats.map((seat) => String(seat || '').trim()).filter(Boolean)
          : [];
      const passengers = Array.isArray(bookingPayload?.passengers)
        ? bookingPayload.passengers.map((passenger, index) => ({
            bookingId: bookingIds[index] || bookingData?.booking_id || null,
            seat: String(passenger?.seat || seats[index] || '').trim(),
            firstName: String(passenger?.firstName || '').trim(),
            lastName: String(passenger?.lastName || '').trim(),
            fullName: [passenger?.firstName, passenger?.lastName].filter(Boolean).join(' ').trim(),
            avatarUrl: ''
          }))
        : [];

      return {
        bookingId: bookingData?.booking_id || bookingIds[0] || null,
        bookingIds,
        routeName: bookingData?.route_name || selectedResult?.routeName || selectedResult?.routeText || 'Route',
        busName: bookingData?.bus_name || selectedResult?.coachName || 'Elite Transport Coach',
        seats,
        seatCount: Number(bookingData?.seat_count || seats.length || passengers.length || 0),
        totalPrice: Number(bookingData?.price || bookingPayload?.pricePaid || 0),
        unitPrice: Number(bookingPayload?.unitPrice || selectedResult?.price || 0),
        phone: String(bookingPayload?.phone || '').trim(),
        email: String(bookingPayload?.email || '').trim(),
        receiptUrl: bookingData?.receipt_url || null,
        status: bookingData?.status || 'confirmed',
        createdAt: new Date().toISOString(),
        selection: {
          routeText: selectedResult?.routeText || selectedResult?.routeName || bookingData?.route_name || 'Route',
          coachName: selectedResult?.coachName || bookingData?.bus_name || 'Elite Transport Coach',
          routeGroupLabel: selectedResult?.routeGroupLabel || 'Intercity',
          originCity: selectedResult?.originCity || selectedResult?.departureStationName || '',
          destinationCity: selectedResult?.destinationCity || selectedResult?.arrivalStationName || '',
          departureDate: selectedResult?.departureDate || '',
          departureTime: selectedResult?.departureTime || '',
          arrivalTime: selectedResult?.arrivalTime || '',
          durationLabel: selectedResult?.durationLabel || '',
          durationMinutes: Number(selectedResult?.durationMinutes || 0),
          rating: 4.9,
          reviewCount: 94,
          stopSummary: selectedResult?.stopSummary || 'Direct trip'
        },
        customerAvatar: '',
        passengers
      };
    }

    async function confirmBooking() {
      let payload;
      try {
        payload = buildPayload();
      } catch (error) {
        notify('error', error.message || 'Booking details are incomplete.');
        return;
      }
      if (!payload) return;

      const headers = authHeaders();
      if (!headers) {
        notify('error', 'Your dashboard session expired. Sign in again to confirm this booking.');
        return;
      }

      state.confirming = true;
      syncConfirmButton();

      try {
        const response = await fetch(`${apiBase()}${state.options.bookingEndpoint}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Failed to confirm booking');

        const ticketPayload = buildConfirmedTicketPayload(payload, data, state.selectedResult);

        notify('success', `Booking confirmed: ${data.booking_id || 'ELITE booking created'}`);
        state.selectedSeats = [];
        state.lockId = '';
        state.seatDrafts = {};
        state.pendingSeatOps.clear();
        state.cachedSeatData = null;
        window.clearInterval(state.holdTimer);
        state.holdTimer = null;
        elements.holdTimer.hidden = true;
        renderSelectionSummary();
        renderPassengerManifest();
        await performSearch(true);
        await loadSeatMap(true).catch(() => {});

        if (typeof state.options.onBookingCreated === 'function') {
          await state.options.onBookingCreated(data, {
            selectedResult: state.selectedResult,
            ticketPayload
          });
        }
      } catch (error) {
        notify('error', error.message || 'Booking confirmation failed.');
      } finally {
        state.confirming = false;
        syncConfirmButton();
      }
    }

    async function selectTrip(index) {
      const trip = state.results[index];
      if (!trip) return;
      if (trip.seatsLeft <= 0) {
        notify('error', 'This trip is fully booked.');
        return;
      }

      await releaseAllSeats();
      state.selectedResult = trip;
      renderTripSelection();
      await loadSeatMap(false).catch((error) => notify('error', error.message || 'Failed to load seats'));
      window.clearInterval(state.pollTimer);
      state.pollTimer = window.setInterval(() => {
        if (!state.selectedResult || state.pendingSeatOps.size || state.confirming) return;
        loadSeatMap(true).catch(() => {});
      }, POLL_INTERVAL_MS);
      // On single-column mobile layout scroll to the desk panel, not the top of the component
      if (window.innerWidth <= 1100) {
        elements.checkoutStage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    function bindEvents() {
      elements.searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        state.query.from = String(elements.from.value || '').trim();
        state.query.to = String(elements.to.value || '').trim();
        state.query.date = String(elements.date.value || todayIso()).trim();
        state.method = String(elements.methodFilter.value || 'cash').trim();
        state.group = String(elements.groupFilter?.value || 'all').trim();
        syncPaymentButtons();
        performSearch(false).catch((error) => notify('error', error.message || 'Search failed'));
      });

      elements.swapRoute.addEventListener('click', () => {
        const currentFrom = elements.from.value;
        elements.from.value = elements.to.value;
        elements.to.value = currentFrom;
      });

      elements.methodFilter.addEventListener('change', () => {
        state.method = String(elements.methodFilter.value || 'cash').trim();
        syncPaymentButtons();
      });

      if (elements.groupFilter) {
        elements.groupFilter.addEventListener('change', () => {
          state.group = String(elements.groupFilter.value || 'all').trim();
        });
      }

      elements.resultsList.addEventListener('click', (event) => {
        const button = event.target.closest('[data-result-index]');
        if (!button) return;
        const index = Number(button.getAttribute('data-result-index') || -1);
        selectTrip(index).catch((error) => notify('error', error.message || 'Failed to open booking desk'));
      });

      elements.sortStrip.querySelectorAll('[data-sort]').forEach((button) => {
        button.addEventListener('click', () => {
          state.sort = button.getAttribute('data-sort') || 'recommended';
          elements.sortStrip.querySelectorAll('[data-sort]').forEach((node) => node.classList.toggle('is-active', node === button));
          renderResults();
        });
      });

      root.querySelectorAll('[data-payment-method]').forEach((button) => {
        button.addEventListener('click', () => {
          state.method = button.getAttribute('data-payment-method') || 'cash';
          elements.methodFilter.value = state.method;
          syncPaymentButtons();
        });
      });

      ['contact-email', 'contact-phone', 'contact-nok-name', 'contact-nok-phone'].forEach((name) => {
        const node = el(name);
        node?.addEventListener('input', () => syncConfirmButton());
      });

      elements.confirmBtn.addEventListener('click', () => {
        confirmBooking().catch((error) => notify('error', error.message || 'Booking failed'));
      });
    }

    bindEvents();
    syncPaymentButtons();
    performSearch(true).catch((error) => notify('error', error.message || 'Search failed'));

    return {
      updateOptions(nextOptions) {
        state.options = { ...state.options, ...nextOptions };
        if (nextOptions.operatorId) {
          performSearch(true).catch(() => {});
        }
      },
      refresh() {
        return performSearch(true);
      }
    };
  }

  function mount(root, options) {
    if (!root) return null;
    if (root.__dashboardBookingDesk) {
      root.__dashboardBookingDesk.updateOptions(options || {});
      return root.__dashboardBookingDesk;
    }

    root.__dashboardBookingDesk = createInstance(root, options || {});
    return root.__dashboardBookingDesk;
  }

  window.DashboardBookingDesk = { mount };
})();
