const TICKET_STORAGE_KEY = 'latestConfirmedTicket';
const TICKET_API_BASE = typeof API_BASE === 'string'
    ? API_BASE
    : 'https://realeliteweb-app.elitetransportghana.workers.dev/api';

function getTicketConfig() {
    return window.ELITE_TICKET_CONFIG || {};
}

function resolveTicketPath(key, fallbackPath) {
    const configured = getTicketConfig()[key];
    return typeof configured === 'string' && configured.trim()
        ? configured.trim()
        : fallbackPath;
}

function resolveTicketAssetUrl(relativePath) {
    return new URL(relativePath, getTicketAssetBaseHref()).href;
}

function getTicketAssetBaseHref() {
    const configuredBase = getTicketConfig().assetBase;
    return configuredBase
        ? new URL(configuredBase, window.location.href).href
        : new URL('.', window.location.href).href;
}

document.addEventListener('DOMContentLoaded', () => {
    initializeTicketPage().catch((error) => {
        console.error(error);
        notify('error', 'We could not load your ticket right now.');
    });
});

async function initializeTicketPage() {
    // Newsletter form now handled by newsletter.js
    const ticket = await resolveTicketPayload();
    window.__ELITE_ACTIVE_TICKET = ticket;
    renderTicketView(ticket);
    bindTicketActions(ticket);
    if (ticket && sessionStorage.getItem('_freshBooking') === '1') {
        sessionStorage.removeItem('_freshBooking');
        setTimeout(() => {
            notifyRich('Booking confirmed!', `Your ticket is ready. Safe travels, ${ticket.passengers?.[0]?.firstName || 'traveller'}!`, 'success', 6000);
            autoUploadTicketPdf(ticket);
        }, 600);
    }
}

async function resolveTicketPayload() {
    const params = new URLSearchParams(window.location.search);
    const ref = String(params.get('ref') || '').trim();
    const phone = String(params.get('phone') || '').trim();
    const stored = safeParseJson(sessionStorage.getItem(TICKET_STORAGE_KEY));

    if (stored && (!ref || stored.bookingId === ref || (stored.bookingIds || []).includes(ref))) {
        return normalizeTicketPayload(stored);
    }

    const overrideResolver = getTicketConfig().resolveTicketPayload;
    if (typeof overrideResolver === 'function') {
        try {
            const resolved = await overrideResolver({ ref, phone, stored });
            if (resolved) {
                sessionStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(resolved));
                return normalizeTicketPayload(resolved);
            }
        } catch (error) {
            console.error('Ticket override lookup failed', error);
        }
    }

    if (ref && phone) {
        try {
            const res = await fetch(`${TICKET_API_BASE}/booking/track?id=${encodeURIComponent(ref)}&phone=${encodeURIComponent(phone)}`, {
                cache: 'no-store'
            });
            if (res.ok) {
                const data = await res.json();
                if (data?.booking) {
                    const fallback = buildFallbackTicketPayload(data.booking, ref, phone);
                    sessionStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(fallback));
                    return normalizeTicketPayload(fallback);
                }
            }
        } catch (error) {
            console.error('Ticket fallback lookup failed', error);
        }
    }

    // Authenticated fallback: ref without phone (navigated from profile)
    if (ref) {
        const token = typeof getAuthToken === 'function' ? getAuthToken() : null;
        if (token) {
            try {
                const res = await fetch(`${TICKET_API_BASE}/booking/${encodeURIComponent(ref)}`, {
                    cache: 'no-store',
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data?.booking) {
                        const fallback = buildFallbackTicketPayload(data.booking, ref, '');
                        sessionStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(fallback));
                        return normalizeTicketPayload(fallback);
                    }
                }
            } catch (error) {
                console.error('Authenticated ticket lookup failed', error);
            }
        }
    }

    if (!ref && stored) {
        return normalizeTicketPayload(stored);
    }

    return null;
}

