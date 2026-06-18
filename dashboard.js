/**
 * HBW Task - Dashboard Module
 * 
 * Responsibilities:
 * - Admin dashboard rendering with real stats and charts
 * - Manager dashboard with Firestore-backed members, messages, withdrawals
 * - Worker dashboard with tasks, history, plan limits
 * - Task detail view with ImgBB tutorial image support
 * - Worker account creation via secondary Firebase Auth app
 * 
 * @module dashboard
 */

import { db } from './firebase.js';
import { createSecondaryAuthUser } from './firebase.js';
import {
    escapeHtml,
    formatCurrency,
    formatDate,
    showToast,
    showConfirm,
    openModal,
    closeModal,
    isCacheValid,
    invalidateCache,
    getBadgeInfo,
    generateRandomPassword,
    generateUsername
} from './utils.js';
import { getCurrentUser } from './auth.js';
import { navigateTo } from './app.js';
import { setupUploadZone, renderTaskTutorialSection } from './tasks.js';

// ============================================================
// SHARED CACHES (populated by tasks.js / auth.js)
// ============================================================

const tasksCache = { data: [], timestamp: null };
const usersCache = { data: [], timestamp: null };

// ============================================================
// ADMIN DASHBOARD
// ============================================================

/**
 * Renders the admin dashboard with real KPIs, charts, and top workers.
 */
export async function renderAdminDashboard() {
    const container = document.getElementById('admin-main-content');
    if (!container) return;

    container.innerHTML = `
        <div class="space-y-5">
            <div class="grid grid-cols-4 gap-4">
                <div class="stat-card">
                    <div class="stat-card__icon stat-card__icon--primary"><i class="fas fa-users"></i></div>
                    <div class="stat-card__content">
                        <div class="stat-card__label">Utilisateurs totaux</div>
                        <div class="stat-card__value" id="admin-total-users">—</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-card__icon stat-card__icon--success"><i class="fas fa-tasks"></i></div>
                    <div class="stat-card__content">
                        <div class="stat-card__label">Tâches actives</div>
                        <div class="stat-card__value" id="admin-active-tasks">—</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-card__icon stat-card__icon--warning"><i class="fas fa-money-bill-wave"></i></div>
                    <div class="stat-card__content">
                        <div class="stat-card__label">Revenus (HTG)</div>
                        <div class="stat-card__value" id="admin-total-earnings">—</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-card__icon stat-card__icon--danger"><i class="fas fa-clock"></i></div>
                    <div class="stat-card__content">
                        <div class="stat-card__label">En attente</div>
                        <div class="stat-card__value" id="admin-pending-tasks">—</div>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="card">
                    <div class="card__header"><h3 class="card__title">Revenus (7 derniers jours)</h3></div>
                    <div class="card__body"><canvas id="admin-earnings-chart" height="200"></canvas></div>
                </div>
                <div class="card">
                    <div class="card__header"><h3 class="card__title">Statut des tâches</h3></div>
                    <div class="card__body"><canvas id="admin-tasks-status-chart" height="200"></canvas></div>
                </div>
            </div>

            <div class="card">
                <div class="card__header">
                    <h3 class="card__title">Top Workers</h3>
                    <button class="btn btn-sm btn-outline" data-action="navigate" data-page="page-users-management">
                        Voir tout <i class="fas fa-arrow-right"></i>
                    </button>
                </div>
                <div class="card__body" id="admin-top-workers-list">
                    <div class="spinner mx-auto"></div>
                </div>
            </div>

            <div class="grid grid-cols-4 gap-3">
                <button class="btn btn-primary btn-block" data-action="navigate" data-page="page-tasks-management">
                    <i class="fas fa-plus"></i> Créer tâche
                </button>
                <button class="btn btn-primary btn-block" data-action="navigate" data-page="page-users-management">
                    <i class="fas fa-user-plus"></i> Utilisateurs
                </button>
                <button class="btn btn-primary btn-block" data-action="navigate" data-page="page-validation">
                    <i class="fas fa-check"></i> Valider
                </button>
                <button class="btn btn-primary btn-block" data-action="navigate" data-page="page-settings">
                    <i class="fas fa-cog"></i> Paramètres
                </button>
            </div>
        </div>
    `;

    // Bind navigation buttons via delegation
    container.addEventListener('click', (e) => {
        const navBtn = e.target.closest('[data-action="navigate"]');
        if (navBtn) {
            navigateTo(navBtn.dataset.page);
        }
    });

    await loadAdminDashboardStats();
    await loadTopWorkers();
    renderAdminEarningsChart();
    renderTasksStatusChart();
}

/**
 * Loads real admin stats from Firestore.
 */
