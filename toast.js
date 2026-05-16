// toast.js
// Premium toast notifications aligned with Elite Transport design system

class Toast {
    constructor() {
        this.injectStyles();
    }

    createContainer() {
        if (!document.body) return null;
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.cssText = [
                'position: fixed',
                'top: 16px',
                'right: 16px',
                'z-index: 10000',
                'display: flex',
                'flex-direction: column',
                'gap: 10px',
                'pointer-events: none'
            ].join(';');
            document.body.appendChild(container);
        }
        return container;
    }

    getTheme(type) {
        const themes = {
            success: {
                bg: 'linear-gradient(145deg, rgba(255, 255, 255, 0.98) 0%, #eefaf3 100%)',
                color: '#214535',
                border: '#b6e6cc',
                accent: '#8dd3bb',
                chipBg: 'linear-gradient(135deg, #dff3ea 0%, #ffffff 100%)',
                chipColor: '#214535',
                icon: '<i class="fa-solid fa-circle-check"></i>'
            },
            error: {
                bg: 'linear-gradient(145deg, rgba(255, 255, 255, 0.98) 0%, #fff1f0 100%)',
                color: '#8e3f43',
                border: '#f3c3c0',
                accent: '#fd736e',
                chipBg: 'linear-gradient(135deg, #ffe1df 0%, #ffffff 100%)',
                chipColor: '#a64b4f',
                icon: '<i class="fa-solid fa-circle-exclamation"></i>'
            },
            warning: {
                bg: 'linear-gradient(145deg, rgba(255, 255, 255, 0.98) 0%, #fff6ea 100%)',
                color: '#8a5a14',
                border: '#f1d8aa',
                accent: '#f4b860',
                chipBg: 'linear-gradient(135deg, #fff0d6 0%, #ffffff 100%)',
                chipColor: '#8a5a14',
                icon: '<i class="fa-solid fa-triangle-exclamation"></i>'
            },
            info: {
                bg: 'linear-gradient(145deg, rgba(255, 255, 255, 0.98) 0%, #edf8fb 100%)',
                color: '#225866',
                border: '#c1dfe8',
                accent: '#7fcddd',
                chipBg: 'linear-gradient(135deg, #ddf1f5 0%, #ffffff 100%)',
                chipColor: '#225866',
                icon: '<i class="fa-solid fa-circle-info"></i>'
            }
        };
        return themes[type] || themes.info;
    }

    dismiss(toast, delay = 0) {
        setTimeout(() => {
            toast.classList.remove('show');
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 220);
        }, delay);
    }

    show(message, type = 'info', duration = 3200) {
        const container = this.createContainer();
        if (!container) return null;

        const theme = this.getTheme(type);
        const toast = document.createElement('div');
        toast.className = 'elite-toast';
        toast.style.cssText = [
            `background: ${theme.bg}`,
            `color: ${theme.color}`,
            `border: 1px solid ${theme.border}`,
            `--toast-accent: ${theme.accent}`,
            `--toast-chip-bg: ${theme.chipBg}`,
            `--toast-chip-color: ${theme.chipColor}`,
            'box-shadow: 0 20px 40px rgba(17, 34, 17, 0.14)'
        ].join(';');

        toast.innerHTML = `
            <span class="elite-toast-icon">${theme.icon}</span>
            <span class="elite-toast-message">${message}</span>
            <button type="button" class="elite-toast-close" aria-label="Close">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;

        const closeBtn = toast.querySelector('.elite-toast-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.dismiss(toast));
        }

        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));

        if (duration > 0) {
            this.dismiss(toast, duration);
        }

        return toast;
    }

    success(message, duration = 3200) {
        return this.show(message, 'success', duration);
    }

    error(message, duration = 4200) {
        return this.show(message, 'error', duration);
    }

    warning(message, duration = 3600) {
        return this.show(message, 'warning', duration);
    }

    info(message, duration = 3200) {
        return this.show(message, 'info', duration);
    }

    showRich(title, body, type = 'info', duration = 4800) {
        const container = this.createContainer();
        if (!container) return null;
        const theme = this.getTheme(type);
        const toast = document.createElement('div');
        toast.className = 'elite-toast';
        toast.style.cssText = [
            `background: ${theme.bg}`,
            `color: ${theme.color}`,
            `border: 1px solid ${theme.border}`,
            `--toast-accent: ${theme.accent}`,
            `--toast-chip-bg: ${theme.chipBg}`,
            `--toast-chip-color: ${theme.chipColor}`,
            'box-shadow: 0 20px 40px rgba(17, 34, 17, 0.14)'
        ].join(';');

        const iconEl = document.createElement('span');
        iconEl.className = 'elite-toast-icon';
        iconEl.innerHTML = theme.icon;

        const messageEl = document.createElement('span');
        messageEl.className = 'elite-toast-message';
        const titleEl = document.createElement('strong');
        titleEl.className = 'elite-toast-title';
        titleEl.textContent = title;
        const bodyEl = document.createElement('span');
        bodyEl.className = 'elite-toast-body';
        bodyEl.textContent = body;
        messageEl.appendChild(titleEl);
        messageEl.appendChild(bodyEl);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'elite-toast-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        closeBtn.addEventListener('click', () => this.dismiss(toast));

        toast.appendChild(iconEl);
        toast.appendChild(messageEl);
        toast.appendChild(closeBtn);
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        if (duration > 0) this.dismiss(toast, duration);
        return toast;
    }

    injectStyles() {
        if (document.querySelector('style[data-toast-theme]')) return;

        const style = document.createElement('style');
        style.setAttribute('data-toast-theme', 'true');
        style.textContent = `
            .elite-toast {
                width: min(420px, calc(100vw - 32px));
                position: relative;
                overflow: hidden;
                border-radius: 20px;
                padding: 14px 14px 14px 16px;
                display: grid;
                grid-template-columns: auto 1fr auto;
                gap: 12px;
                align-items: start;
                pointer-events: auto;
                transform: translateY(-8px) translateX(12px);
                opacity: 0;
                transition: transform 0.22s ease, opacity 0.22s ease;
                font-family: 'Montserrat', 'Segoe UI', sans-serif;
                backdrop-filter: blur(14px);
            }

            .elite-toast::before {
                content: "";
                position: absolute;
                left: 0;
                top: 0;
                bottom: 0;
                width: 5px;
                background: var(--toast-accent);
            }

            .elite-toast.show {
                transform: translateY(0) translateX(0);
                opacity: 1;
            }

            .elite-toast.hide {
                transform: translateY(-8px) translateX(12px);
                opacity: 0;
            }

            .elite-toast-icon {
                width: 40px;
                height: 40px;
                margin-left: 4px;
                border-radius: 14px;
                display: inline-grid;
                place-items: center;
                background: var(--toast-chip-bg);
                color: var(--toast-chip-color);
                font-size: 1.02rem;
                line-height: 1;
                box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.75);
            }

            .elite-toast-message {
                padding-top: 2px;
                font-size: 0.95rem;
                line-height: 1.45;
                font-weight: 600;
                display: flex;
                flex-direction: column;
                gap: 2px;
                }

            .elite-toast-title {
                font-size: 0.97rem;
                font-weight: 700;
                line-height: 1.3;
            }

            .elite-toast-body {
                font-size: 0.875rem;
                font-weight: 500;
                opacity: 0.82;
                line-height: 1.45;
            }

            .elite-toast-close {
                border: 1px solid rgba(17, 34, 17, 0.08);
                background: rgba(255, 255, 255, 0.7);
                color: inherit;
                width: 30px;
                height: 30px;
                border-radius: 10px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
            }

            .elite-toast-close:hover {
                background: rgba(255, 255, 255, 0.96);
            }

            @media (max-width: 640px) {
                #toast-container {
                    left: 10px !important;
                    right: 10px !important;
                    top: 10px !important;
                }

                .elite-toast {
                    width: 100%;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

const toast = new Toast();
window.toast = toast;

function notify(type, message, duration) {
    if (toast && typeof toast[type] === 'function') {
        toast[type](message, duration);
    } else if (toast && typeof toast.show === 'function') {
        toast.show(message, type, duration);
    }
}

function notifyRich(title, body, type = 'info', duration = 4800) {
    if (window.toast && typeof window.toast.showRich === 'function') {
        window.toast.showRich(title, body, type, duration);
        return;
    }
    if (window.toast && typeof window.toast[type] === 'function') {
        window.toast[type](`${title} - ${body}`, duration);
    }
}