function renderTicketView(ticket) {
    const stack = document.getElementById('ticketStack');
    if (!ticket) {
        stack.innerHTML = `
            <article class="ticket-empty-card">
                <div class="ticket-empty-card__icon">
                    <i class="fa-solid fa-ticket"></i>
                </div>
                <h2>No confirmed ticket found</h2>
                <p>Finish checkout first, or use your booking reference to retrieve the ticket again.</p>
                <div class="ticket-empty-card__actions">
                    <a href="${escapeHtml(resolveTicketPath('searchPage', 'search.html'))}" class="ticket-empty-card__button">Find Bus</a>
                    <a href="${escapeHtml(resolveTicketPath('trackPage', 'track.html'))}" class="ticket-empty-card__link">Track existing booking</a>
                </div>
            </article>
        `;
        return;
    }

    const selection = ticket.selection || {};
    const routeParts = splitRouteText(ticket.routeName || selection.routeText || '');
    const originCity = selection.originCity || routeParts.from || 'Accra';
    const destinationCity = selection.destinationCity || routeParts.to || 'Kumasi';
    const breadcrumbRoute = ticket.routeName || selection.routeText || `${originCity} -> ${destinationCity}`;

    document.getElementById('ticketBreadcrumbRoute').textContent = breadcrumbRoute;
    document.getElementById('ticketTitle').textContent = ticket.busName || selection.coachName || 'Elite Transport Express';
    document.getElementById('ticketPrice').textContent = formatCurrencyWhole(ticket.totalPrice || 0);

    const locationParts = [
        breadcrumbRoute,
        selection.departureDate ? formatLongDate(selection.departureDate) : '',
        selection.departureTime ? `at ${formatDisplayTime(selection.departureTime)}` : '',
        selection.stopSummary || ''
    ].filter(Boolean);
    const locationText = document.querySelector('#ticketLocation span');
    if (locationText) {
        locationText.textContent = locationParts.join(' . ') || 'Elite Transport confirmed ticket';
    }

    const backLink = document.getElementById('ticketBackToSearch');
    const searchParams = new URLSearchParams();
    if (originCity) searchParams.set('from', originCity);
    if (destinationCity) searchParams.set('to', destinationCity);
    if (selection.departureDate) searchParams.set('date', selection.departureDate);
    backLink.href = `${resolveTicketPath('searchPage', 'search.html')}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

    stack.innerHTML = normalizePassengers(ticket).map((passenger, index) => renderTicketCard(ticket, passenger, index)).join('');
}

function bindTicketActions(ticket) {
    document.getElementById('ticketShare')?.addEventListener('click', async () => {
        if (!ticket) {
            notify('warning', 'No ticket is ready to share yet.');
            return;
        }

        const routeText = ticket.routeName || ticket.selection?.routeText || 'Elite Transport ticket';
        const shareData = {
            title: `${ticket.busName || 'Elite Transport'} ticket`,
            text: `${routeText} - ${ticket.bookingId || 'Confirmed booking'}`,
            url: ticket.receiptUrl || window.location.href
        };

        try {
            if (navigator.share) {
                await navigator.share(shareData);
                return;
            }

            await navigator.clipboard.writeText(shareData.url);
            notify('success', 'Ticket link copied.');
        } catch (error) {
            if (error?.name !== 'AbortError') {
                notify('info', 'Share was cancelled.');
            }
        }
    });

    document.getElementById('ticketDownload')?.addEventListener('click', async () => {
        if (!ticket) {
            notify('warning', 'No ticket is ready to download yet.');
            return;
        }

        try {
            // Always print the live ticket view as PDF — identical to what is on screen
            await printTicketDocument(ticket);
        } catch (error) {
            console.error('Ticket download/print failed', error);
            notify('error', 'We could not prepare the ticket view right now.');
        }
    });
}

function renderTicketCard(ticket, passenger, index) {
    const selection = ticket.selection || {};
    const routeParts = splitRouteText(ticket.routeName || selection.routeText || '');
    const originCity = selection.originCity || routeParts.from || 'Accra';
    const destinationCity = selection.destinationCity || routeParts.to || 'Kumasi';
    const journeyMapUrl = resolveTicketAssetUrl('journey-map.svg');
    const coachPreviewUrl = resolveTicketAssetUrl('modern-white-intercity-bus-scenic-highway-with-warmth-sunset-perfect-longdistance-travel-countryside-touring_1016244-3580 (1).avif');
    const bookingRef = passenger.bookingId || ticket.bookingId || `ELITE-${index + 1}`;
    const passengerName = passenger.fullName || [passenger.firstName, passenger.lastName].filter(Boolean).join(' ').trim() || `Passenger ${index + 1}`;
    const avatarUrl = passenger.avatarUrl ? readTicketAvatarUrl(passenger.avatarUrl, 256) : '';
    const avatarMarkup = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(passengerName)}" decoding="async" referrerpolicy="no-referrer">`
        : escapeHtml(initialsFromName(passengerName));
    const ticketCode = String(bookingRef || '').replace(/^ELITE-/i, 'ET-');
    const scanCode = buildTicketScanCode(ticket, passenger, index);
    const barcodeMarkup = renderTicketBarcodeMarkup(scanCode, bookingRef);
    const departureTime = selection.departureTime ? formatDisplayTime(selection.departureTime) : 'Confirmed';
    const arrivalTime = selection.arrivalTime
        ? formatDisplayTime(selection.arrivalTime)
        : selection.departureTime
            ? addMinutesToClock(selection.departureTime, selection.durationMinutes || 290)
            : 'Ready';

    return `
        <section class="ticket-pass-row">
            <article class="ticket-pass-card">
                <div class="ticket-pass-card__rail">
                    <div class="ticket-pass-time">
                        <strong>${escapeHtml(departureTime)}</strong>
                        <span>${escapeHtml(originCity)}</span>
                    </div>

                    <div class="ticket-pass-route-line" aria-hidden="true">
                        <span></span>
                        <i class="fa-solid fa-bus-simple"></i>
                        <span></span>
                    </div>

                    <div class="ticket-pass-time">
                        <strong>${escapeHtml(arrivalTime)}</strong>
                        <span>${escapeHtml(destinationCity)}</span>
                    </div>
                </div>

                <div class="ticket-pass-card__body">
                    <div class="ticket-passenger-bar">
                        <div class="ticket-passenger-identity">
                            <div class="ticket-passenger-avatar">${avatarMarkup}</div>
                            <div class="ticket-passenger-copy">
                                <strong>${escapeHtml(passengerName)}</strong>
                                <span>Boarding Pass N'${escapeHtml(bookingRef)}</span>
                            </div>
                        </div>

                        <div class="ticket-class-chip">${escapeHtml(selection.routeGroupLabel || 'Intercity')}</div>
                    </div>

                    <div class="ticket-pass-metadata">
                        <div class="ticket-meta-item">
                            <i class="fa-regular fa-calendar"></i>
                            <div>
                                <strong>Date</strong>
                                <span>${escapeHtml(selection.departureDate ? formatLongDate(selection.departureDate) : 'Confirmed trip')}</span>
                            </div>
                        </div>
                        <div class="ticket-meta-item">
                            <i class="fa-regular fa-clock"></i>
                            <div>
                                <strong>Travel time</strong>
                                <span>${escapeHtml(selection.durationLabel || formatDuration(selection.durationMinutes || 290))}</span>
                            </div>
                        </div>
                        <div class="ticket-meta-item">
                            <i class="fa-solid fa-road"></i>
                            <div>
                                <strong>Route</strong>
                                <span>${escapeHtml(ticket.routeName || selection.routeText || `${originCity} -> ${destinationCity}`)}</span>
                            </div>
                        </div>
                        <div class="ticket-meta-item">
                            <i class="fa-solid fa-couch"></i>
                            <div>
                                <strong>Seat</strong>
                                <span>${escapeHtml(passenger.seat || 'Assigned')}</span>
                            </div>
                        </div>
                    </div>

                    <div class="ticket-pass-meta">
                        <div class="ticket-pass-meta__code">
                            <strong>ET</strong>
                            <span>${escapeHtml(ticketCode)}</span>
                        </div>
                        <div class="ticket-pass-barcode">
                            ${barcodeMarkup}
                            <span class="sr-only">Verification code ${escapeHtml(scanCode)} for ${escapeHtml(bookingRef)}</span>
                        </div>
                    </div>
                </div>
            </article>

            <aside class="ticket-mini-map" aria-hidden="true">
                <div class="ticket-mini-map__art">
                    <img src="${escapeHtml(journeyMapUrl)}" alt="">
                </div>
                <div class="ticket-mini-map__arc"></div>
                <div class="ticket-mini-map__point ticket-mini-map__point--start">
                    <div class="ticket-mini-map__thumb">
                        <img src="${escapeHtml(coachPreviewUrl)}" alt="">
                    </div>
                    <div>
                        <strong>${escapeHtml(originCity)}</strong>
                        <span>${escapeHtml(passenger.seat || 'Seat assigned')}</span>
                    </div>
                </div>
                <div class="ticket-mini-map__point ticket-mini-map__point--end">
                    <div class="ticket-mini-map__thumb">
                        <img src="${escapeHtml(coachPreviewUrl)}" alt="">
                    </div>
                    <div>
                        <strong>${escapeHtml(destinationCity)}</strong>
                        <span>${escapeHtml(bookingRef)}</span>
                    </div>
                </div>
            </aside>
        </section>
    `;
}

function normalizeTicketPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return {
        ...payload,
        totalPrice: Number(payload.totalPrice || payload.price || 0),
        seatCount: Number(payload.seatCount || payload.seat_count || 0),
        selection: payload.selection || {},
        passengers: normalizePassengers(payload)
    };
}

function normalizePassengers(ticket) {
    if (Array.isArray(ticket?.passengers) && ticket.passengers.length) {
        return ticket.passengers.map((passenger, index) => ({
            bookingId: passenger.bookingId || ticket.bookingIds?.[index] || ticket.bookingId || null,
            seat: String(passenger.seat || ticket.seats?.[index] || '').trim(),
            firstName: String(passenger.firstName || '').trim(),
            lastName: String(passenger.lastName || '').trim(),
            fullName: String(passenger.fullName || [passenger.firstName, passenger.lastName].filter(Boolean).join(' ')).trim(),
            avatarUrl: String(passenger.avatarUrl || (index === 0 ? ticket.customerAvatar || '' : '')).trim()
        }));
    }

    const fallbackName = String(ticket?.passengerName || ticket?.passenger_name || '').trim();
    return [{
        bookingId: ticket?.bookingId || null,
        seat: String(ticket?.seats?.[0] || '').trim(),
        firstName: fallbackName.split(/\s+/)[0] || '',
        lastName: fallbackName.split(/\s+/).slice(1).join(' '),
        fullName: fallbackName || 'Passenger 1',
        avatarUrl: String(ticket?.customerAvatar || '').trim()
    }];
}