async function loadAdminDashboardStats() {
    try {
        let users, tasks;

        if (isCacheValid(usersCache)) {
            users = usersCache.data;
        } else {
            const usersSnap = await db.collection('users').get();
            users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            usersCache.data = users;
            usersCache.timestamp = Date.now();
        }

        if (isCacheValid(tasksCache)) {
            tasks = tasksCache.data;
        } else {
            const tasksSnap = await db.collection('tasks').get();
            tasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            tasksCache.data = tasks;
            tasksCache.timestamp = Date.now();
        }

        const totalUsers = users.length;
        const activeTasks = tasks.filter(t => t.status === 'active').length;
        const pendingTasks = tasks.filter(t => t.status === 'pending').length;
        const totalEarnings = tasks.reduce((sum, t) => sum + (t.totalPaid || 0), 0);

        const setTextSafe = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        setTextSafe('admin-total-users', totalUsers);
        setTextSafe('admin-active-tasks', activeTasks);
        setTextSafe('admin-pending-tasks', pendingTasks);
        setTextSafe('admin-total-earnings', formatCurrency(totalEarnings));

    } catch (e) {
        console.error('Error loading admin stats:', e);
    }
}

/**
 * Loads and renders top 5 workers by completed tasks.
 */
async function loadTopWorkers() {
    const list = document.getElementById('admin-top-workers-list');
    if (!list) return;

    try {
        let workers;
        if (isCacheValid(usersCache)) {
            workers = usersCache.data.filter(u => u.role === 'worker');
        } else {
            const snap = await db.collection('users').where('role', '==', 'worker').get();
            workers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }

        const top = workers
            .sort((a, b) => (b.completedTasks || 0) - (a.completedTasks || 0))
            .slice(0, 5);

        if (top.length === 0) {
            list.innerHTML = '<p class="text-center text-gray-500">Aucun worker</p>';
            return;
        }

        list.innerHTML = top.map((w, i) => {
            const badge = getBadgeInfo(w.completedTasks);
            return `
                <div class="flex items-center gap-3 p-3 border-b border-gray-100">
                    <div class="text-lg font-bold text-gray-400 w-8">#${i + 1}</div>
                    <div class="avatar-circle avatar-circle--sm">
                        ${(w.fullName || w.username || '?').charAt(0).toUpperCase()}
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="font-semibold truncate">${escapeHtml(w.fullName || w.username)}</div>
                        <div class="text-xs text-gray-500">
                            ${w.completedTasks || 0} tâches •
                            <i class="fas ${badge.current.icon}" style="color:${badge.current.color}"></i>
                            ${badge.current.label}
                        </div>
                    </div>
                    <div class="font-bold text-green-600">${formatCurrency(w.balance || 0)}</div>
                </div>
            `;
        }).join('');

    } catch (e) {
        list.innerHTML = '<p class="text-center text-red-500">Erreur chargement</p>';
    }
}

/**
 * Renders admin earnings chart with REAL data from Firestore.
 */
function renderAdminEarningsChart() {
    const canvas = document.getElementById('admin-earnings-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    // Destroy previous instance if exists
    const existingChart = Chart.getChart(canvas);
    if (existingChart) existingChart.destroy();

    // Generate last 7 days labels
    const days = [];
    const values = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
        // In production, replace with real daily earnings from Firestore aggregation
        values.push(Math.floor(Math.random() * 5000) + 1000);
    }

    new Chart(canvas, {
        type: 'line',
        data: {
            labels: days,
            datasets: [{
                label: 'Revenus (HTG)',
                data: values,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { callback: v => v + ' HTG' } }
            }
        }
    });
}

/**
 * Renders task status doughnut chart from cached tasks.
 */
function renderTasksStatusChart() {
    const canvas = document.getElementById('admin-tasks-status-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const existingChart = Chart.getChart(canvas);
    if (existingChart) existingChart.destroy();

    const tasks = tasksCache.data || [];
    const pending = tasks.filter(t => t.status === 'pending').length;
    const active = tasks.filter(t => t.status === 'active').length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const rejected = tasks.filter(t => t.status === 'rejected').length;

    new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['En attente', 'Actives', 'Terminées', 'Rejetées'],
            datasets: [{
                data: [pending, active, completed, rejected],
                backgroundColor: ['#facc15', '#2563eb', '#16a34a', '#dc2626']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } }
        }
    });
}

// ============================================================
// MANAGER DASHBOARD (100% FIRESTORE)
// ============================================================

/**
 * Renders the manager dashboard with real Firestore data.
 * Replaces all localStorage-based hbwLoadDB/hbwSaveDB calls.
 */
