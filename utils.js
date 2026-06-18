/**
 * HBW Task - Shared Utilities Module
 * 
 * Responsibilities:
 * - HTML sanitization (escapeHtml)
 * - Toast notifications
 * - Modal management (open/close/confirm)
 * - Currency and date formatting
 * - Cache TTL helpers
 * - Debounce utility
 * - Badge/threshold computation
 * - Random credential generation
 * 
 * @module utils
 */

// ============================================================
// CONSTANTS
// ============================================================

export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const BADGE_THRESHOLDS = [
    { name: 'bronze', min: 0, label: 'Bronze', color: '#cd7f32', icon: 'fa-award' },
    { name: 'silver', min: 50, label: 'Argent', color: '#c0c0c0', icon: 'fa-medal' },
    { name: 'gold', min: 100, label: 'Or', color: '#ffd700', icon: 'fa-trophy' },
    { name: 'platinum', min: 200, label: 'Platine', color: '#e5e4e2', icon: 'fa-gem' },
    { name: 'diamond', min: 500, label: 'Diamant', color: '#b9f2ff', icon: 'fa-crown' }
];

// ============================================================
// HTML SANITIZATION
// ============================================================

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * 
 * FIXED: The original implementation replaced characters with themselves
 * (e.g., '&' → '&') which provided zero protection. This version uses
 * proper HTML entities.
 * 
 * @param {*} str - The string to escape
 * @returns {string} The escaped string safe for innerHTML insertion
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ============================================================
// FORMATTING
// ============================================================

/**
 * Formats a number as HTG currency.
 * 
 * @param {number|string} amount - The amount to format
 * @returns {string} Formatted string like "1 500 HTG"
 */
