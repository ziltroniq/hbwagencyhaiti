/**
 * HBW Task - Application Entry Point (Bootstrap Only)
 * 
 * This file contains NO business logic. It only:
 * - Imports and initializes all modules
 * - Sets up routing/navigation
 * - Exposes minimal functions to window for static HTML onclick handlers
 * - Coordinates module initialization on DOMContentLoaded
 * 
 * @module app
 */

// ============================================================
// MODULE IMPORTS
// ============================================================

import { auth, db } from './firebase.js';
import {
    getCurrentUser,
    handleLogout,
    initAuthStateObserver,
    setupLoginForm,
    setupThemeToggle,
    toggleTheme,
    setupGlobalModals
} from './auth.js';
import {
    showToast,
    showConfirm,
    openModal,
    closeModal,
    formatCurrency,
    formatDate,
    escapeHtml
} from './utils.js';
import {
    renderAdminDashboard,
    loadAdminUsers,
    filterUsers,
    showUserDetail,
    toggleUserActive,
    adjustUserBalance,
    exportUsersCSV,
    loadAdminTeams,
    showCreateTeamModal,
    saveTeam,
    deleteTeam,
    loadAdminTasks,
    switchTaskTab,
    showCreateTaskModal,
    createTask,
    validateTask,
    rejectTask,
    deleteTask,
    loadAdminWithdrawals,
    approveWithdrawal,
    rejectWithdrawal,
    loadAdminSettings,
    saveExchangeRate,
    saveMaintenanceFee,
    savePaymentNumbers,
    savePremiumPrices,
    createManagerAccount,
    calculateDailyCommissions,
    loadValidationPage,
    approveProof,
    rejectProof,
    renderManagerDashboard,
    loadManagerMembers,
    showMemberActionsMenu,
    showMemberDetailModal,
    showMemberCredentialsModal,
    toggleMemberStatus,
    confirmRemoveMember,
    showAddMemberModal,
    showManagerMessagesPage,
    sendTeamMessage,
    loadManagerStats,
    showManagerWithdrawalPage,
    selectManagerMethod,
    requestManagerWithdrawal,
    loadLeaderboard,
    renderWorkerDashboard,
    loadWorkerTasks,
    filterWorkerTasksByCategory,
    acceptTask,
    openTaskProofModal,
    submitTaskProof,
    loadWorkerHistory,
    setHistoryFilter,
    loadWorkerWithdrawal,
    selectMethod,
    updateWithdrawalSummary,
    setWithdrawalAmount,
    requestWithdrawal,
    loadMyWithdrawals,
    loadPremiumPage,
    selectPremiumPlan,
    startPremiumTrial,
    submitPremiumProof,
    showPlanLimitsModal,
    loadOfferwall,
    loadAgencyTasks,
    loadProfile,
    saveProfile,
    setupUploadZone,
    toggleNotifDropdown,
    markNotifRead,
    markAllRead,
    showWorkerNotifications,
    cancelUpload,
    generateRandomPassword
} from './dashboard.js';

// ============================================================
// NAVIGATION CONFIGURATION
// ============================================================