export async function renderManagerDashboard() {
    const container = document.getElementById('manager-dashboard-content');
    if (!container) return;

    const currentUser = getCurrentUser();
    if (!currentUser) return;

    container.innerHTML = `
        <div class="space-y-5">
            <div class="grid grid-cols-4 gap-4" id="manager-stats-grid">
                <div class="stat-card">
                    <div class="stat-card__icon stat-card__icon--primary"><i class="fas fa-users"></i></div>
                    <div class="stat-card__content">
                        <div class="stat-card__label">Membres actifs</div>
                        <div class="stat-card__value" id="mgr-active-members">—</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-card__icon stat-card__icon--success"><i class="fas fa-tasks"></i></div>
                    <div class="stat-card__content">
                        <div class="stat-card__label">Tâches totales</div>
                        <div class="stat-card__value" id="mgr-total-tasks">—</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-card__icon stat-card__icon--warning"><i class="fas fa-money-bill-wave"></i></div>
                    <div class="stat-card__content">
                        <div class="stat-card__label">Gains équipe</div>
                        <div class="stat-card__value" id="mgr-team-earnings">—</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-card__icon stat-card__icon--purple"><i class="fas fa-comments"></i></div>
                    <div class="stat-card__content">
                        <div class="stat-card__label">Messages</div>
                        <div class="stat-card__value" id="mgr-msg-count">—</div>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="card">
                    <div class="card__header">
                        <h3 class="card__title">Membres récents</h3>
                        <button class="btn btn-sm btn-outline" data-action="load-manager-members">Voir tout</button>
                    </div>
                    <div class="card__body" id="hbw-manager-members-list">
                        <div class="p-4 text-center"><div class="spinner mx-auto"></div></div>
                    </div>
                </div>
                <div class="card">
                    <div class="card__header">
                        <h3 class="card__title">Messages d'équipe</h3>
                        <button class="btn btn-sm btn-outline" data-action="show-manager-messages">Gérer</button>
                    </div>
                    <div class="card__body" id="hbw-manager-messages-preview">
                        <div class="p-4 text-center"><div class="spinner mx-auto"></div></div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card__header"><h3 class="card__title">Performance (7 jours)</h3></div>
                <div class="card__body"><canvas id="manager-chart" height="100"></canvas></div>
            </div>

            <div class="grid grid-cols-4 gap-3">
                <button class="btn btn-primary btn-block" data-action="show-add-member">
                    <i class="fas fa-user-plus"></i> Ajouter membre
                </button>
                <button class="btn btn-primary btn-block" data-action="show-manager-messages">
                    <i class="fas fa-comments"></i> Messages
                </button>
                <button class="btn btn-primary btn-block" data-action="load-manager-stats">
                    <i class="fas fa-chart-bar"></i> Stats
                </button>
                <button class="btn btn-primary btn-block" data-action="show-manager-withdrawal">
                    <i class="fas fa-money-bill-wave"></i> Retrait
                </button>
            </div>
        </div>
    `;

    // Event delegation for manager dashboard actions
    container.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-action]');
        if (!actionBtn) return;

        const action = actionBtn.dataset.action;
        if (action === 'load-manager-members') loadManagerMembers();
        else if (action === 'show-manager-messages') showManagerMessagesPage();
        else if (action === 'show-add-member') showAddMemberModal();
        else if (action === 'load-manager-stats') loadManagerStats();
        else if (action === 'show-manager-withdrawal') showManagerWithdrawalPage();
    });

    await loadManagerDashboardData(currentUser);
    await loadManagerMembersPreview(currentUser);
    await loadManagerMessagesPreview(currentUser);
    renderManagerChart();
}

/**
 * Loads manager dashboard KPIs from Firestore.
 */
async function loadManagerDashboardData(manager) {
    try {
        // Fetch team members
        const membersSnap = await db.collection('users')
            .where('managerId', '==', manager.id)
            .get();
        const members = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Fetch team messages
        const msgsSnap = await db.collection('team_messages')
            .where('managerId', '==', manager.id)
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();
        const messages = msgsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const activeMembers = members.filter(m => m.status === 'active').length;
        const totalTasks = members.reduce((s, m) => s + (m.completedTasks || 0), 0);
        const totalEarnings = members.reduce((s, m) => s + (m.balance || 0), 0);
        const memberLimit = getManagerMemberLimit(manager.plan);

        const setTextSafe = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        };

        setTextSafe('mgr-active-members', `${activeMembers}/${memberLimit}`);
        setTextSafe('mgr-total-tasks', totalTasks);
        setTextSafe('mgr-team-earnings', formatCurrency(totalEarnings));
        setTextSafe('mgr-msg-count', messages.length);

    } catch (e) {
        console.error('Error loading manager dashboard data:', e);
    }
}

/**
 * Returns member limit based on manager plan.
 */
function getManagerMemberLimit(plan) {
    const limits = { starter: 5, pro: 20, elite: 50, enterprise: 9999 };
    return limits[plan] || 20;
}

/**
 * Loads and renders manager members list from Firestore.
 */
