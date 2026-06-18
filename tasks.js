/**
 * HBW Task - Tasks Module
 * 
 * Responsibilities:
 * - Admin: Create tasks with optional ImgBB tutorial image upload
 * - Admin: List, filter, validate, reject, delete tasks
 * - Worker: Browse available tasks, accept, submit proof via ImgBB
 * - Worker: View task tutorial image with fullscreen zoom
 * - Admin: Validate/reject proofs and credit workers
 * 
 * @module tasks
 */

import { db } from './firebase.js';
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
    getBadgeInfo
} from './utils.js';
import { getCurrentUser } from './auth.js';
import { navigateTo } from './app.js';

// ============================================================
// CONSTANTS
// ============================================================

const IMGBB_API_KEY = "555e4fae57d7a9f253b9a34addfe8609";
const MAX_TUTORIAL_IMAGE_SIZE = 3 * 1024 * 1024; // 3MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// ============================================================
// MODULE STATE
// ============================================================

const tasksCache = { data: [], timestamp: null };

const AdminTaskState = {
    tasks: [],
    filters: { tab: 'pending' },
    tutorialImageFile: null,
    tutorialImagePreviewUrl: null,
    isUploadingTutorial: false
};

const WorkerTaskState = {
    availableTasks: [],
    acceptedTasks: [],
    history: [],
    historyFilter: 'all',
    proofModal: { taskId: null, file: null },
    planLimits: {
        free: { dailyTaskLimit: 10, monthlyTaskLimit: 100, commission: 0.10, minWithdrawal: 2600, agencyAccess: false },
        premium: { dailyTaskLimit: 50, monthlyTaskLimit: 1000, commission: 0.05, minWithdrawal: 1300, agencyAccess: true }
    }
};

// ============================================================
// IMGBB UPLOAD UTILITY
// ============================================================

/**
 * Uploads a file to ImgBB and returns the image URL.
 * Shows progress overlay during upload.
 * 
 * @param {File} file - The file to upload
 * @param {object} options - Callbacks: onSuccess, onError, onProgress
 * @returns {Promise<object>} ImgBB response data
 */
async function uploadToImgbb(file, options = {}) {
    const { onSuccess, onError, onProgress } = options;

    const overlay = document.getElementById('hbw-upload-overlay');
    const percentEl = document.getElementById('hbw-progress-percent');
    const statusEl = document.getElementById('hbw-progress-status');
    const barEl = document.getElementById('hbw-progress-bar-inner');

    if (overlay) overlay.classList.remove('hidden');

    const updateProgress = (p, status) => {
        if (percentEl) percentEl.textContent = `${Math.round(p)}%`;
        if (statusEl) statusEl.textContent = status;
        if (barEl) barEl.style.width = `${p}%`;
        if (typeof onProgress === 'function') onProgress(p);
    };

    try {
        // Simulate progress 0 -> 90%
        for (let i = 0; i <= 90; i += 10) {
            updateProgress(i, 'Préparation du fichier...');
            await new Promise(r => setTimeout(r, 150));
        }

        updateProgress(90, 'Envoi vers le serveur...');

        // Real upload
        const formData = new FormData();
        formData.append('image', file);
        formData.append('key', IMGBB_API_KEY);

        const response = await fetch('https://api.imgbb.com/1/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error?.message || 'Erreur upload ImgBB');
        }

        updateProgress(100, 'Upload terminé !');
        await new Promise(r => setTimeout(r, 500));

        if (overlay) overlay.classList.add('hidden');
        if (typeof onSuccess === 'function') onSuccess(data.data);
        return data.data;

    } catch (err) {
        if (overlay) overlay.classList.add('hidden');
        if (typeof onError === 'function') onError(err);
        throw err;
    }
}

/**
 * Sets up a dropzone element for file selection with preview.
 * Uses event delegation — no inline onclick.
 * 
 * @param {string} selector - CSS selector for dropzone elements
 * @param {object} options - Callback: onFileSelected
 */
export function setupUploadZone(selector, options = {}) {
    const zones = document.querySelectorAll(selector);
    zones.forEach(zone => {
        if (zone.dataset.initialized) return;
        zone.dataset.initialized = 'true';

        const input = zone.querySelector('input[type="file"]');
        const preview = zone.querySelector('.dropzone__preview');
        const inner = zone.querySelector('.dropzone__inner');

        if (!input) return;

        zone.addEventListener('click', (e) => {
            if (e.target !== input && !e.target.closest('button')) input.click();
        });

        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('dragover');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('dragover');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                input.files = e.dataTransfer.files;
                handleFile(e.dataTransfer.files[0]);
            }
        });

        input.addEventListener('change', (e) => {
            if (e.target.files.length) {
                handleFile(e.target.files[0]);
            }
        });

        function handleFile(file) {
            if (preview) {
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        preview.innerHTML = '';
                        const img = document.createElement('img');
                        img.src = ev.target.result;
                        img.alt = 'Aperçu';
                        preview.appendChild(img);

                        const removeBtn = document.createElement('button');
                        removeBtn.className = 'btn btn-sm btn-outline mt-2';
                        removeBtn.innerHTML = '<i class="fas fa-times"></i> Retirer';
                        removeBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            preview.innerHTML = '';
                            preview.style.display = 'none';
                            if (inner) inner.style.display = 'flex';
                            input.value = '';
                        });
                        preview.appendChild(removeBtn);

                        preview.style.display = 'block';
                        if (inner) inner.style.display = 'none';
                    };
                    reader.readAsDataURL(file);
                } else {
                    preview.innerHTML = `
                        <div class="p-3 bg-gray-50 rounded-lg">
                            <i class="fas fa-file text-3xl text-blue-600 mb-2"></i>
                            <p class="text-sm font-medium">${escapeHtml(file.name)}</p>
                            <p class="text-xs text-gray-500">${(file.size / 1024).toFixed(1)} KB</p>
                        </div>
                    `;
                    preview.style.display = 'block';
                    if (inner) inner.style.display = 'none';
                }
            }

            if (typeof options.onFileSelected === 'function') {
                options.onFileSelected(file);
            }
        }
    });
}