const NAV_CONFIG = {
    'page-admin-dashboard': { title: 'Tableau de bord', subtitle: 'Vue d\'ensemble de la plateforme', icon: 'fa-chart-line', roles: ['admin'], inSidebar: true, inBottom: false, group: 'Principal' },
    'page-users-management': { title: 'Utilisateurs', subtitle: 'Gestion des comptes', icon: 'fa-users', roles: ['admin'], inSidebar: true, inBottom: false, group: 'Administration' },
    'page-teams-management': { title: 'Équipes', subtitle: 'Gestion des équipes', icon: 'fa-people-group', roles: ['admin'], inSidebar: true, inBottom: false, group: 'Administration' },
    'page-tasks-management': { title: 'Tâches', subtitle: 'Gestion des tâches', icon: 'fa-list-check', roles: ['admin'], inSidebar: true, inBottom: false, group: 'Administration' },
    'page-validation': { title: 'Validation', subtitle: 'Validation des preuves', icon: 'fa-check-double', roles: ['admin'], inSidebar: true, inBottom: false, group: 'Administration' },
    'page-payments': { title: 'Paiements', subtitle: 'Retraits & paiements', icon: 'fa-money-bill-transfer', roles: ['admin'], inSidebar: true, inBottom: false, group: 'Administration' },
    'page-settings': { title: 'Paramètres', subtitle: 'Configuration globale', icon: 'fa-gear', roles: ['admin'], inSidebar: true, inBottom: false, group: 'Système' },
    'page-manager-dashboard': { title: 'Tableau de bord', subtitle: 'Gestion de votre équipe', icon: 'fa-chart-pie', roles: ['manager'], inSidebar: true, inBottom: true, bottomIcon: 'fa-home', bottomLabel: 'Accueil', group: 'Principal' },
    'page-worker-dashboard': { title: 'Tableau de bord', subtitle: 'Vos tâches et revenus', icon: 'fa-gauge-high', roles: ['worker', 'manager'], inSidebar: true, inBottom: true, bottomIcon: 'fa-home', bottomLabel: 'Accueil', group: 'Principal' },
    'page-offerwall-monlix': { title: 'Monlix', subtitle: 'Offres Monlix', icon: 'fa-gift', roles: ['worker', 'manager'], inSidebar: true, inBottom: false, group: 'Offerwalls' },
    'page-offerwall-adscend': { title: 'Adscend', subtitle: 'Offres Adscend', icon: 'fa-star', roles: ['worker', 'manager'], inSidebar: true, inBottom: false, group: 'Offerwalls' },
    'page-offerwall-ayetstudios': { title: 'AyetStudios', subtitle: 'Offres AyetStudios', icon: 'fa-gamepad', roles: ['worker', 'manager'], inSidebar: true, inBottom: false, group: 'Offerwalls' },
    'page-offerwall-lootably': { title: 'Lootably', subtitle: 'Offres Lootably', icon: 'fa-box-open', roles: ['worker', 'manager'], inSidebar: true, inBottom: false, group: 'Offerwalls' },
    'page-agency-tasks': { title: 'Tâches Agency', subtitle: 'Tâches premium', icon: 'fa-briefcase', roles: ['worker', 'manager'], inSidebar: true, inBottom: false, group: 'Tâches' },
    'page-wallet': { title: 'Portefeuille', subtitle: 'Solde et retraits', icon: 'fa-wallet', roles: ['worker', 'manager'], inSidebar: true, inBottom: true, bottomIcon: 'fa-wallet', bottomLabel: 'Wallet', group: 'Finances' },
    'page-profile': { title: 'Profil', subtitle: 'Informations personnelles', icon: 'fa-user-circle', roles: ['worker', 'manager'], inSidebar: true, inBottom: false, group: 'Compte' },
    'page-premium': { title: 'Premium', subtitle: 'Abonnement premium', icon: 'fa-crown', roles: ['worker', 'manager'], inSidebar: true, inBottom: false, group: 'Compte' },
    'page-leaderboard': { title: 'Classement', subtitle: 'Top performers', icon: 'fa-ranking-star', roles: ['worker', 'manager'], inSidebar: true, inBottom: true, bottomIcon: 'fa-trophy', bottomLabel: 'Classement', group: 'Social' }
};

const BOTTOM_BAR_CONFIG = {
    worker: [
        { page: 'page-worker-dashboard', icon: 'fa-home', label: 'Accueil' },
        { page: 'page-wallet', icon: 'fa-wallet', label: 'Wallet' },
        { page: 'page-leaderboard', icon: 'fa-trophy', label: 'Top' },
        { page: 'page-profile', icon: 'fa-user', label: 'Profil' }
    ],
    manager: [
        { page: 'page-manager-dashboard', icon: 'fa-home', label: 'Accueil' },
        { page: 'page-worker-dashboard', icon: 'fa-tasks', label: 'Tâches' },
        { page: 'page-wallet', icon: 'fa-wallet', label: 'Wallet' },
        { page: 'page-leaderboard', icon: 'fa-trophy', label: 'Top' }
    ]
};