function buildFallbackTicketPayload(booking, ref, phone) {
    const routeName = String(booking.route_name || 'Elite Transport Route').trim();
    const routeParts = splitRouteText(routeName);
    const seats = String(booking.seat_number || booking.seats || booking.seat || '')
        .split(',')
        .map((seat) => seat.trim())
        .filter(Boolean);
    const passengerName = String(
        booking.passenger_name
        || booking.passengerName
        || `${booking.passenger?.firstName || booking.first_name || ''} ${booking.passenger?.lastName || booking.last_name || ''}`
    ).trim();

    return {
        bookingId: String(booking.booking_id || ref || '').trim(),
        bookingIds: [String(booking.booking_id || ref || '').trim()].filter(Boolean),
        routeName,
        busName: String(booking.bus_name || 'Elite Transport Express').trim(),
        seats,
        seatCount: seats.length || 1,
        totalPrice: Number(booking.price_paid || booking.price || 0),
        phone: phone || String(booking.phone || '').trim(),
        email: String(booking.email || '').trim(),
        receiptUrl: booking.receipt_url || null,
        status: String(booking.status || 'confirmed').trim(),
        createdAt: String(booking.created_at || new Date().toISOString()).trim(),
        selection: {
            routeText: routeName,
            coachName: String(booking.bus_name || 'Elite Transport Express').trim(),
            routeGroupLabel: 'Intercity',
            originCity: routeParts.from || 'Accra',
            destinationCity: routeParts.to || 'Kumasi',
            departureDate: '',
            departureTime: '',
            arrivalTime: '',
            durationLabel: '',
            durationMinutes: 290,
            rating: 4.9,
            reviewCount: 94,
            stopSummary: 'no stop'
        },
        customerAvatar: '',
        passengers: [{
            bookingId: String(booking.booking_id || ref || '').trim(),
            seat: seats[0] || '',
            firstName: passengerName.split(/\s+/)[0] || '',
            lastName: passengerName.split(/\s+/).slice(1).join(' '),
            fullName: passengerName || 'Passenger 1',
            avatarUrl: ''
        }]
    };
}

// Newsletter form now handled by newsletter.js