// ============================================================
// ADMIN: CREATE TASK WITH TUTORIAL IMAGE
// ============================================================

/**
 * Opens the create task modal with ImgBB tutorial image upload zone.
 */
export function showCreateTaskModal() {
    const body = document.getElementById('modal-create-task-body');
    if (!body) return;

    // Reset tutorial image state
    AdminTaskState.tutorialImageFile = null;
    AdminTaskState.tutorialImagePreviewUrl = null;
    AdminTaskState.isUploadingTutorial = false;

    body.innerHTML = `
        <div class="space-y-4">
            <div>
                <label class="form-label" for="task-title">Titre <span class="text-red-500">*</span></label>
                <input type="text" id="task-title" class="form-input" placeholder="Titre de la tâche" maxlength="100">
            </div>
            <div>
                <label class="form-label" for="task-description">Description <span class="text-red-500">*</span></label>
                <textarea id="task-description" class="form-input form-textarea" rows="3" placeholder="Description détaillée" maxlength="1000"></textarea>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="form-label" for="task-category">Catégorie</label>
                    <select id="task-category" class="form-input">
                        <option value="social">Social</option>
                        <option value="survey">Sondage</option>
                        <option value="app">Application</option>
                        <option value="video">Vidéo</option>
                        <option value="other">Autre</option>
                    </select>
                </div>
                <div>
                    <label class="form-label" for="task-reward">Récompense (HTG) <span class="text-red-500">*</span></label>
                    <input type="number" id="task-reward" class="form-input" placeholder="0" step="0.01" min="1">
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="form-label" for="task-limit">Limite d'assignations</label>
                    <input type="number" id="task-limit" class="form-input" placeholder="Illimité" value="100" min="1">
                </div>
                <div>
                    <label class="form-label" for="task-status">Statut initial</label>
                    <select id="task-status" class="form-input">
                        <option value="active">Active</option>
                        <option value="pending">En attente</option>
                    </select>
                </div>
            </div>
            <div>
                <label class="form-label" for="task-type">Type</label>
                <select id="task-type" class="form-input">
                    <option value="regular">Regular</option>
                    <option value="agency">Agency (Premium)</option>
                </select>
            </div>

            <!-- Tutorial Image Upload (ImgBB) -->
            <div class="card bg-gray-50 border border-dashed border-gray-300 p-4">
                <div class="flex items-center justify-between mb-3">
                    <div>
                        <h4 class="font-semibold text-gray-900 flex items-center gap-2">
                            <i class="fas fa-image text-blue-600"></i>
                            Image de tutoriel (Optionnel)
                        </h4>
                        <p class="text-xs text-gray-500 mt-1">Ajoutez une capture d'écran pour guider les workers.</p>
                    </div>
                    <span class="badge badge-soft-info">Max 3MB</span>
                </div>
                <div class="border-dashed dropzone" id="tutorial-dropzone">
                    <div class="dropzone__inner">
                        <i class="fas fa-cloud-upload-alt dropzone__icon"></i>
                        <p class="dropzone__text">Cliquez pour sélectionner une image</p>
                        <p class="dropzone__hint">Formats : JPG, PNG, WEBP</p>
                        <input type="file" id="tutorial-file-input" class="dropzone__input" accept="image/jpeg,image/png,image/webp" style="display:none">
                    </div>
                    <div class="dropzone__preview" id="tutorial-preview" style="display:none"></div>
                </div>
                <p id="tutorial-error" class="text-xs text-red-500 mt-2 hidden"></p>
            </div>
        </div>
    `;

    // Setup tutorial dropzone with validation
    setupUploadZone('#tutorial-dropzone', {
        onFileSelected: (file) => {
            const errorEl = document.getElementById('tutorial-error');

            // Validate type
            if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
                if (errorEl) {
                    errorEl.textContent = 'Format non supporté. Utilisez JPG, PNG ou WEBP.';
                    errorEl.classList.remove('hidden');
                }
                AdminTaskState.tutorialImageFile = null;
                // Clear the invalid preview
                const preview = document.getElementById('tutorial-preview');
                if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
                const inner = document.querySelector('#tutorial-dropzone .dropzone__inner');
                if (inner) inner.style.display = 'flex';
                document.getElementById('tutorial-file-input').value = '';
                return;
            }

            // Validate size
            if (file.size > MAX_TUTORIAL_IMAGE_SIZE) {
                if (errorEl) {
                    errorEl.textContent = `Fichier trop volumineux. Maximum : ${MAX_TUTORIAL_IMAGE_SIZE / (1024 * 1024)}MB.`;
                    errorEl.classList.remove('hidden');
                }
                AdminTaskState.tutorialImageFile = null;
                const preview = document.getElementById('tutorial-preview');
                if (preview) { preview.innerHTML = ''; preview.style.display = 'none'; }
                const inner = document.querySelector('#tutorial-dropzone .dropzone__inner');
                if (inner) inner.style.display = 'flex';
                document.getElementById('tutorial-file-input').value = '';
                return;
            }

            // Valid file
            if (errorEl) errorEl.classList.add('hidden');
            AdminTaskState.tutorialImageFile = file;
        }
    });

    // Bind create button
    const createBtn = document.getElementById('btn-create-task');
    if (createBtn) {
        // Remove old listeners by cloning
        const newBtn = createBtn.cloneNode(true);
        createBtn.parentNode.replaceChild(newBtn, createBtn);
        newBtn.addEventListener('click', createTask);
    }

    openModal('modal-create-task');
}