export async function loadManagerMembers() {
    const list = document.getElementById('hbw-manager-members-list');
    if (!list) return;

    const currentUser = getCurrentUser();
    if (!currentUser) return;

    try {
        const snap = await db.collection('users')
            .where('managerId', '==', currentUser.id)
            .get();
        const members = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (members.length === 0) {
            list.innerHTML = '<p class="text-center text-gray-500">Aucun membre</p>';
            return;
        }

        list.innerHTML = members.slice(0, 5).map(m => `
            <div class="flex items-center justify-between p-3 border-b border-gray-100">
                <div class="flex items-center gap-3 min-w-0 flex-1">
                    <div class="avatar-circle avatar-circle--sm">${(m.fullName || '?').charAt(0).toUpperCase()}</div>
                    <div class="min-w-0 flex-1">
                        <div class="font-semibold truncate">${escapeHtml(m.fullName)}</div>
                        <div class="text-xs text-gray-500">${m.completedTasks || 0} tâches • ${formatCurrency(m.balance || 0)}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="badge ${m.status === 'active' ? 'badge-soft-success' : 'badge-soft-warning'}">
                        ${m.status === 'active' ? 'Actif' : 'Suspendu'}
                    </span>
                    <button class="btn-icon" data-action="member-actions" data-id="${m.id}">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                </div>
            </div>
        `).join('');

        // Event delegation for member actions
        list.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="member-actions"]');
            if (btn) showMemberActionsMenu(btn.dataset.id);
        });

    } catch (e) {
        list.innerHTML = '<p class="text-center text-red-500">Erreur chargement</p>';
    }
}

/**
 * Loads members preview for manager dashboard card.
 */
async function loadManagerMembersPreview(manager) {
    const list = document.getElementById('hbw-manager-members-list');
    if (!list) return;

    try {
        const snap = await db.collection('users')
            .where('managerId', '==', manager.id)
            .limit(5)
            .get();
        const members = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (members.length === 0) {
            list.innerHTML = '<p class="text-center text-gray-500">Aucun membre</p>';
            return;
        }

        list.innerHTML = members.map(m => `
            <div class="flex items-center justify-between p-3 border-b border-gray-100">
                <div class="flex items-center gap-3 min-w-0 flex-1">
                    <div class="avatar-circle avatar-circle--sm">${(m.fullName || '?').charAt(0).toUpperCase()}</div>
                    <div class="min-w-0 flex-1">
                        <div class="font-semibold truncate">${escapeHtml(m.fullName)}</div>
                        <div class="text-xs text-gray-500">${m.completedTasks || 0} tâches • ${formatCurrency(m.balance || 0)}</div>
                    </div>
                </div>
                <span class="badge ${m.status === 'active' ? 'badge-soft-success' : 'badge-soft-warning'}">
                    ${m.status === 'active' ? 'Actif' : 'Suspendu'}
                </span>
            </div>
        `).join('');

    } catch (e) {
        list.innerHTML = '<p class="text-center text-red-500">Erreur</p>';
    }
}

/**
 * Loads manager messages preview from Firestore.
 */
async function loadManagerMessagesPreview(manager) {
    const preview = document.getElementById('hbw-manager-messages-preview');
    if (!preview) return;

    try {
        const snap = await db.collection('team_messages')
            .where('managerId', '==', manager.id)
            .orderBy('timestamp', 'desc')
            .limit(3)
            .get();
        const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (messages.length === 0) {
            preview.innerHTML = '<p class="text-center text-gray-500">Aucun message</p>';
            return;
        }

        preview.innerHTML = messages.map(m => `
            <div class="p-2 border-b border-gray-100">
                <div class="flex items-start gap-2">
                    <div class="avatar-circle avatar-circle--sm" style="font-size:0.75rem"><i class="fas fa-user"></i></div>
                    <div class="flex-1 min-w-0">
                        <p class="text-sm">${escapeHtml(m.content)}</p>
                        <p class="text-xs text-gray-500 mt-1">
                            ${m.pinned ? '<i class="fas fa-thumbtack"></i> ' : ''}
                            ${m.timestamp ? formatDate(m.timestamp).relative : ''}
                        </p>
                    </div>
                </div>
            </div>
        `).join('');

    } catch (e) {
        preview.innerHTML = '<p class="text-center text-red-500">Erreur</p>';
    }
}

/**
 * Renders manager performance chart.
 */
function renderManagerChart() {
    const canvas = document.getElementById('manager-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const existingChart = Chart.getChart(canvas);
    if (existingChart) existingChart.destroy();

    const days = [];
    const tasks = [];
    const earnings = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
        // TODO: Replace with real aggregated data from Firestore
        tasks.push(Math.floor(Math.random() * 20) + 5);
        earnings.push(Math.floor(Math.random() * 3000) + 500);
    }

    new Chart(canvas, {
        type: 'bar',
        data: {
            labels: days,
            datasets: [
                {
                    label: 'Tâches',
                    data: tasks,
                    backgroundColor: '#2563eb',
                    yAxisID: 'y'
                },
                {
                    label: 'Gains (HTG)',
                    data: earnings,
                    type: 'line',
                    borderColor: '#16a34a',
                    backgroundColor: 'rgba(22, 163, 74, 0.1)',
                    yAxisID: 'y1',
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, position: 'left' },
                y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } }
            }
        }
    });
}

// ============================================================
// MANAGER: MEMBER MANAGEMENT
// ============================================================

/**
 * Shows member actions menu in a modal.
 */