async function printTicketDocument(ticket) {
    const printWindow = window.open('', 'elite-ticket-print', 'width=1280,height=900');
    if (!printWindow) {
        window.print();
        return;
    }

    const documentMarkup = buildPrintableTicketDocument(ticket);
    printWindow.document.open();
    printWindow.document.write(documentMarkup);
    printWindow.document.close();

    await waitForPrintableDocument(printWindow);

    printWindow.addEventListener('afterprint', () => {
        window.setTimeout(() => {
            try {
                printWindow.close();
            } catch (error) {
                console.warn('Unable to close print window', error);
            }
        }, 120);
    }, { once: true });

    printWindow.focus();
    printWindow.print();
}

function buildPrintableTicketDocument(ticket) {
    const baseHref = getTicketAssetBaseHref();
    const title = document.getElementById('ticketTitle')?.textContent?.trim() || ticket?.busName || 'Elite Transport Express';
    const price = document.getElementById('ticketPrice')?.textContent?.trim() || formatCurrencyWhole(ticket?.totalPrice || 0);
    const locationText = document.querySelector('#ticketLocation span')?.textContent?.trim() || 'Elite Transport confirmed ticket';
    const ticketCards = normalizePassengers(ticket).map((passenger, index) => renderTicketCard(ticket, passenger, index)).join('');
    const termsMarkup = document.querySelector('.ticket-terms')?.outerHTML || '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} | Receipt</title>
    <base href="${escapeHtml(baseHref)}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="stylesheet" href="${escapeHtml(resolveTicketAssetUrl('ticket.css?v=3'))}">
    <style>
        :root {
            color-scheme: light;
        }

        @page {
            size: A4 landscape;
            margin: 10mm;
        }

        html,
        body {
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #112211;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        body {
            font-family: 'Montserrat', 'Segoe UI', sans-serif;
        }

        .ticket-print-root {
            padding: 0;
        }

        .ticket-print-shell {
            width: 100%;
            max-width: 100%;
            margin: 0 auto;
        }

        .ticket-print-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 24px;
            margin: 0 0 22px;
        }

        .ticket-print-header h1 {
            margin: 0 0 14px;
            font-size: 2.35rem;
            line-height: 1.02;
            font-weight: 700;
            color: #112211;
        }

        .ticket-print-location {
            margin: 0;
            display: inline-flex;
            align-items: center;
            gap: 10px;
            color: rgba(17, 34, 17, 0.72);
            font-size: 1rem;
            font-weight: 500;
        }

        .ticket-print-price {
            flex: 0 0 auto;
            font-size: 3rem;
            line-height: 1;
            font-weight: 700;
            color: #112211;
            white-space: nowrap;
            text-align: right;
        }

        .ticket-stack {
            display: grid !important;
            gap: 16px !important;
        }

        .ticket-pass-row {
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) 208px !important;
            gap: 0 !important;
            align-items: stretch !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
        }

        .ticket-pass-row + .ticket-pass-row {
            break-before: page;
            page-break-before: always;
        }

        .ticket-pass-card,
        .ticket-mini-map,
        .ticket-terms {
            box-shadow: none !important;
        }

        .ticket-pass-card {
            grid-template-columns: 188px minmax(0, 1fr) !important;
            min-height: 0;
        }

        .ticket-pass-card__rail {
            display: grid !important;
            grid-template-columns: 1fr !important;
            align-content: space-between !important;
            align-items: start !important;
            gap: 22px !important;
            position: relative !important;
            min-height: 250px !important;
            padding: 24px 22px !important;
        }

        .ticket-pass-time {
            display: grid !important;
            gap: 8px !important;
            justify-items: start !important;
        }

        .ticket-pass-time strong {
            font-size: 2.45rem !important;
            line-height: 0.94 !important;
            margin: 0 !important;
        }

        .ticket-pass-time span {
            display: block !important;
            font-size: 0.95rem !important;
            line-height: 1.1 !important;
        }

        .ticket-pass-route-line {
            position: absolute !important;
            inset: 50% auto auto 50% !important;
            transform: translate(-50%, -50%) !important;
            display: grid !important;
            justify-items: center !important;
            gap: 14px !important;
        }

        .ticket-pass-route-line span {
            width: 2px !important;
            height: 32px !important;
            background:
                linear-gradient(180deg, rgba(17, 34, 17, 0.16) 0%, rgba(17, 34, 17, 0.16) 50%, transparent 50%, transparent 100%) !important;
            background-size: 2px 10px !important;
        }

        .ticket-pass-route-line i {
            font-size: 1.2rem !important;
        }

        .ticket-pass-card__body {
            display: grid !important;
            grid-template-rows: auto auto 1fr !important;
            min-width: 0 !important;
        }

        .ticket-passenger-bar {
            min-height: 84px;
            padding: 18px 20px !important;
            flex-direction: row !important;
            align-items: center !important;
            justify-content: space-between !important;
        }

        .ticket-passenger-identity {
            display: flex !important;
            align-items: center !important;
            gap: 14px !important;
            min-width: 0 !important;
        }

        .ticket-passenger-avatar {
            width: 44px !important;
            height: 44px !important;
            font-size: 0.9rem !important;
        }

        .ticket-passenger-copy strong {
            font-size: 1.4rem !important;
        }

        .ticket-passenger-copy span {
            font-size: 0.82rem !important;
            line-height: 1.25 !important;
        }

        .ticket-class-chip {
            font-size: 0.9rem !important;
        }

        .ticket-pass-metadata {
            grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
            gap: 0 !important;
            padding: 20px 20px 16px !important;
        }

        .ticket-meta-item {
            display: flex !important;
            align-items: flex-start !important;
            gap: 10px;
        }

        .ticket-meta-item i {
            width: 24px !important;
            height: 24px !important;
            border-radius: 6px !important;
            font-size: 0.75rem !important;
        }

        .ticket-meta-item strong {
            font-size: 0.8rem !important;
            line-height: 1.1 !important;
            margin-bottom: 3px !important;
        }

        .ticket-meta-item span {
            font-size: 0.78rem !important;
            line-height: 1.25 !important;
        }

        .ticket-pass-meta {
            padding: 20px !important;
            flex-direction: row !important;
            align-items: flex-end !important;
            justify-content: space-between !important;
        }

        .ticket-pass-meta__code strong {
            font-size: 2.1rem !important;
            line-height: 0.95 !important;
            margin-bottom: 6px !important;
        }

        .ticket-pass-meta__code span {
            font-size: 0.9rem !important;
        }

        .ticket-pass-barcode {
            width: 230px !important;
        }

        .ticket-pass-barcode__svg {
            height: 72px !important;
        }

        .ticket-mini-map {
            min-height: 0;
            padding: 18px 16px !important;
            position: relative !important;
        }

        .ticket-mini-map__art {
            opacity: 0.82 !important;
        }

        .ticket-mini-map__arc {
            left: 24px !important;
            right: 24px !important;
            top: 74px !important;
            bottom: 44px !important;
            border-top-width: 3px !important;
        }

        .ticket-mini-map__point {
            min-width: 120px;
            padding: 8px 10px !important;
            gap: 8px !important;
        }

        .ticket-mini-map__point--start {
            left: 16px !important;
            bottom: 28px !important;
        }

        .ticket-mini-map__point--end {
            right: 16px !important;
            top: 24px !important;
        }

        .ticket-mini-map__thumb {
            width: 28px !important;
            height: 28px !important;
        }

        .ticket-mini-map__point strong {
            font-size: 0.76rem !important;
            line-height: 1.05 !important;
        }

        .ticket-mini-map__point span {
            font-size: 0.62rem !important;
            margin-top: 2px !important;
        }

        .ticket-terms {
            margin-top: 24px !important;
            padding: 26px 28px 30px !important;
            break-before: page;
            page-break-before: always;
        }

        .ticket-terms h2 {
            font-size: 1.9rem !important;
            margin-bottom: 22px !important;
        }

        .ticket-terms h3 {
            font-size: 1.25rem !important;
            margin-bottom: 12px !important;
        }

        .ticket-terms p,
        .ticket-terms li {
            font-size: 0.92rem !important;
            line-height: 1.55 !important;
        }

        .ticket-terms__block + .ticket-terms__block {
            margin-top: 22px !important;
            padding-top: 20px !important;
        }

        @media print {
            html,
            body {
                width: auto;
                height: auto;
            }
        }
    </style>