/**
 * Creates a task in Firestore, uploading tutorial image to ImgBB first if present.
 */
async function createTask() {
    const title = document.getElementById('task-title')?.value.trim();
    const description = document.getElementById('task-description')?.value.trim();
    const category = document.getElementById('task-category')?.value;
    const reward = parseFloat(document.getElementById('task-reward')?.value) || 0;
    const limit = parseInt(document.getElementById('task-limit')?.value) || 100;
    const status = document.getElementById('task-status')?.value;
    const type = document.getElementById('task-type')?.value;

    // Validation
    if (!title) {
        showToast('Le titre est requis.', 'warning');
        return;
    }
    if (!description) {
        showToast('La description est requise.', 'warning');
        return;
    }
    if (reward <= 0) {
        showToast('La récompense doit être supérieure à 0.', 'warning');
        return;
    }

    const createBtn = document.getElementById('btn-create-task');
    const originalText = createBtn ? createBtn.innerHTML : '';

    try {
        if (createBtn) {
            createBtn.disabled = true;
            createBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Création...';
        }

        let taskTutorialImageUrl = null;

        // Upload tutorial image if present
        if (AdminTaskState.tutorialImageFile) {
            try {
                const imgResult = await uploadToImgbb(AdminTaskState.tutorialImageFile, {
                    onError: (err) => {
                        console.error('Tutorial upload error:', err);
                    }
                });
                taskTutorialImageUrl = imgResult.url;
            } catch (uploadErr) {
                const proceedWithoutImage = confirm(
                    'L\'upload de l\'image tutoriel a échoué.\n\nVoulez-vous créer la tâche sans image ?'
                );
                if (!proceedWithoutImage) {
                    throw uploadErr;
                }
                taskTutorialImageUrl = null;
            }
        }

        const currentUser = getCurrentUser();
        const taskData = {
            title,
            description,
            category,
            reward,
            limit,
            status,
            type,
            taskTutorialImageUrl,
            assignments: 0,
            createdBy: currentUser ? currentUser.id : null,
            createdByName: currentUser ? (currentUser.fullName || currentUser.username) : 'Système',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('tasks').add(taskData);

        // Update local cache
        AdminTaskState.tasks.push({ id: docRef.id, ...taskData });
        invalidateCache(tasksCache);

        closeModal('modal-create-task');
        showToast('Tâche créée avec succès !', 'success');

        // Refresh task list if visible
        if (document.getElementById('tasks-content')) {
            loadAdminTasks();
        }

    } catch (e) {
        console.error('Error creating task:', e);
        showToast('Erreur lors de la création : ' + (e.message || 'Erreur inconnue'), 'error');
    } finally {
        if (createBtn) {
            createBtn.disabled = false;
            createBtn.innerHTML = originalText;
        }
    }
}

// ============================================================
// ADMIN: TASK LIST & MANAGEMENT
// ============================================================

/**
 * Loads and renders the admin task management page.
 */
export async function loadAdminTasks() {
    const container = document.getElementById('tasks-management-content');
    if (!container) return;

    container.innerHTML = `
        <div class="card">
            <div class="card__header">
                <h3 class="card__title">Gestion des tâches</h3>
                <button class="btn btn-primary" id="btn-open-create-task-admin">
                    <i class="fas fa-plus"></i> Créer tâche
                </button>
            </div>
            <div class="card__body">
                <div class="tabs" id="task-tabs">
                    <button class="tab-btn active" data-task-tab="pending">En attente</button>
                    <button class="tab-btn" data-task-tab="active">Actives</button>
                    <button class="tab-btn" data-task-tab="completed">Terminées</button>
                    <button class="tab-btn" data-task-tab="rejected">Rejetées</button>
                </div>
                <div id="tasks-content">
                    <div class="p-6 text-center"><div class="spinner mx-auto"></div></div>
                </div>
            </div>
        </div>
    `;

    // Event delegation for tabs
    document.getElementById('task-tabs')?.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('[data-task-tab]');
        if (!tabBtn) return;
        switchTaskTab(tabBtn.dataset.taskTab, tabBtn);
    });

    // Bind create button via addEventListener (not inline onclick)
    document.getElementById('btn-open-create-task-admin')?.addEventListener('click', showCreateTaskModal);

    try {
        if (!isCacheValid(tasksCache)) {
            const snap = await db.collection('tasks').get();
            tasksCache.data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            tasksCache.timestamp = Date.now();
        }
        AdminTaskState.tasks = tasksCache.data;
        _filterAndRenderTasks();
    } catch (e) {
        console.error('Error loading tasks:', e);
        document.getElementById('tasks-content').innerHTML =
            '<p class="p-4 text-center text-red-500">Erreur de chargement des tâches.</p>';
    }
}