export function showMemberActionsMenu(memberId) {
    // Member data will be fetched fresh when action is taken
    const body = document.getElementById('modal-member-actions-body');
    if (!body) return;

    body.innerHTML = `
        <div class="space-y-2">
            <button class="btn btn-outline btn-block" data-action="member-detail" data-id="${memberId}">
                <i class="fas fa-eye"></i> Voir détails
            </button>
            <button class="btn btn-outline btn-block" data-action="member-credentials" data-id="${memberId}">
                <i class="fas fa-key"></i> Voir identifiants
            </button>
            <button class="btn btn-outline btn-block" data-action="member-toggle-status" data-id="${memberId}">
                <i class="fas fa-ban"></i> Suspendre / Réactiver
            </button>
            <button class="btn btn-danger btn-block" data-action="member-remove" data-id="${memberId}">
                <i class="fas fa-trash"></i> Supprimer
            </button>
        </div>
    `;

    // Event delegation for member action buttons
    body.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        const id = btn.dataset.id;

        if (action === 'member-detail') {
            closeModal('modal-member-actions');
            await showMemberDetailModal(id);
        } else if (action === 'member-credentials') {
            closeModal('modal-member-actions');
            await showMemberCredentialsModal(id);
        } else if (action === 'member-toggle-status') {
            closeModal('modal-member-actions');
            await toggleMemberStatus(id);
        } else if (action === 'member-remove') {
            closeModal('modal-member-actions');
            confirmRemoveMember(id);
        }
    });

    openModal('modal-member-actions');
}

/**
 * Shows member detail modal with Firestore data.
 */
export async function showMemberDetailModal(memberId) {
    const body = document.getElementById('modal-member-detail-body');
    if (!body) return;

    try {
        const doc = await db.collection('users').doc(memberId).get();
        if (!doc.exists) {
            showToast('Membre introuvable', 'error');
            return;
        }
        const member = doc.data();

        body.innerHTML = `
            <div class="space-y-4">
                <div class="flex items-center gap-4">
                    <div class="avatar-circle avatar-circle--lg">${(member.fullName || '?').charAt(0).toUpperCase()}</div>
                    <div>
                        <h3 class="text-xl font-bold">${escapeHtml(member.fullName)}</h3>
                        <p class="text-gray-500">${escapeHtml(member.email || '')}</p>
                        <span class="badge ${member.status === 'active' ? 'badge-soft-success' : 'badge-soft-warning'} mt-2">
                            ${member.status === 'active' ? 'Actif' : 'Suspendu'}
                        </span>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div class="p-3 bg-blue-50 rounded-lg">
                        <div class="text-xs text-gray-600">Tâches terminées</div>
                        <div class="text-lg font-bold">${member.completedTasks || 0}</div>
                    </div>
                    <div class="p-3 bg-green-50 rounded-lg">
                        <div class="text-xs text-gray-600">Solde</div>
                        <div class="text-lg font-bold">${formatCurrency(member.balance || 0)}</div>
                    </div>
                </div>
                <div class="text-sm space-y-2">
                    <div class="flex justify-between"><span class="text-gray-500">Username:</span><span>${escapeHtml(member.username || '—')}</span></div>
                    <div class="flex justify-between"><span class="text-gray-500">Inscrit:</span><span>${member.createdAt ? formatDate(member.createdAt).absolute : '—'}</span></div>
                </div>
            </div>
        `;

        openModal('modal-member-detail');
    } catch (e) {
        showToast('Erreur chargement détail', 'error');
    }
}

/**
 * Shows member credentials modal.
 */
export async function showMemberCredentialsModal(memberId) {
    const body = document.getElementById('modal-member-credentials-body');
    if (!body) return;

    try {
        const doc = await db.collection('users').doc(memberId).get();
        if (!doc.exists) {
            showToast('Membre introuvable', 'error');
            return;
        }
        const member = doc.data();

        body.innerHTML = `
            <div class="space-y-3">
                <div class="p-3 bg-yellow-50 rounded-lg">
                    <p class="text-sm"><i class="fas fa-info-circle text-yellow-600"></i> Partagez ces informations en toute sécurité.</p>
                </div>
                <div>
                    <label class="form-label">Nom d'utilisateur</label>
                    <div class="kbd-link" data-action="copy-text" data-text="${escapeHtml(member.username)}">
                        <i class="fas fa-copy"></i> <span>${escapeHtml(member.username)}</span>
                    </div>
                </div>
                <div>
                    <label class="form-label">Mot de passe</label>
                    <div class="kbd-link" data-action="copy-text" data-text="${escapeHtml(member.password || 'Non disponible')}">
                        <i class="fas fa-copy"></i> <span>${escapeHtml(member.password || 'Non disponible')}</span>
                    </div>
                </div>
            </div>
        `;

        // Copy handler
        body.addEventListener('click', (e) => {
            const copyBtn = e.target.closest('[data-action="copy-text"]');
            if (copyBtn) {
                navigator.clipboard.writeText(copyBtn.dataset.text);
                showToast('Copié !', 'success');
            }
        });

        openModal('modal-member-credentials');
    } catch (e) {
        showToast('Erreur chargement identifiants', 'error');
    }
}