// Page loaders map — delegates to dashboard.js functions
const PAGE_LOADERS = {
    'page-admin-dashboard': () => renderAdminDashboard(),
    'page-users-management': () => loadAdminUsers(),
    'page-teams-management': () => loadAdminTeams(),
    'page-tasks-management': () => loadAdminTasks(),
    'page-validation': () => loadValidationPage(),
    'page-payments': () => loadAdminWithdrawals(),
    'page-settings': () => loadAdminSettings(),
    'page-manager-dashboard': () => renderManagerDashboard(),
    'page-worker-dashboard': () => renderWorkerDashboard(),
    'page-offerwall-monlix': () => loadOfferwall('monlix'),
    'page-offerwall-adscend': () => loadOfferwall('adscend'),
    'page-offerwall-ayetstudios': () => loadOfferwall('ayetstudios'),
    'page-offerwall-lootably': () => loadOfferwall('lootably'),
    'page-agency-tasks': () => loadAgencyTasks(),
    'page-wallet': () => loadWorkerWithdrawal(),
    'page-profile': () => loadProfile(),
    'page-premium': () => loadPremiumPage(),
    'page-leaderboard': () => loadLeaderboard()
};

// ============================================================
// ROUTING
// ============================================================

/**
 * Navigates to a page by ID.
 * Handles permissions, UI updates, sidebar/bottom-bar state, and content loading.
 * Exposed globally for static HTML onclick handlers.
 */
function navigateTo(pageId, options = {}) {
    const config = NAV_CONFIG[pageId];
    if (!config) {
        console.warn(`[Router] Unknown page: ${pageId}`);
        return;
    }

    const currentUser = getCurrentUser();

    // Permission check
    if (currentUser && !config.roles.includes(currentUser.role)) {
        showToast('Accès refusé', 'error');
        return;
    }

    // Hide all pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.add('hidden');
        p.classList.remove('active');
    });

    // Show target page
    const page = document.getElementById(pageId);
    if (page) {
        page.classList.remove('hidden');
        page.classList.add('active');
    }

    // Update topbar title
    const titleEl = document.querySelector('[data-page-title]');
    const subtitleEl = document.querySelector('[data-page-subtitle]');
    if (titleEl) titleEl.textContent = config.title;
    if (subtitleEl) subtitleEl.textContent = config.subtitle;

    // Update sidebar active state
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-page') === pageId) {
            link.classList.add('active');
        }
    });

    // Update bottom bar active state
    document.querySelectorAll('.bottom-bar__item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-page') === pageId) {
            item.classList.add('active');
        }
    });

    // Bottom bar visibility
    const bottomBar = document.getElementById('bottom-bar');
    if (bottomBar) {
        if (currentUser && (currentUser.role === 'admin' || pageId === 'page-login')) {
            bottomBar.classList.add('hidden');
        } else {
            bottomBar.classList.remove('hidden');
        }
    }

    // Scroll to top
    if (!options.preserveScroll) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Close mobile sidebar
    closeSidebarMobile();

    // Load page content via delegated loader
    const loader = PAGE_LOADERS[pageId];
    if (typeof loader === 'function') {
        try {
            loader();
        } catch (e) {
            console.error(`[Router] Error loading ${pageId}:`, e);
        }
    }
}

// ============================================================
// SIDEBAR & BOTTOM BAR BUILDERS
// ============================================================

/**
 * Builds the sidebar navigation for a given role.
 */
