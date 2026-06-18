/**
 * HBW Task - Authentication Module
 * 
 * Responsibilities:
 * - Login by email OR username (no domain guessing)
 * - Auth state observer with profile loading
 * - Session lifecycle management (.page-login-active)
 * - Logout with full cleanup
 * - Premium expiry checking
 * - Theme toggle persistence
 * - Login form setup
 * 
 * @module auth
 */

import { auth, db, signInUser } from './firebase.js';
import { showToast, showConfirm, escapeHtml } from './utils.js';
import { navigateTo } from './app.js';

// ============================================================
// MODULE STATE
// ============================================================

let currentUser = null;
let currentRole = null;

// Expose currentUser getter for other modules
export function getCurrentUser() {
    return currentUser;
}

export function getCurrentRole() {
    return currentRole;
}

// ============================================================
// LOGIN
// ============================================================

/**
 * Handles user login by email OR username.
 * 
 * FIXED: No more domain guessing (@hbwtask.com / @taskpam.com).
 * - If input contains '@' → direct email lookup via Firebase Auth
 * - Otherwise → search Firestore users collection by username field,
 *   then authenticate with the found email
 * 
 * @param {string} identifier - Email or username
 * @param {string} password - User password
 */
export async function handleLogin(identifier, password) {
    if (!identifier || !password) {
        showLoginError('Veuillez remplir tous les champs.');
        return;
    }

    hideLoginError();

    // Disable submit button during login
    const submitBtn = document.getElementById('login-submit-btn');
    const btnText = submitBtn?.querySelector('.btn-text');
    const btnLoader = submitBtn?.querySelector('.btn-loader');

    if (submitBtn) {
        submitBtn.disabled = true;
        if (btnText) btnText.classList.add('hidden');
        if (btnLoader) btnLoader.classList.remove('hidden');
    }

    try {
        const trimmedId = identifier.trim();
        let emailToUse = null;

        if (trimmedId.includes('@')) {
            // Direct email authentication
            emailToUse = trimmedId.toLowerCase();
        } else {
            // Username authentication: look up email in Firestore
            const usernameLower = trimmedId.toLowerCase();
            const userQuery = await db.collection('users')
                .where('username', '==', usernameLower)
                .limit(1)
                .get();

            if (userQuery.empty) {
                showLoginError('Aucun compte trouvé avec ce nom d\'utilisateur.');
                return;
            }

            const userData = userQuery.docs[0].data();
            emailToUse = userData.email;

            if (!emailToUse) {
                showLoginError('Erreur : aucune adresse email associée à ce compte.');
                return;
            }
        }

        // Authenticate with Firebase Auth
        await signInUser(emailToUse, password);
        showToast('Connexion réussie !', 'success');

    } catch (error) {
        console.error('Login error:', error);
        showLoginError(error.message || 'Erreur de connexion. Veuillez réessayer.');
    } finally {
        // Re-enable submit button
        if (submitBtn) {
            submitBtn.disabled = false;
            if (btnText) btnText.classList.remove('hidden');
            if (btnLoader) btnLoader.classList.add('hidden');
        }
    }
}

// ============================================================
// LOGOUT
// ============================================================

/**
 * Signs out the current user and resets all UI state.
 * Exposed on window for static HTML onclick handlers.
 */
export async function handleLogout() {
    try {
        await auth.signOut();
        currentUser = null;
        currentRole = null;

        // Hide app shell, show login
        const app = document.getElementById('app');
        if (app) app.style.display = 'none';

        showLoginPage();
        showToast('Déconnexion réussie.', 'info');
    } catch (error) {
        console.error('Logout error:', error);
        showToast('Erreur lors de la déconnexion.', 'error');
    }
}

// ============================================================
// AUTH STATE OBSERVER
// ============================================================

/**
 * Initializes the Firebase auth state listener.
 * On authenticated: loads Firestore profile, checks status, shows app.
 * On unauthenticated: shows login page.
 */