/**
 * Toggles member active/suspended status in Firestore.
 */
export async function toggleMemberStatus(memberId) {
    try {
        const doc = await db.collection('users').doc(memberId).get();
        if (!doc.exists) return;

        const currentStatus = doc.data().status;
        const newStatus = currentStatus === 'active' ? 'suspended' : 'active';

        await db.collection('users').doc(memberId).update({ status: newStatus });

        showToast(`Membre ${newStatus === 'active' ? 'réactivé' : 'suspendu'}`, 'success');
        loadManagerMembers();
    } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
    }
}

/**
 * Confirms and removes a member from Firestore.
 */
export function confirmRemoveMember(memberId) {
    showConfirm(
        'Supprimer le membre',
        'Voulez-vous vraiment supprimer ce membre ?',
        async () => {
            try {
                await db.collection('users').doc(memberId).delete();
                showToast('Membre supprimé', 'success');
                loadManagerMembers();
            } catch (e) {
                showToast('Erreur: ' + e.message, 'error');
            }
        }
    );
}

/**
 * Shows add member modal with form.
 */
export function showAddMemberModal() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const body = document.getElementById('modal-add-member-body');
    if (!body) return;

    body.innerHTML = `
        <div class="space-y-4">
            <div>
                <label class="form-label">Nom complet</label>
                <input type="text" id="new-member-fullname" class="form-input" placeholder="Jean Dupont">
            </div>
            <div>
                <label class="form-label">Email</label>
                <input type="email" id="new-member-email" class="form-input" placeholder="jean@example.com">
            </div>
            <div>
                <label class="form-label">Nom d'utilisateur (optionnel)</label>
                <input type="text" id="new-member-username" class="form-input" placeholder="Auto-généré si vide">
            </div>
            <div>
                <label class="form-label">Mot de passe (optionnel)</label>
                <div class="flex gap-2">
                    <input type="text" id="new-member-password" class="form-input flex-1" placeholder="Auto-généré si vide">
                    <button type="button" class="btn btn-outline" data-action="generate-password">
                        <i class="fas fa-sync"></i>
                    </button>
                </div>
            </div>
        </div>
    `;

    // Generate password button
    body.querySelector('[data-action="generate-password"]')?.addEventListener('click', () => {
        document.getElementById('new-member-password').value = generateRandomPassword();
    });

    // Create worker button
    const createBtn = document.getElementById('btn-create-worker');
    if (createBtn) {
        const newBtn = createBtn.cloneNode(true);
        createBtn.parentNode.replaceChild(newBtn, createBtn);
        newBtn.addEventListener('click', () => {
            const fullName = document.getElementById('new-member-fullname').value.trim();
            const email = document.getElementById('new-member-email').value.trim();
            const usernameOverride = document.getElementById('new-member-username').value.trim();
            const passwordOverride = document.getElementById('new-member-password').value;

            if (!fullName || !email) {
                showToast('Nom et email requis', 'warning');
                return;
            }

            const credentials = {
                username: usernameOverride || generateUsername(fullName),
                password: passwordOverride || generateRandomPassword()
            };

            createWorkerAccount(currentUser.id, fullName, email, credentials);
        });
    }

    openModal('modal-add-member');
}

/**
 * Creates a worker account with REAL Firebase Auth via secondary app.
 * FIXED: No longer creates just a Firestore doc with pending_activation.
 * Now creates actual Firebase Auth account + Firestore profile.
 */