function buildSidebar(role) {
    const sidebar = document.querySelector('[data-sidebar]');
    const drawer = document.getElementById('hbw-sidebar-drawer');
    if (!sidebar) return;

    const navContainer = sidebar.querySelector('#sidebar-nav') || sidebar.querySelector('.sidebar__nav');
    if (!navContainer) return;

    // Group nav items
    const groups = {};
    Object.entries(NAV_CONFIG).forEach(([pageId, cfg]) => {
        if (!cfg.inSidebar || !cfg.roles.includes(role)) return;
        const group = cfg.group || 'Autre';
        if (!groups[group]) groups[group] = [];
        groups[group].push({ pageId, ...cfg });
    });

    let html = '';
    Object.entries(groups).forEach(([groupName, items]) => {
        html += `<div class="sidebar__nav-group">
            <div class="sidebar__nav-group-title">${escapeHtml(groupName)}</div>`;
        items.forEach(item => {
            html += `<a href="#" class="sidebar-link" data-page="${item.pageId}">
                <i class="fas ${item.icon}"></i>
                <span>${escapeHtml(item.title)}</span>
            </a>`;
        });
        html += `</div>`;
    });

    navContainer.innerHTML = html;

    // Attach click events via addEventListener (no inline onclick)
    navContainer.querySelectorAll('[data-page]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(link.getAttribute('data-page'));
        });
    });

    // Clone into mobile drawer
    if (drawer) {
        drawer.innerHTML = sidebar.innerHTML;
        drawer.querySelectorAll('[data-page]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                navigateTo(link.getAttribute('data-page'));
                closeSidebarMobile();
            });
        });
    }
}

/**
 * Builds the bottom navigation bar for a given role.
 */
function buildBottomBar(role) {
    const bottomBar = document.getElementById('bottom-bar');
    if (!bottomBar) return;

    const inner = bottomBar.querySelector('#bottom-bar-inner');
    if (!inner) return;

    const items = BOTTOM_BAR_CONFIG[role] || [];
    let html = '';
    items.forEach(item => {
        html += `<a href="#" class="bottom-bar__item" data-page="${item.page}">
            <i class="fas ${item.icon}"></i>
            <span>${escapeHtml(item.label)}</span>
        </a>`;
    });
    inner.innerHTML = html;

    // Attach click events via addEventListener (no inline onclick)
    inner.querySelectorAll('[data-page]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(link.getAttribute('data-page'));
        });
    });
}

/**
 * Initializes sidebar and bottom bar for the current user role.
 */
function initNavigation(role) {
    buildSidebar(role);
    buildBottomBar(role);

    const toggleBtn = document.getElementById('btn-toggle-sidebar');
    if (toggleBtn) {
        toggleBtn.onclick = toggleSidebar;
    }

    const overlay = document.getElementById('hbw-sidebar-overlay');
    if (overlay) {
        overlay.addEventListener('click', closeSidebarMobile);
    }

    const closeBtn = document.getElementById('btn-close-sidebar-mobile');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeSidebarMobile);
    }
}

// ============================================================
// SIDEBAR TOGGLE HELPERS
// ============================================================

function toggleSidebar() {
    if (window.innerWidth <= 768) {
        const overlay = document.getElementById('hbw-sidebar-overlay');
        const drawer = document.getElementById('hbw-sidebar-drawer');
        if (overlay && drawer) {
            overlay.style.display = 'block';
            drawer.style.display = 'block';
            setTimeout(() => {
                overlay.classList.add('active');
                drawer.classList.add('active');
            }, 10);
        }
    }
}

function closeSidebarMobile() {
    const overlay = document.getElementById('hbw-sidebar-overlay');
    const drawer = document.getElementById('hbw-sidebar-drawer');
    if (overlay && drawer) {
        overlay.classList.remove('active');
        drawer.classList.remove('active');
        setTimeout(() => {
            overlay.style.display = 'none';
            drawer.style.display = 'none';
        }, 300);
    }
}

// ============================================================
// DROPDOWN CLOSE ON OUTSIDE CLICK
// ============================================================

document.addEventListener('click', (e) => {
    // Close notification dropdown
    if (!e.target.closest('.notification-bell')) {
        const notifDrop = document.getElementById('notif-dropdown');
        if (notifDrop && !notifDrop.classList.contains('hidden')) {
            notifDrop.classList.add('hidden');
            notifDrop.style.display = 'none';
        }
    }

    // Close user dropdown
    if (!e.target.closest('.topbar__user-menu')) {
        const userDrop = document.getElementById('user-dropdown');
        if (userDrop && !userDrop.classList.contains('hidden')) {
            userDrop.classList.add('hidden');
            userDrop.style.display = 'none';
        }
    }
});