export function formatCurrency(amount) {
    const num = Number(amount) || 0;
    const formatted = num.toLocaleString('fr-FR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
    return `${formatted} HTG`;
}

/**
 * Formats a timestamp into relative and absolute date strings.
 * 
 * @param {object|string|number} ts - Firestore Timestamp, ISO string, or epoch ms
 * @returns {{ relative: string, absolute: string, full: string }}
 */
export function formatDate(ts) {
    if (!ts) return { relative: '—', absolute: '—', full: '—' };

    const date = ts.toDate ? ts.toDate() : new Date(ts);
    
    // Guard against invalid dates
    if (isNaN(date.getTime())) {
        return { relative: '—', absolute: '—', full: '—' };
    }

    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    let relative = '';
    if (diffMins < 1) relative = "à l'instant";
    else if (diffMins < 60) relative = `il y a ${diffMins} min`;
    else if (diffHours < 24) relative = `il y a ${diffHours} h`;
    else if (diffDays < 7) relative = `il y a ${diffDays} j`;
    else relative = date.toLocaleDateString('fr-FR');

    const absolute = date.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    return {
        relative,
        absolute,
        full: `${relative} • ${absolute}`
    };
}

// ============================================================
// DOM HELPERS
// ============================================================

/**
 * Sets the textContent of an element by ID safely.
 * 
 * @param {string} id - Element ID
 * @param {string} text - Text to set
 */
export function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

/**
 * Displays a toast notification.
 * 
 * @param {string} message - The message to display
 * @param {'success'|'error'|'warning'|'info'} type - Toast type
 * @param {number} duration - Auto-dismiss duration in ms (default: 3500)
 */
export function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const iconMap = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };

    const titleMap = {
        success: 'Succès',
        error: 'Erreur',
        warning: 'Attention',
        info: 'Information'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
        <div class="toast__icon">
            <i class="fas ${iconMap[type] || iconMap.info}"></i>
        </div>
        <div class="toast__content">
            <div class="toast__title">${escapeHtml(titleMap[type] || 'Info')}</div>
            <div class="toast__message">${escapeHtml(message)}</div>
        </div>
        <button class="toast__close" aria-label="Fermer">
            <i class="fas fa-times"></i>
        </button>
    `;

    container.appendChild(toast);

    const remove = () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 300);
    };

    const closeBtn = toast.querySelector('.toast__close');
    if (closeBtn) closeBtn.addEventListener('click', remove);

    setTimeout(remove, duration);
}

// ============================================================
// MODAL MANAGEMENT
// ============================================================

/**
 * Opens a modal by ID.
 * 
 * @param {string} modalId - The modal element ID
 */
export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

/**
 * Closes a specific modal or all open modals.
 * 
 * @param {string} [modalId] - Optional specific modal ID to close
 */
export function closeModal(modalId) {
    if (modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('open');
            modal.classList.add('hidden');
        }
    } else {
        document.querySelectorAll('.modal-backdrop.open').forEach(m => {
            m.classList.remove('open');
            m.classList.add('hidden');
        });
    }
    document.body.style.overflow = '';
}

/**
 * Shows a confirmation dialog using the global confirm modal.
 * 
 * FIXED: Properly removes the click handler after use to prevent
 * memory leaks and duplicate callbacks.
 * 
 * @param {string} title - Confirmation title
 * @param {string} message - Confirmation message
 * @param {Function} onConfirm - Callback executed on confirmation
 * @param {object} [options] - Optional overrides
 * @param {string} [options.confirmText] - Custom confirm button text
 * @param {string} [options.confirmClass] - Custom confirm button CSS class
 * @param {string} [options.iconClass] - Custom icon CSS classes
 */
export function showConfirm(title, message, onConfirm, options = {}) {
    const modal = document.getElementById('modal-confirm');
    if (!modal) {
        // Fallback to native confirm if modal doesn't exist
        if (confirm(`${title}\n\n${message}`)) onConfirm();
        return;
    }

    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const btnEl = document.getElementById('confirm-action-btn');
    const iconEl = document.getElementById('confirm-icon');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (btnEl) {
        btnEl.textContent = options.confirmText || 'Confirmer';
        btnEl.className = `btn ${options.confirmClass || 'btn-danger'}`;
    }
    if (iconEl) {
        const iconClass = options.iconClass || 'fa-exclamation-triangle text-yellow-600';
        iconEl.innerHTML = `<i class="fas ${iconClass} text-3xl"></i>`;
    }

    // Create a named handler so we can remove it later
    const handler = () => {
        closeModal('modal-confirm');
        btnEl.removeEventListener('click', handler);
        if (typeof onConfirm === 'function') onConfirm();
    };

    // Remove any previous handler to prevent duplicates
    const newBtn = btnEl.cloneNode(true);
    btnEl.parentNode.replaceChild(newBtn, btnEl);
    newBtn.addEventListener('click', handler);

    openModal('modal-confirm');
}

// ============================================================
// CACHE HELPERS
// ============================================================

/**
 * Checks if a cache object is still valid based on TTL.
 * 
 * @param {{ data: any, timestamp: number|null }} cache - Cache object
 * @returns {boolean} True if cache is valid
 */
export function isCacheValid(cache) {
    if (!cache || !cache.timestamp) return false;
    return (Date.now() - cache.timestamp) < CACHE_TTL;
}

/**
 * Invalidates a single cache object.
 * 
 * @param {{ data: any, timestamp: number|null }} cache - Cache object to invalidate
 */
export function invalidateCache(cache) {
    if (!cache) return;
    cache.timestamp = null;
    cache.data = Array.isArray(cache.data) ? [] : {};
}

// ============================================================
// DEBOUNCE
// ============================================================

/**
 * Creates a debounced version of a function.
 * 
 * @param {Function} fn - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(fn, delay = 300) {
    let timeoutId = null;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ============================================================
// BADGE / THRESHOLD COMPUTATION
// ============================================================

/**
 * Computes badge info based on completed tasks count.
 * 
 * @param {number} completedTasks - Number of completed tasks
 * @returns {{ current: object, next: object|null, progress: number, tasksToNext: number }}
 */
export function getBadgeInfo(completedTasks) {
    const count = Number(completedTasks) || 0;
    const levels = BADGE_THRESHOLDS;

    let current = levels[0];
    let next = levels[1] || null;

    for (let i = 0; i < levels.length; i++) {
        if (count >= levels[i].min) {
            current = levels[i];
            next = levels[i + 1] || null;
        }
    }

    const progress = next
        ? Math.min(100, ((count - current.min) / (next.min - current.min)) * 100)
        : 100;

    return {
        current,
        next,
        progress: Math.round(progress),
        tasksToNext: next ? Math.max(0, next.min - count) : 0
    };
}

// ============================================================
// CREDENTIAL GENERATION
// ============================================================

/**
 * Generates a random numeric password.
 * 
 * @param {number} length - Password length (default: 8)
 * @returns {string} Random numeric string
 */
export function generateRandomPassword(length = 8) {
    const chars = '1234567890';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

/**
 * Generates a username from a full name.
 * Strips accents, removes non-alphanumeric chars, truncates to 8 chars,
 * and appends a random 4-digit suffix.
 * 
 * @param {string} fullName - The user's full name
 * @returns {string} Generated username like "jeandup1234"
 */
export function generateUsername(fullName) {
    const base = fullName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .substring(0, 8);
    const suffix = Math.floor(Math.random() * 9000) + 1000;
    return `${base}${suffix}`;
}