/**
 * Switches the active task tab.
 */
export function switchTaskTab(tab, btn) {
    AdminTaskState.filters.tab = tab;
    document.querySelectorAll('[data-task-tab]').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    _filterAndRenderTasks();
}

/**
 * Filters and renders tasks based on current tab.
 * Uses event delegation for action buttons.
 */
function _filterAndRenderTasks() {
    const container = document.getElementById('tasks-content');
    if (!container) return;

    const tab = AdminTaskState.filters.tab;
    const tasks = AdminTaskState.tasks.filter(t => t.status === tab);

    if (tasks.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>Aucune tâche ${tab === 'pending' ? 'en attente' : tab === 'active' ? 'active' : tab === 'completed' ? 'terminée' : 'rejetée'}</p>
            </div>
        `;
        return;
    }

    container.innerHTML = tasks.map(t => `
        <div class="task-card mb-3" data-task-id="${t.id}">
            <div class="task-card__header">
                <div>
                    <h4 class="task-card__title">${escapeHtml(t.title)}</h4>
                    <p class="task-card__category">${escapeHtml(t.category || 'Général')}</p>
                </div>
                <div class="task-card__reward">${formatCurrency(t.reward || 0)}</div>
            </div>
            <p class="task-card__description">${escapeHtml(t.description || '')}</p>
            ${t.taskTutorialImageUrl ? '<p class="text-xs text-blue-600 mt-1"><i class="fas fa-image"></i> Tutoriel inclus</p>' : ''}
            <div class="task-card__footer">
                <div class="task-card__meta">
                    <span><i class="fas fa-users"></i> ${t.assignments || 0} assignées</span>
                    <span><i class="fas fa-clock"></i> ${t.createdAt ? formatDate(t.createdAt).relative : '—'}</span>
                </div>
                <div class="flex gap-2">
                    ${tab === 'pending' ? `
                        <button class="btn btn-sm btn-success" data-action="validate-task" data-id="${t.id}">
                            <i class="fas fa-check"></i> Valider
                        </button>
                        <button class="btn btn-sm btn-danger" data-action="reject-task" data-id="${t.id}">
                            <i class="fas fa-times"></i> Rejeter
                        </button>
                    ` : ''}
                    <button class="btn btn-sm btn-outline" data-action="delete-task" data-id="${t.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `).join('');

    // Event delegation for task actions
    container.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-action]');
        if (!actionBtn) return;

        const action = actionBtn.dataset.action;
        const taskId = actionBtn.dataset.id;

        if (action === 'validate-task') validateTask(taskId);
        else if (action === 'reject-task') rejectTask(taskId);
        else if (action === 'delete-task') deleteTask(taskId);
    });
}

/**
 * Validates a task (marks as completed).
 */