export function initAuthStateObserver() {
    auth.onAuthStateChanged(async (firebaseUser) => {
        hideSplash();

        if (firebaseUser) {
            try {
                const userDoc = await db.collection('users').doc(firebaseUser.uid).get();

                if (!userDoc.exists) {
                    // Authenticated but no Firestore profile — sign out
                    console.warn('User authenticated but no Firestore profile found. Signing out.');
                    await auth.signOut();
                    showLoginPage();
                    return;
                }

                let userData = userDoc.data();
                userData.id = userDoc.id;

                // Check premium expiry
                userData = checkAndUpdatePremiumExpiry(userData);

                // Check account status
                if (userData.status === 'suspended' || userData.status === 'banned') {
                    await auth.signOut();
                    showLoginPage();
                    showToast('Votre compte a été suspendu. Contactez le support.', 'error');
                    return;
                }

                // Set module state
                currentUser = userData;
                currentRole = userData.role || 'worker';

                // Update lastSeen (fire-and-forget)
                db.collection('users').doc(firebaseUser.uid).update({
                    lastSeen: new Date()
                }).catch(() => {});

                // Show app with correct role
                showApp(currentRole);

            } catch (error) {
                console.error('Error loading user profile:', error);
                showToast('Erreur de chargement du profil.', 'error');
                showLoginPage();
            }
        } else {
            currentUser = null;
            currentRole = null;
            showLoginPage();
        }
    });
}

// ============================================================
// PREMIUM EXPIRY CHECK
// ============================================================

/**
 * Checks if premium subscription has expired and downgrades if needed.
 * 
 * @param {object} userDoc - User document data
 * @returns {object} Updated user document
 */
function checkAndUpdatePremiumExpiry(userDoc) {
    if (!userDoc || !userDoc.premiumExpiresAt) return userDoc;

    const expiry = userDoc.premiumExpiresAt.toDate
        ? userDoc.premiumExpiresAt.toDate()
        : new Date(userDoc.premiumExpiresAt);

    if (expiry < new Date()) {
        userDoc.isPremium = false;
        userDoc.plan = 'free';

        // Persist the downgrade (fire-and-forget)
        if (currentUser && currentUser.id === userDoc.id) {
            db.collection('users').doc(userDoc.id).update({
                isPremium: false,
                plan: 'free',
                premiumExpiresAt: null
            }).catch(() => {});
        }
    }

    return userDoc;
}

// ============================================================
// UI STATE MANAGEMENT
// ============================================================

/**
 * Shows the login page and hides the app shell.
 * Adds .page-login-active to body to hide sidebar/topbar/bottom-bar via CSS.
 */
function showLoginPage() {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.add('hidden');
        p.classList.remove('active');
    });

    // Show login page
    const loginPage = document.getElementById('page-login');
    if (loginPage) {
        loginPage.classList.remove('hidden');
        loginPage.classList.add('active');
    }

    // Show app container (login is inside it)
    const app = document.getElementById('app');
    if (app) app.style.display = 'flex';

    // Add class to hide sidebar/topbar/bottom-bar
    document.body.classList.add('page-login-active');
}

/**
 * Shows the main app after successful authentication.
 * Removes .page-login-active and initializes navigation for the user's role.
 * 
 * @param {string} role - User role (admin, manager, worker)
 */
function showApp(role) {
    // Remove login-only class to reveal sidebar/topbar
    document.body.classList.remove('page-login-active');

    // Hide login page
    const loginPage = document.getElementById('page-login');
    if (loginPage) loginPage.classList.add('hidden');

    // Show app
    const app = document.getElementById('app');
    if (app) app.style.display = 'flex';

    // Navigate to default dashboard based on role
    let defaultPage = 'page-worker-dashboard';
    if (role === 'admin') defaultPage = 'page-admin-dashboard';
    else if (role === 'manager') defaultPage = 'page-manager-dashboard';

    navigateTo(defaultPage);
    updateHeaderUser();
}

/**
 * Updates all header/sidebar elements with current user data.
 */
function updateHeaderUser() {
    if (!currentUser) return;

    const name = currentUser.fullName || currentUser.username || 'Utilisateur';
    const role = currentUser.role || 'worker';
    const balance = currentUser.balance || 0;
    const isPremium = currentUser.isPremium || false;

    // Update all [data-user-name] elements
    document.querySelectorAll('[data-user-name]').forEach(el => {
        el.textContent = name;
    });

    // Update all [data-user-role] elements
    document.querySelectorAll('[data-user-role]').forEach(el => {
        el.textContent = role.charAt(0).toUpperCase() + role.slice(1);
    });

    // Update all [data-user-balance] elements
    document.querySelectorAll('[data-user-balance]').forEach(el => {
        el.textContent = `${balance.toLocaleString('fr-FR')} HTG`;
    });

    // Update premium badges
    document.querySelectorAll('[data-user-premium]').forEach(el => {
        el.style.display = isPremium ? 'flex' : 'none';
    });

    // Update welcome message
    const welcomeEl = document.querySelector('[data-welcome-message]');
    if (welcomeEl) {
        const hour = new Date().getHours();
        let greeting = 'Bonsoir';
        if (hour < 12) greeting = 'Bonjour';
        else if (hour < 18) greeting = 'Bon après-midi';
        welcomeEl.textContent = `${greeting}, ${name} !`;
    }
}