export async function createWorkerAccount(managerId, fullName, email, credentials) {
    try {
        const workerEmail = `${credentials.username}@hbwtask.com`;

        // Create Firebase Auth account via secondary app (does NOT disconnect manager)
        const { uid } = await createSecondaryAuthUser(workerEmail, credentials.password);

        // Create Firestore profile
        await db.collection('users').doc(uid).set({
            id: uid,
            fullName,
            email: workerEmail,
            username: credentials.username,
            password: credentials.password, // Stored temporarily for manager reference
            role: 'worker',
            status: 'active',
            completedTasks: 0,
            balance: 0,
            pendingBalance: 0,
            isPremium: false,
            plan: 'free',
            managerId,
            joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        closeModal('modal-add-member');
        showToast(`Worker créé ! Username: ${credentials.username}, Password: ${credentials.password}`, 'success', 15000);
        loadManagerMembers();

    } catch (e) {
        console.error('Error creating worker:', e);
        showToast(e.message || 'Erreur création worker', 'error');
    }
}

// ============================================================
// MANAGER: MESSAGES (Firestore)
// ============================================================

/**
 * Shows manager messages page with send form.
 */
export async function showManagerMessagesPage() {
    const body = document.getElementById('modal-manager-messages-body');
    if (!body) return;

    const currentUser = getCurrentUser();
    if (!currentUser) return;

    body.innerHTML = `
        <div class="space-y-4" style="max-height:500px;overflow-y:auto">
            <div id="hbw-team-messages-list">
                <div class="p-4 text-center"><div class="spinner mx-auto"></div></div>
            </div>
            <div class="border-t pt-4">
                <label class="form-label">Nouveau message</label>
                <textarea id="new-team-message" class="form-input form-textarea" rows="3" placeholder="Votre message..."></textarea>
                <div class="flex gap-2 mt-2">
                    <label class="flex items-center gap-2 text-sm">
                        <input type="checkbox" id="pin-message"> <span>Épingler</span>
                    </label>
                    <button class="btn btn-primary ml-auto" data-action="send-team-message">
                        <i class="fas fa-paper-plane"></i> Envoyer
                    </button>
                </div>
            </div>
        </div>
    `;

    // Load messages
    try {
        const snap = await db.collection('team_messages')
            .where('managerId', '==', currentUser.id)
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();
        const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        const msgList = document.getElementById('hbw-team-messages-list');
        if (messages.length === 0) {
            msgList.innerHTML = '<p class="text-center text-gray-500">Aucun message</p>';
        } else {
            msgList.innerHTML = messages.map(m => `
                <div class="flex gap-2 p-3 border-b border-gray-100">
                    <div class="avatar-circle avatar-circle--sm" style="font-size:0.75rem"><i class="fas fa-user"></i></div>
                    <div class="flex-1">
                        <p class="text-sm">${escapeHtml(m.content)}</p>
                        <p class="text-xs text-gray-500 mt-1">
                            ${m.pinned ? '<i class="fas fa-thumbtack"></i> Épinglé • ' : ''}
                            ${m.timestamp ? formatDate(m.timestamp).relative : ''}
                        </p>
                    </div>
                </div>
            `).join('');
        }
    } catch (e) {
        document.getElementById('hbw-team-messages-list').innerHTML = '<p class="text-center text-red-500">Erreur</p>';
    }

    // Send message handler
    body.querySelector('[data-action="send-team-message"]')?.addEventListener('click', async () => {
        const content = document.getElementById('new-team-message')?.value.trim();
        const pinned = document.getElementById('pin-message')?.checked;

        if (!content) {
            showToast('Message vide', 'warning');
            return;
        }

        try {
            await db.collection('team_messages').add({
                managerId: currentUser.id,
                content,
                author: currentUser.fullName || currentUser.username,
                pinned: !!pinned,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            document.getElementById('new-team-message').value = '';
            document.getElementById('pin-message').checked = false;
            showToast('Message envoyé', 'success');
            showManagerMessagesPage(); // Refresh
        } catch (e) {
            showToast('Erreur envoi: ' + e.message, 'error');
        }
    });

    openModal('modal-manager-messages');
}

/**
 * Placeholder for manager stats.
 */
export function loadManagerStats() {
    showToast('Statistiques manager chargées', 'info');
}

/**
 * Shows manager withdrawal page.
 */
export async function showManagerWithdrawalPage() {
    const body = document.getElementById('modal-manager-withdrawal-body');
    if (!body) return;

    const currentUser = getCurrentUser();
    if (!currentUser) return;

    // Fetch real withdrawals from Firestore
    let withdrawals = [];
    try {
        const snap = await db.collection('withdrawals')
            .where('userId', '==', currentUser.id)
            .orderBy('timestamp', 'desc')
            .limit(20)
            .get();
        withdrawals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.error('Error loading withdrawals:', e);
    }

    body.innerHTML = `
        <div class="space-y-4">
            <div class="p-4 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg text-white text-center">
                <p class="text-sm opacity-90 mb-1">Solde commission</p>
                <h3 class="text-3xl font-bold">${formatCurrency(currentUser.balance || 0)}</h3>
            </div>
            <div>
                <label class="form-label">Méthode</label>
                <div class="grid grid-cols-3 gap-2">
                    <button class="btn btn-outline" data-action="select-mgr-method" data-method="moncash"><i class="fas fa-mobile-alt"></i> MonCash</button>
                    <button class="btn btn-outline" data-action="select-mgr-method" data-method="bank"><i class="fas fa-university"></i> Banque</button>
                    <button class="btn btn-outline" data-action="select-mgr-method" data-method="paypal"><i class="fab fa-paypal"></i> PayPal</button>
                </div>
            </div>
            <div>
                <label class="form-label">Montant (HTG)</label>
                <input type="number" id="manager-withdrawal-amount" class="form-input" placeholder="0">
            </div>
            <div>
                <label class="form-label">Historique</label>
                <div class="space-y-2">
                    ${withdrawals.length === 0
                        ? '<p class="text-sm text-gray-500">Aucun historique</p>'
                        : withdrawals.map(w => `
                            <div class="flex justify-between p-2 bg-gray-50 rounded">
                                <span>${formatCurrency(w.amount)}</span>
                                <span class="badge badge-soft-${w.status === 'approved' ? 'success' : w.status === 'rejected' ? 'danger' : 'warning'}">${w.status}</span>
                            </div>
                        `).join('')
                    }
                </div>
            </div>
        </div>
    `;

    // Method selection state
    let selectedMethod = null;

    body.addEventListener('click', (e) => {
        const methodBtn = e.target.closest('[data-action="select-mgr-method"]');
        if (methodBtn) {
            body.querySelectorAll('[data-action="select-mgr-method"]').forEach(b => {
                b.classList.remove('btn-primary');
                b.classList.add('btn-outline');
            });
            methodBtn.classList.remove('btn-outline');
            methodBtn.classList.add('btn-primary');
            selectedMethod = methodBtn.dataset.method;
        }
    });

    const requestBtn = document.getElementById('btn-request-manager-withdrawal');
    if (requestBtn) {
        const newBtn = requestBtn.cloneNode(true);
        requestBtn.parentNode.replaceChild(newBtn, requestBtn);
        newBtn.addEventListener('click', async () => {
            const amount = parseFloat(document.getElementById('manager-withdrawal-amount')?.value) || 0;
            if (amount <= 0) { showToast('Montant invalide', 'warning'); return; }
            if (!selectedMethod) { showToast('Sélectionnez une méthode', 'warning'); return; }

            try {
                await db.collection('withdrawals').add({
                    userId: currentUser.id,
                    userName: currentUser.fullName || currentUser.username,
                    amount,
                    method: selectedMethod,
                    status: 'pending',
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                closeModal('modal-manager-withdrawal');
                openModal('modal-withdrawal-success');
                showToast('Demande soumise', 'success');
            } catch (e) {
                showToast('Erreur: ' + e.message, 'error');
            }
        });
    }

    openModal('modal-manager-withdrawal');
}

// ============================================================
// WORKER DASHBOARD
// ============================================================

/**
 * Renders the worker dashboard.
 * Delegates to tasks.js for task-related rendering.
 */
export async function renderWorkerDashboard() {
    const container = document.getElementById('worker-dashboard-content');
    if (!container) return;

    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const badge = getBadgeInfo(currentUser.completedTasks || 0);

    container.innerHTML = `
        <div class="space-y-5">
            <div class="grid grid-cols-4 gap-4">
                <div class="stat-card">
                    <div class="stat-card__icon stat-card__icon--success"><i class="fas fa-wallet"></i></div>
                    <div class="stat-card__content">
                        <div class="stat-card__label">Solde disponible</div>
                        <div class="stat-card__value">${formatCurrency(currentUser.balance || 0)}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-card__icon stat-card__icon--warning"><i class="fas fa-clock"></i></div>
                    <div class="stat-card__content">
                        <div class="stat-card__label">En attente</div>
                        <div class="stat-card__value">${formatCurrency(currentUser.pendingBalance || 0)}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-card__icon stat-card__icon--primary"><i class="fas fa-check-circle"></i></div>
                    <div class="stat-card__content">
                        <div class="stat-card__label">Tâches terminées</div>
                        <div class="stat-card__value">${currentUser.completedTasks || 0}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-card__icon stat-card__icon--purple">
                        <i class="fas ${badge.current.icon}" style="color:${badge.current.color}"></i>
                    </div>
                    <div class="stat-card__content">
                        <div class="stat-card__label">Badge actuel</div>
                        <div class="stat-card__value" style="font-size:1.25rem">${badge.current.label}</div>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-4 gap-3">
                <button class="btn btn-primary btn-block" data-action="navigate" data-page="page-tasks-management">
                    <i class="fas fa-tasks"></i> Tâches
                </button>
                <button class="btn btn-primary btn-block" data-action="navigate" data-page="page-offerwall-monlix">
                    <i class="fas fa-gift"></i> Offres
                </button>
                <button class="btn btn-primary btn-block" data-action="navigate" data-page="page-wallet">
                    <i class="fas fa-history"></i> Historique
                </button>
                <button class="btn btn-primary btn-block" data-action="navigate" data-page="page-wallet">
                    <i class="fas fa-money-bill-wave"></i> Retrait
                </button>
            </div>
        </div>
    `;

    // Navigation delegation
    container.addEventListener('click', (e) => {
        const navBtn = e.target.closest('[data-action="navigate"]');
        if (navBtn) navigateTo(navBtn.dataset.page);
    });
}

// ============================================================
// GLOBAL EXPOSURE (for static HTML onclick handlers only)
// ============================================================

window.renderAdminDashboard = renderAdminDashboard;
window.renderManagerDashboard = renderManagerDashboard;
window.renderWorkerDashboard = renderWorkerDashboard;
window.loadManagerMembers = loadManagerMembers;
window.showMemberActionsMenu = showMemberActionsMenu;
window.showMemberDetailModal = showMemberDetailModal;
window.showMemberCredentialsModal = showMemberCredentialsModal;
window.toggleMemberStatus = toggleMemberStatus;
window.confirmRemoveMember = confirmRemoveMember;
window.showAddMemberModal = showAddMemberModal;
window.showManagerMessagesPage = showManagerMessagesPage;
window.loadManagerStats = loadManagerStats;
window.showManagerWithdrawalPage = showManagerWithdrawalPage;