</head>
<body class="ticket-page">
    <main class="ticket-print-root">
        <section class="ticket-print-shell">
            <header class="ticket-print-header">
                <div>
                    <h1>${escapeHtml(title)}</h1>
                    <p class="ticket-print-location">
                        <i class="fa-solid fa-location-dot" aria-hidden="true"></i>
                        <span>${escapeHtml(locationText)}</span>
                    </p>
                </div>
                <div class="ticket-print-price">${escapeHtml(price)}</div>
            </header>

            <section class="ticket-stack">
                ${ticketCards}
            </section>

            ${termsMarkup}
        </section>
    </main>
</body>
</html>`;
}

async function waitForPrintableDocument(printWindow) {
    const { document } = printWindow;
    const images = Array.from(document.images || []);

    const imagePromises = images.map((image) => {
        if (image.complete) return Promise.resolve();
        return new Promise((resolve) => {
            const done = () => resolve();
            image.addEventListener('load', done, { once: true });
            image.addEventListener('error', done, { once: true });
            window.setTimeout(done, 2400);
        });
    });

    if (document.fonts?.ready) {
        try {
            await document.fonts.ready;
        } catch (error) {
            console.warn('Print fonts did not finish loading', error);
        }
    }

    await Promise.all(imagePromises);
    await new Promise((resolve) => printWindow.requestAnimationFrame(() => printWindow.requestAnimationFrame(resolve)));
}

function readTicketAvatarUrl(url, size = 256) {
    const value = String(url || '').trim();
    if (!value) return '';
    if (typeof window.getOptimizedProfileImageUrl === 'function') {
        return window.getOptimizedProfileImageUrl(value, size);
    }
    return value;
}

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
}

function computeLuhnCheckDigit(value) {
    const digits = digitsOnly(value).split('').reverse().map(Number);
    let sum = 0;

    for (let i = 0; i < digits.length; i += 1) {
        let digit = digits[i];
        if (i % 2 === 0) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
    }

    return String((10 - (sum % 10)) % 10);
}

function buildTicketScanCode(ticket, passenger, index) {
    const bookingDigits = digitsOnly(passenger?.bookingId || ticket?.bookingId || index + 1).slice(-7).padStart(7, '0');
    const seatDigits = digitsOnly(passenger?.seat || '').slice(-2).padStart(2, '0');
    const phoneDigits = digitsOnly(ticket?.phone || '').slice(-8).padStart(8, '0');
    const base = `91${bookingDigits}${seatDigits}${phoneDigits}`;
    return `${base}${computeLuhnCheckDigit(base)}`;
}

function renderTicketBarcodeMarkup(scanCode, bookingRef) {
    const svg = buildInterleavedTwoOfFiveSvg(scanCode, `Scan to confirm ${bookingRef}`);
    if (!svg) {
        return `<span class="ticket-pass-barcode__fallback">${escapeHtml(bookingRef)}</span>`;
    }
    return `${svg}<span class="ticket-pass-barcode__label">Scan to confirm</span>`;
}

function buildInterleavedTwoOfFiveSvg(value, accessibleLabel) {
    const patterns = {
        0: 'nnwwn',
        1: 'wnnnw',
        2: 'nwnnw',
        3: 'wwnnn',
        4: 'nnwnw',
        5: 'wnwnn',
        6: 'nwwnn',
        7: 'nnnww',
        8: 'wnnwn',
        9: 'nwnwn'
    };
    const digits = digitsOnly(value);
    if (!digits) return '';

    const normalized = digits.length % 2 === 0 ? digits : `0${digits}`;
    const narrow = 2;
    const wide = 5;
    const quietZone = 14;
    const barHeight = 68;
    let x = quietZone;
    const bars = [];

    const widthFor = (token) => (token === 'w' ? wide : narrow);
    const addBar = (width) => {
        bars.push(`<rect x="${x}" y="0" width="${width}" height="${barHeight}" fill="#112211" rx="0.4"></rect>`);
        x += width;
    };
    const addSpace = (width) => {
        x += width;
    };

    addBar(narrow);
    addSpace(narrow);
    addBar(narrow);
    addSpace(narrow);

    for (let i = 0; i < normalized.length; i += 2) {
        const left = patterns[normalized.charAt(i)];
        const right = patterns[normalized.charAt(i + 1)];
        if (!left || !right) return '';

        for (let j = 0; j < 5; j += 1) {
            addBar(widthFor(left.charAt(j)));
            addSpace(widthFor(right.charAt(j)));
        }
    }

    addBar(wide);
    addSpace(narrow);
    addBar(narrow);

    const totalWidth = x + quietZone;
    return `
        <svg class="ticket-pass-barcode__svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${barHeight}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(accessibleLabel)}">
            <rect width="${totalWidth}" height="${barHeight}" fill="#ffffff"></rect>
            ${bars.join('')}
        </svg>
    `;
}

function splitRouteText(routeText) {
    const text = String(routeText || '').trim();
    if (text.includes('->')) {
        const [from, to] = text.split('->');
        return {
            from: String(from || '').trim(),
            to: String(to || '').trim()
        };
    }
    return { from: '', to: '' };
}

function formatCurrencyWhole(amount) {
    return `GHS ${Number(amount || 0).toLocaleString('en-GH', { maximumFractionDigits: 0 })}`;
}

function formatDisplayTime(value) {
    if (!value) return '';
    const raw = String(value).trim();
    if (/am|pm/i.test(raw)) return raw.toLowerCase();

    const [hourText, minuteText] = raw.split(':');
    const hour = Number(hourText);
    const minute = Number(minuteText || 0);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return raw;

    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return date.toLocaleTimeString('en-GH', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }).toLowerCase();
}

function addMinutesToClock(timeValue, minutesToAdd) {
    const raw = String(timeValue || '08:00').trim();
    let hour = 8;
    let minute = 0;

    if (/am|pm/i.test(raw)) {
        const match = raw.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
        if (match) {
            hour = Number(match[1]) % 12;
            minute = Number(match[2]);
            if (match[3].toLowerCase() === 'pm') hour += 12;
        }
    } else {
        const parts = raw.split(':');
        hour = Number(parts[0] || 8);
        minute = Number(parts[1] || 0);
    }

    const date = new Date();
    date.setHours(hour, minute + Number(minutesToAdd || 0), 0, 0);
    return date.toLocaleTimeString('en-GH', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    }).toLowerCase();
}

function formatDuration(minutesValue) {
    const minutes = Number(minutesValue || 0);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours}h ${remainder}m`;
}