// ============================================================
// SPLASH SCREEN
// ============================================================

/**
 * Hides the splash screen with a fade-out animation.
 */
function hideSplash() {
    const splash = document.getElementById('hbw-splash');
    if (splash) {
        splash.style.opacity = '0';
        setTimeout(() => {
            splash.style.display = 'none';
        }, 500);
    }
}

// ============================================================
// LOGIN FORM HELPERS
// ============================================================

/**
 * Shows an error message above the login form.
 * @param {string} message - Error message to display
 */
function showLoginError(message) {
    hideLoginError();
    const form = document.getElementById('login-form');
    if (!form) return;

    const errDiv = document.createElement('div');
    errDiv.id = 'login-error-message';
    errDiv.className = 'login-error';
    errDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i><span>${escapeHtml(message)}</span>`;
    form.prepend(errDiv);
}

/**
 * Removes the login error message if present.
 */
function hideLoginError() {
    const err = document.getElementById('login-error-message');
    if (err) err.remove();
}

/**
 * Toggles password visibility on a given input.
 * Exposed on window for static HTML onclick handlers.
 * 
 * @param {string} inputId - ID of the password input
 * @param {HTMLElement} iconEl - The eye icon element to toggle
 */
export function togglePassword(inputId, iconEl) {
    const input = document.getElementById(inputId);
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        if (iconEl) {
            iconEl.classList.remove('fa-eye');
            iconEl.classList.add('fa-eye-slash');
        }
    } else {
        input.type = 'password';
        if (iconEl) {
            iconEl.classList.remove('fa-eye-slash');
            iconEl.classList.add('fa-eye');
        }
    }
}

/**
 * Sets up the login form event listeners.
 * Called once during app initialization.
 */
export function setupLoginForm() {
    const form = document.getElementById('login-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username')?.value?.trim() || '';
        const password = document.getElementById('login-password')?.value || '';
        handleLogin(username, password);
    });
}

// ============================================================
// THEME TOGGLE
// ============================================================

/**
 * Initializes theme from localStorage and sets up toggle button.
 */
export function setupThemeToggle() {
    const savedTheme = localStorage.getItem('hbw_theme') || 'light';
    applyTheme(savedTheme);
}

/**
 * Applies a theme (light/dark) to the document.
 * @param {string} theme - 'light' or 'dark'
 */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    if (theme === 'dark') {
        document.body.classList.add('dark');
    } else {
        document.body.classList.remove('dark');
    }

    const btn = document.getElementById('btn-theme-toggle');
    if (btn) {
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
    }

    localStorage.setItem('hbw_theme', theme);
}

/**
 * Toggles between light and dark themes.
 * Exposed on window for static HTML onclick handlers.
 */
export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
}

// ============================================================
// GLOBAL MODAL SETUP
// ============================================================

/**
 * Sets up global modal close handlers (backdrop click + Escape key).
 */
export function setupGlobalModals() {
    document.addEventListener('click', (e) => {
        // Close on [data-close-modal] click
        const closeBtn = e.target.closest('[data-close-modal]');
        if (closeBtn) {
            const modal = closeBtn.closest('.modal-backdrop');
            if (modal) {
                const { closeModal } = await import('./utils.js');
                closeModal(modal.id);
            }
        }

        // Close on backdrop click
        if (e.target.classList.contains('modal-backdrop')) {
            const { closeModal } = await import('./utils.js');
            closeModal(e.target.id);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            import('./utils.js').then(({ closeModal }) => closeModal());
        }
    });
}

// ============================================================
// WINDOW EXPOSURE (for static HTML onclick handlers only)
// ============================================================

// These functions are called from static HTML attributes.
// All dynamic HTML should use addEventListener instead.
window.handleLogout = handleLogout;
window.togglePassword = togglePassword;
window.toggleTheme = toggleTheme;