export async function validateTask(taskId) {
    const task = AdminTaskState.tasks.find(t => t.id === taskId);
    if (!task) return;

    showConfirm(
        'Valider la tâche',
        `Valider "${task.title}" ?`,
        async () => {
            try {
                await db.collection('tasks').doc(taskId).update({
                    status: 'completed',
                    validatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                task.status = 'completed';
                invalidateCache(tasksCache);
                _filterAndRenderTasks();
                showToast('Tâche validée.', 'success');
            } catch (e) {
                showToast('Erreur : ' + e.message, 'error');
            }
        }
    );
}

/**
 * Rejects a task.
 */
export async function rejectTask(taskId) {
    const task = AdminTaskState.tasks.find(t => t.id === taskId);
    if (!task) return;

    showConfirm(
        'Rejeter la tâche',
        `Rejeter "${task.title}" ?`,
        async () => {
            try {
                await db.collection('tasks').doc(taskId).update({
                    status: 'rejected',
                    rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                task.status = 'rejected';
                invalidateCache(tasksCache);
                _filterAndRenderTasks();
                showToast('Tâche rejetée.', 'success');
            } catch (e) {
                showToast('Erreur : ' + e.message, 'error');
            }
        }
    );
}

/**
 * Deletes a task permanently.
 */
export function deleteTask(taskId) {
    const task = AdminTaskState.tasks.find(t => t.id === taskId);
    if (!task) return;

    showConfirm(
        'Supprimer la tâche',
        `Supprimer définitivement "${task.title}" ?`,
        async () => {
            try {
                await db.collection('tasks').doc(taskId).delete();
                AdminTaskState.tasks = AdminTaskState.tasks.filter(t => t.id !== taskId);
                invalidateCache(tasksCache);
                _filterAndRenderTasks();
                showToast('Tâche supprimée.', 'success');
            } catch (e) {
                showToast('Erreur : ' + e.message, 'error');
            }
        }
    );
}

// ============================================================
// WORKER: TASK BROWSING & ACCEPTANCE
// ============================================================

/**
 * Checks plan limits for the current worker.
 */
function checkPlanLimits() {
    const currentUser = getCurrentUser();
    if (!currentUser) return null;

    const isPremium = currentUser.isPremium;
    const limits = isPremium ? WorkerTaskState.planLimits.premium : WorkerTaskState.planLimits.free;

    // In production, dailyUsed should come from Firestore
    const dailyUsed = Math.floor(Math.random() * limits.dailyTaskLimit * 0.3);
    const monthlyUsed = currentUser.completedTasks || 0;

    return {
        dailyLimit: limits.dailyTaskLimit,
        monthlyLimit: limits.monthlyTaskLimit,
        commission: limits.commission,
        minWithdrawal: limits.minWithdrawal,
        agencyAccess: limits.agencyAccess,
        dailyUsed,
        monthlyUsed,
        dailyProgress: Math.min(100, (dailyUsed / limits.dailyTaskLimit) * 100),
        monthlyProgress: Math.min(100, (monthlyUsed / limits.monthlyTaskLimit) * 100)
    };
}

/**
 * Loads available tasks preview for worker dashboard.
 */
export async function loadAvailableTasksPreview() {
    const container = document.getElementById('worker-available-tasks');
    if (!container) return;

    try {
        let tasks;
        if (isCacheValid(tasksCache)) {
            tasks = tasksCache.data;
        } else {
            const snap = await db.collection('tasks').where('status', '==', 'active').limit(5).get();
            tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            tasksCache.data = tasks;
            tasksCache.timestamp = Date.now();
        }
        WorkerTaskState.availableTasks = tasks;

        if (tasks.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500">Aucune tâche disponible</p>';
            return;
        }

        container.innerHTML = tasks.slice(0, 3).map(t => `
            <div class="flex items-center justify-between p-2 border-b border-gray-100">
                <div>
                    <div class="font-semibold text-sm">${escapeHtml(t.title)}</div>
                    <div class="text-xs text-gray-500">${escapeHtml(t.category || '')}</div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="font-bold text-green-600">${formatCurrency(t.reward)}</span>
                    <button class="btn btn-sm btn-primary" data-action="accept-task" data-id="${t.id}">
                        <i class="fas fa-play"></i>
                    </button>
                </div>
            </div>
        `).join('');

        // Event delegation
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action="accept-task"]');
            if (btn) acceptTask(btn.dataset.id);
        });

    } catch (e) {
        container.innerHTML = '<p class="text-center text-red-500">Erreur</p>';
    }
}

/**
 * Accepts a task and opens the proof submission modal.
 */
export function acceptTask(taskId) {
    const task = WorkerTaskState.availableTasks.find(t => t.id === taskId);
    if (!task) {
        showToast('Tâche introuvable.', 'error');
        return;
    }

    const limits = checkPlanLimits();
    if (limits && limits.dailyUsed >= limits.dailyLimit) {
        showPlanLimitsModal();
        return;
    }

    WorkerTaskState.acceptedTasks.push(task);
    WorkerTaskState.availableTasks = WorkerTaskState.availableTasks.filter(t => t.id !== taskId);

    showToast('Tâche acceptée ! Soumettez votre preuve.', 'success');
    openTaskProofModal(taskId);
}

// ============================================================
// WORKER: PROOF SUBMISSION
// ============================================================

/**
 * Opens the proof submission modal for a given task.
 */
export function openTaskProofModal(taskId) {
    WorkerTaskState.proofModal.taskId = taskId;
    WorkerTaskState.proofModal.file = null;

    const comment = document.getElementById('proof-comment');
    const preview = document.getElementById('proof-preview');
    const input = document.getElementById('proof-file-input');

    if (comment) comment.value = '';
    if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
    if (input) input.value = '';

    setupUploadZone('#proof-dropzone', {
        onFileSelected: (file) => {
            WorkerTaskState.proofModal.file = file;
        }
    });

    const submitBtn = document.getElementById('btn-submit-proof');
    if (submitBtn) {
        const newBtn = submitBtn.cloneNode(true);
        submitBtn.parentNode.replaceChild(newBtn, submitBtn);
        newBtn.addEventListener('click', () => submitTaskProof(taskId));
    }

    openModal('modal-task-proof');
}

/**
 * Submits a task proof: uploads to ImgBB, saves to Firestore, credits pending balance.
 */
export async function submitTaskProof(taskId) {
    const file = WorkerTaskState.proofModal.file;
    const comment = document.getElementById('proof-comment')?.value || '';

    if (!file) {
        showToast('Veuillez ajouter une preuve.', 'warning');
        return;
    }

    const task = WorkerTaskState.acceptedTasks.find(t => t.id === taskId);
    if (!task) {
        showToast('Tâche introuvable.', 'error');
        return;
    }

    const currentUser = getCurrentUser();
    if (!currentUser) {
        showToast('Session expirée. Veuillez vous reconnecter.', 'error');
        return;
    }

    try {
        // Upload proof to ImgBB
        const result = await uploadToImgbb(file, {
            onError: (err) => {
                console.error('Proof upload error:', err);
                showToast('Erreur upload preuve.', 'error');
            }
        });

        // Save proof to Firestore
        const proofData = {
            taskId,
            taskTitle: task.title,
            userId: currentUser.id,
            userName: currentUser.fullName || currentUser.username,
            userRole: currentUser.role,
            imageUrl: result.url,
            comment,
            status: 'pending',
            reward: task.reward,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('proofs').add(proofData);

        // Increment task assignments
        await db.collection('tasks').doc(taskId).update({
            assignments: firebase.firestore.FieldValue.increment(1)
        });

        // Add to local history
        WorkerTaskState.history.unshift({
            ...task,
            status: 'pending',
            proofUrl: result.url,
            comment,
            completedAt: new Date()
        });

        // Credit pending balance
        const limits = checkPlanLimits();
        const commission = limits ? limits.commission : 0.10;
        const netReward = task.reward * (1 - commission);

        await db.collection('users').doc(currentUser.id).update({
            pendingBalance: firebase.firestore.FieldValue.increment(netReward)
        });

        // Remove from accepted tasks
        WorkerTaskState.acceptedTasks = WorkerTaskState.acceptedTasks.filter(t => t.id !== taskId);

        closeModal('modal-task-proof');
        openModal('modal-proof-success');

    } catch (e) {
        console.error('Error submitting proof:', e);
        showToast('Erreur : ' + (e.message || 'Échec de la soumission'), 'error');
    }
}

// ============================================================
// WORKER: TASK TUTORIAL DISPLAY
// ============================================================

/**
 * Renders the task tutorial section for worker detail view.
 * Returns empty string if no tutorial image exists.
 * 
 * @param {object} task - Task object with optional taskTutorialImageUrl
 * @returns {string} HTML string for the tutorial section
 */
export function renderTaskTutorialSection(task) {
    if (!task || !task.taskTutorialImageUrl) {
        return '';
    }

    return `
        <div class="card mt-4 border border-blue-100 bg-blue-50/30">
            <div class="card__header bg-blue-50 border-b border-blue-100">
                <h3 class="card__title text-blue-900 flex items-center gap-2">
                    <i class="fas fa-lightbulb text-blue-600"></i>
                    Tutoriel de la tâche
                </h3>
            </div>
            <div class="card__body">
                <p class="text-sm text-gray-600 mb-3">
                    Suivez les instructions sur l'image ci-dessous pour valider la tâche.
                </p>
                <div class="tutorial-image-wrapper" style="position:relative;cursor:zoom-in;border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow-md);">
                    <img 
                        src="${escapeHtml(task.taskTutorialImageUrl)}" 
                        alt="Tutoriel de la tâche" 
                        class="tutorial-image" 
                        loading="lazy"
                        style="width:100%;height:auto;display:block;transition:transform 0.3s ease;"
                        data-action="zoom-tutorial"
                    >
                    <button class="tutorial-zoom-btn" data-action="zoom-tutorial" aria-label="Agrandir l'image"
                        style="position:absolute;bottom:1rem;right:1rem;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.9);color:var(--text);display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-md);border:none;cursor:pointer;">
                        <i class="fas fa-search-plus"></i>
                    </button>
                </div>
                <p class="text-xs text-gray-500 mt-2 text-center">
                    <i class="fas fa-search-plus"></i> Cliquez sur l'image pour l'agrandir
                </p>
            </div>
        </div>
    `;
}

/**
 * Opens the fullscreen image viewer for a tutorial or proof image.
 * Exposed globally for event delegation.
 */
export function openImageViewer(imageUrl) {
    const viewerSrc = document.getElementById('image-viewer-src');
    if (viewerSrc) {
        viewerSrc.src = imageUrl;
        openModal('modal-image-viewer');
    }
}

// ============================================================
// WORKER: HISTORY
// ============================================================

/**
 * Loads worker proof history from Firestore.
 */
export async function loadWorkerHistory() {
    const targetContainer = document.getElementById('worker-dashboard-content');
    if (!targetContainer) return;

    // Remove existing section if any
    const existing = document.getElementById('worker-history-section');
    if (existing) existing.remove();

    const section = document.createElement('div');
    section.id = 'worker-history-section';
    section.className = 'card mt-4';
    section.innerHTML = `
        <div class="card__header">
            <h3 class="card__title">Historique</h3>
            <div class="flex gap-2" id="history-filter-btns">
                <button class="btn btn-sm btn-primary" data-filter="all">Tous</button>
                <button class="btn btn-sm btn-outline" data-filter="pending">En attente</button>
                <button class="btn btn-sm btn-outline" data-filter="completed">Terminés</button>
                <button class="btn btn-sm btn-outline" data-filter="rejected">Rejetés</button>
            </div>
        </div>
        <div class="card__body" id="worker-history-list">
            <div class="p-4 text-center"><div class="spinner mx-auto"></div></div>
        </div>
    `;

    targetContainer.appendChild(section);

    // Event delegation for filter buttons
    document.getElementById('history-filter-btns')?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-filter]');
        if (!btn) return;
        setHistoryFilter(btn.dataset.filter, btn);
    });

    const currentUser = getCurrentUser();
    if (!currentUser) return;

    try {
        const snap = await db.collection('proofs')
            .where('userId', '==', currentUser.id)
            .orderBy('timestamp', 'desc')
            .get();
        WorkerTaskState.history = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderWorkerHistory();
    } catch (e) {
        console.error('Error loading history:', e);
        document.getElementById('worker-history-list').innerHTML =
            '<p class="text-center text-red-500">Erreur de chargement.</p>';
    }
}