function formatLongDate(dateValue) {
    if (!dateValue) return '';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return String(dateValue);
    return date.toLocaleDateString('en-GH', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    });
}

function initialsFromName(name) {
    return String(name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join('') || 'ET';
}

function safeParseJson(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function buildTicketPdfDataUri() {
    const node = document.getElementById('ticketCapture') || document.querySelector('.ticket-shell');
    if (!node) throw new Error('Ticket view is not ready yet.');
    if (!window.html2canvas || !window.jspdf?.jsPDF) {
        throw new Error('PDF renderer is not available.');
    }
    const canvas = await window.html2canvas(node, {
        scale: Math.max(2, Math.min(window.devicePixelRatio || 1, 3)),
        useCORS: true,
        backgroundColor: '#f2f7f4',
        logging: false
    });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'pt', 'a4');
    const margin = 22;
    const pageWidth = pdf.internal.pageSize.getWidth() - margin * 2;
    const pageHeight = pdf.internal.pageSize.getHeight() - margin * 2;
    const imageData = canvas.toDataURL('image/png');
    const imageWidth = pageWidth;
    const imageHeight = (canvas.height * imageWidth) / canvas.width;
    let remainingHeight = imageHeight;
    let offsetY = margin;
    pdf.addImage(imageData, 'PNG', margin, offsetY, imageWidth, imageHeight, undefined, 'FAST');
    remainingHeight -= pageHeight;
    while (remainingHeight > 0) {
        offsetY = margin - (imageHeight - remainingHeight);
        pdf.addPage();
        pdf.addImage(imageData, 'PNG', margin, offsetY, imageWidth, imageHeight, undefined, 'FAST');
        remainingHeight -= pageHeight;
    }
    return pdf.output('datauristring');
}

async function autoUploadTicketPdf(ticket) {
    const bookingId = String(ticket?.bookingId || ticket?.bookingIds?.[0] || '').trim().replace(/^ELITE-/i, '');
    if (!bookingId) return;
    try {
        const dataUri = await buildTicketPdfDataUri();
        const pdfBase64 = String(dataUri || '').replace(/^data:application\/pdf;base64,/i, '');
        if (!pdfBase64) return;
        await fetch(`${TICKET_API_BASE}/booking/upload-receipt-pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookingId: Number(bookingId), phone: ticket.phone, pdfBase64 })
        });
    } catch (e) {
        console.error('Auto-upload failed', e);
    }
}
