(function () {
  'use strict';

  const API = 'https://realeliteweb-app.elitetransportghana.workers.dev/api';
  const SAVE_STATUS_ID = 'admin-ticket-save-status';
  const DOWNLOAD_BUTTON_ID = 'ticketDownload';

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function getActiveTicket() {
    return window.__ELITE_ACTIVE_TICKET || null;
  }

  function getAuthTokenValue() {
    return localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || '';
  }

  function normalizeBookingId(value) {
    const raw = String(value || '').trim().replace(/^ELITE-/i, '');
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function setSaveStatus(text, tone) {
    const el = document.getElementById(SAVE_STATUS_ID);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-saving', 'is-saved', 'is-warning');
    if (tone) el.classList.add(tone);
  }

  function flash(type, message) {
    if (typeof notify === 'function') {
      notify(type, message);
      return;
    }
    console[type === 'error' ? 'error' : 'log'](message);
  }

  function buildDownloadName(ticket) {
    return `elite-ticket-${String(ticket?.bookingId || 'booking').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}.pdf`;
  }

  function updateStoredReceiptUrl(ticket, receiptUrl) {
    if (!ticket || !receiptUrl) return;
    const stored = sessionStorage.getItem('latestConfirmedTicket');
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored);
      const ticketIds = Array.isArray(parsed.bookingIds) ? parsed.bookingIds.map((value) => String(value || '').trim()) : [];
      const activeRef = String(ticket.bookingId || '').trim();
      if (
        activeRef
        && activeRef !== String(parsed.bookingId || '').trim()
        && !ticketIds.includes(activeRef)
      ) {
        return;
      }
      parsed.receiptUrl = receiptUrl;
      sessionStorage.setItem('latestConfirmedTicket', JSON.stringify(parsed));
    } catch (_) {
      // ignore malformed ticket cache
    }
  }

  function downloadDataUri(filename, dataUri) {
    const link = document.createElement('a');
    link.href = dataUri;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function renderNode() {
    return document.getElementById('ticketCapture') || document.querySelector('.ticket-shell');
  }

  async function buildTicketPdfDataUri() {
    const node = renderNode();
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

  async function saveTicketPdf(ticket, dataUri) {
    const bookingId = normalizeBookingId(ticket?.bookingId || ticket?.bookingIds?.[0]);
    const token = getAuthTokenValue();
    if (!bookingId) throw new Error('Booking reference is missing.');
    if (!token) throw new Error('Admin session expired.');

    const response = await fetch(`${API}/admin/bookings/${bookingId}/receipt-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        pdfBase64: String(dataUri || '').replace(/^data:application\/pdf;base64,/i, '')
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Could not save the ticket PDF.');
    }
    return data;
  }

  function notifyParentReceiptSaved(ticket, receiptUrl) {
    const bookingId = normalizeBookingId(ticket?.bookingId || ticket?.bookingIds?.[0]);
    if (!bookingId || !receiptUrl || !window.parent || window.parent === window) return;
    window.parent.postMessage({
      type: 'admin-receipt-saved',
      bookingId,
      receiptUrl
    }, '*');
  }

  async function handleAdminDownload(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const ticket = getActiveTicket();
    if (!ticket) {
      flash('warning', 'No ticket is ready to download yet.');
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = 'Preparing PDF...';
    }
    setSaveStatus('Saving rendered PDF...', 'is-saving');

    try {
      let dataUri;
      try {
        dataUri = await buildTicketPdfDataUri();
      } catch (pdfError) {
        if (typeof printTicketDocument === 'function') {
          await printTicketDocument(ticket);
          setSaveStatus('Opened print view', 'is-warning');
          flash('info', 'Printer view opened because the direct PDF renderer was unavailable.');
          return;
        }
        throw pdfError;
      }

      downloadDataUri(buildDownloadName(ticket), dataUri);
      try {
        const saved = await saveTicketPdf(ticket, dataUri);
        updateStoredReceiptUrl(ticket, saved.receiptUrl || null);
        notifyParentReceiptSaved(ticket, saved.receiptUrl || null);
        setSaveStatus(saved.receiptUrl ? 'Saved to receipt store' : 'Downloaded locally', saved.receiptUrl ? 'is-saved' : 'is-warning');
        flash('success', saved.receiptUrl
          ? 'Ticket PDF downloaded and attached to the booking.'
          : 'Ticket PDF downloaded.');
      } catch (saveError) {
        console.error('Admin ticket save failed', saveError);
        setSaveStatus('Downloaded locally only', 'is-warning');
        flash('warning', `${saveError.message || 'Could not save receipt PDF.'} The file was still downloaded.`);
      }
    } catch (error) {
      console.error('Admin ticket download failed', error);
      setSaveStatus('Save failed', 'is-warning');
      flash('error', error.message || 'We could not prepare the admin ticket PDF.');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Download + Save PDF';
      }
    }
  }

  function bindAdminTicketDownload() {
    const original = document.getElementById(DOWNLOAD_BUTTON_ID);
    if (!original) return;
    const clone = original.cloneNode(true);
    original.replaceWith(clone);
    clone.addEventListener('click', handleAdminDownload);
  }

  onReady(() => {
    bindAdminTicketDownload();
    setSaveStatus('Ready to save', '');
  });
})();