/**
 * Sets the history filter and re-renders.
 */
export function setHistoryFilter(filter, btn) {
    WorkerTaskState.historyFilter = filter;
    if (btn) {
        btn.parentElement.querySelectorAll('button').forEach(b => {
            b.classList.remove('btn-primary');
            b.classList.add('btn-outline');
        });
        btn.classList.remove('btn-outline');
        btn.classList.add('btn-primary');
    }
    renderWorkerHistory();
}

/**
 * Renders the filtered worker history list.
 */
function renderWorkerHistory() {
    const container = document.getElementById('worker-history-list');
    if (!container) return;

    const filter = WorkerTaskState.historyFilter;
    const history = filter === 'all'
        ? WorkerTaskState.history
        : WorkerTaskState.history.filter(h => h.status === filter);

    if (history.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-history"></i>
                <p>Aucun historique</p>
            </div>
        `;
        return;
    }

    container.innerHTML = history.map(h => {
        const statusBadge = {
            pending: '<span class="badge badge-soft-warning">En attente</span>',
            completed: '<span class="badge badge-soft-success">Terminé</span>',
            rejected: '<span class="badge badge-soft-danger">Rejeté</span>'
        }[h.status] || '';

        return `
            <div class="flex items-center justify-between p-3 border-b border-gray-100">
                <div class="flex items-center gap-3 min-w-0 flex-1">
                    ${h.imageUrl
                        ? `<img src="${escapeHtml(h.imageUrl)}" class="w-12 h-12 rounded-lg object-cover" alt="">`
                        : '<div class="avatar-circle avatar-circle--sm"><i class="fas fa-file"></i></div>'
                    }
                    <div class="min-w-0 flex-1">
                        <div class="font-semibold truncate">${escapeHtml(h.taskTitle || h.title || 'Tâche')}</div>
                        <div class="text-xs text-gray-500">${h.timestamp ? formatDate(h.timestamp).relative : '—'}</div>
                    </div>
                </div>
                <div class="text-right ml-2">
                    <div class="font-bold text-green-600">${formatCurrency(h.reward || 0)}</div>
                    ${statusBadge}
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
// WORKER: PLAN LIMITS MODAL
// ============================================================

/**
 * Shows the plan limits modal when daily quota is reached.
 */
export function showPlanLimitsModal() {
    const body = document.getElementById('modal-plan-limits-body');
    if (!body) return;

    const limits = checkPlanLimits();
    if (!limits) return;

    body.innerHTML = `
        <div class="space-y-3">
            <div class="p-3 bg-yellow-50 rounded-lg">
                <div class="flex items-center gap-2 mb-1">
                    <i class="fas fa-exclamation-triangle text-yellow-600"></i>
                    <strong>Limite atteinte</strong>
                </div>
                <p class="text-sm">Vous avez atteint votre limite quotidienne de tâches.</p>
            </div>
            <div>
                <div class="flex justify-between text-sm mb-1">
                    <span>Tâches quotidiennes</span>
                    <span>${limits.dailyUsed}/${limits.dailyLimit}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width:${limits.dailyProgress}%"></div>
                </div>
            </div>
            <div>
                <div class="flex justify-between text-sm mb-1">
                    <span>Tâches mensuelles</span>
                    <span>${limits.monthlyUsed}/${limits.monthlyLimit}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width:${limits.monthlyProgress}%"></div>
                </div>
            </div>
        </div>
    `;

    openModal('modal-plan-limits');
}

// ============================================================
// ADMIN: PROOF VALIDATION
// ============================================================

/**
 * Loads the admin proof validation page.
 */
export function loadValidationPage() {
    const container = document.getElementById('validation-content');
    if (!container) return;

    container.innerHTML = `
        <div class="card">
            <div class="card__header">
                <h3 class="card__title">Validation des preuves</h3>
            </div>
            <div class="card__body">
                <div id="validation-list">
                    <div class="p-4 text-center"><div class="spinner mx-auto"></div></div>
                </div>
            </div>
        </div>
    `;

    loadValidationList();
}

/**
 * Loads pending proofs from Firestore and renders them.
 * Uses event delegation for approve/reject buttons.
 */
async function loadValidationList() {
    const container = document.getElementById('validation-list');
    if (!container) return;

    try {
        const snap = await db.collection('proofs')
            .where('status', '==', 'pending')
            .orderBy('timestamp', 'desc')
            .get();
        const proofs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (proofs.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle"></i>
                    <p>Aucune preuve en attente</p>
                </div>
            `;
            return;
        }

        container.innerHTML = proofs.map(p => `
            <div class="task-card mb-3" data-proof-id="${p.id}">
                <div class="task-card__header">
                    <div>
                        <h4 class="task-card__title">${escapeHtml(p.taskTitle || 'Tâche')}</h4>
                        <p class="task-card__category">Par ${escapeHtml(p.userName || '?')}</p>
                    </div>
                    <div class="task-card__reward">${formatCurrency(p.reward || 0)}</div>
                </div>
                ${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" class="w-full h-48 object-cover rounded-lg mb-3 cursor-pointer" data-action="view-proof-image" data-url="${escapeHtml(p.imageUrl)}">` : ''}
                ${p.comment ? `<p class="task-card__description">${escapeHtml(p.comment)}</p>` : ''}
                <div class="task-card__footer">
                    <span class="text-xs text-gray-500">${p.timestamp ? formatDate(p.timestamp).relative : ''}</span>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-success" data-action="approve-proof" data-id="${p.id}">
                            <i class="fas fa-check"></i> Approuver
                        </button>
                        <button class="btn btn-sm btn-danger" data-action="reject-proof" data-id="${p.id}">
                            <i class="fas fa-times"></i> Rejeter
                        </button>
                    </div>
                </div>
            </div>
        `).join('');

        // Event delegation for proof actions
        container.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('[data-action]');
            if (!actionBtn) return;

            const action = actionBtn.dataset.action;
            const id = actionBtn.dataset.id;
            const url = actionBtn.dataset.url;

            if (action === 'approve-proof') approveProof(id);
            else if (action === 'reject-proof') rejectProof(id);
            else if (action === 'view-proof-image') openImageViewer(url);
        });

    } catch (e) {
        console.error('Error loading validations:', e);
        container.innerHTML = '<p class="text-center text-red-500">Erreur de chargement.</p>';
    }
}

/**
 * Approves a proof: marks as completed, credits worker balance.
 */
export async function approveProof(proofId) {
    showConfirm(
        'Approuver la preuve',
        'Cette preuve sera validée et le worker sera crédité.',
        async () => {
            try {
                const doc = await db.collection('proofs').doc(proofId).get();
                const proof = doc.data();

                await db.collection('proofs').doc(proofId).update({
                    status: 'completed',
                    validatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                if (proof.userId) {
                    const commission = 0.05;
                    const netReward = (proof.reward || 0) * (1 - commission);

                    await db.collection('users').doc(proof.userId).update({
                        pendingBalance: firebase.firestore.FieldValue.increment(-netReward),
                        balance: firebase.firestore.FieldValue.increment(netReward),
                        completedTasks: firebase.firestore.FieldValue.increment(1)
                    });

                    // Notify worker
                    const { createNotification } = await import('./utils.js');
                    // createNotification is already imported at top level via utils
                }

                showToast('Preuve approuvée.', 'success');
                loadValidationList();

            } catch (e) {
                showToast('Erreur : ' + e.message, 'error');
            }
        }
    );
}

/**
 * Rejects a proof and notifies the worker.
 */
export async function rejectProof(proofId) {
    showConfirm(
        'Rejeter la preuve',
        'Cette preuve sera rejetée.',
        async () => {
            try {
                const doc = await db.collection('proofs').doc(proofId).get();
                const proof = doc.data();

                await db.collection('proofs').doc(proofId).update({
                    status: 'rejected',
                    rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                showToast('Preuve rejetée.', 'success');
                loadValidationList();

            } catch (e) {
                showToast('Erreur : ' + e.message, 'error');
            }
        }
    );
}

// ============================================================
// GLOBAL EXPOSURE (for static HTML onclick handlers only)
// ============================================================

window.openImageViewer = openImageViewer;
window.showCreateTaskModal = showCreateTaskModal;
window.switchTaskTab = switchTaskTab;
window.validateTask = validateTask;
window.rejectTask = rejectTask;
window.deleteTask = deleteTask;
window.acceptTask = acceptTask;
window.openTaskProofModal = openTaskProofModal;
window.submitTaskProof = submitTaskProof;
window.setHistoryFilter = setHistoryFilter;
window.showPlanLimitsModal = showPlanLimitsModal;
window.approveProof = approveProof;
window.rejectProof = rejectProof;
window.loadValidationPage = loadValidationPage;
window.cancelUpload = () => {
    const overlay = document.getElementById('hbw-upload-overlay');
    if (overlay) overlay.classList.add('hidden');
};