// ============================================================
// GLOBAL WINDOW EXPOSURE (Minimal — static HTML onclick only)
// ============================================================

const globalsToExpose = {
    // Navigation
    navigateTo,
    handleLogout,
    toggleSidebar,
    closeSidebarMobile,
    toggleTheme,

    // Modals
    openModal,
    closeModal,

    // Notifications
    toggleNotifDropdown,
    markNotifRead,
    markAllRead,
    showWorkerNotifications,

    // Upload
    cancelUpload,

    // Admin
    renderAdminDashboard,
    loadAdminUsers,
    filterUsers,
    showUserDetail,
    toggleUserActive,
    adjustUserBalance,
    exportUsersCSV,
    loadAdminTeams,
    showCreateTeamModal,
    saveTeam,
    deleteTeam,
    loadAdminTasks,
    switchTaskTab,
    showCreateTaskModal,
    createTask,
    validateTask,
    rejectTask,
    deleteTask,
    loadAdminWithdrawals,
    approveWithdrawal,
    rejectWithdrawal,
    loadAdminSettings,
    saveExchangeRate,
    saveMaintenanceFee,
    savePaymentNumbers,
    savePremiumPrices,
    createManagerAccount,
    calculateDailyCommissions,
    loadValidationPage,
    approveProof,
    rejectProof,

    // Worker
    renderWorkerDashboard,
    loadWorkerTasks,
    filterWorkerTasksByCategory,
    acceptTask,
    openTaskProofModal,
    submitTaskProof,
    loadWorkerHistory,
    setHistoryFilter,
    loadWorkerWithdrawal,
    selectMethod,
    updateWithdrawalSummary,
    setWithdrawalAmount,
    requestWithdrawal,
    loadMyWithdrawals,
    loadPremiumPage,
    selectPremiumPlan,
    startPremiumTrial,
    submitPremiumProof,
    showPlanLimitsModal,
    loadOfferwall,
    loadAgencyTasks,
    loadProfile,
    saveProfile,

    // Manager
    renderManagerDashboard,
    loadManagerMembers,
    showMemberActionsMenu,
    showMemberDetailModal,
    showMemberCredentialsModal,
    toggleMemberStatus,
    confirmRemoveMember,
    showAddMemberModal,
    showManagerMessagesPage,
    sendTeamMessage,
    loadManagerStats,
    showManagerWithdrawalPage,
    selectManagerMethod,
    requestManagerWithdrawal,
    loadLeaderboard,
    generateRandomPassword
};

Object.keys(globalsToExpose).forEach(name => {
    if (typeof globalsToExpose[name] === 'function') {
        window[name] = globalsToExpose[name];
    }
});

// ============================================================
// INITIALIZATION
// ============================================================

function initApp() {
    try {
        setupLoginForm();
        setupGlobalModals();
        setupThemeToggle();
        initAuthStateObserver();

        // Setup upload zones for any existing dropzones
        setupUploadZone('.border-dashed.dropzone');

        // Observe DOM mutations for dynamically added dropzones
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    if (node.classList && node.classList.contains('dropzone')) {
                        setupUploadZone('.dropzone');
                    }
                    if (node.querySelectorAll) {
                        const zones = node.querySelectorAll('.dropzone');
                        if (zones.length) setupUploadZone('.dropzone');
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Signal readiness (for splash screen fallback)
        if (window.__hbwAppReady) window.__hbwAppReady();

        console.log('✅ HBW Task initialized successfully (modular architecture)');
    } catch (e) {
        console.error('❌ Initialization error:', e);
    }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// Debug exposure
window.HBWApp = {
    state: {
        getCurrentUser,
    },
    utils: {
        showToast,
        showConfirm,
        formatCurrency,
        formatDate
    },
    db: {
        auth,
        firestore: db
    }
};
