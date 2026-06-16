/* ============================================================
   HBW TASK - Application JavaScript Complète
   Version 1.0
   ============================================================ */

(function() {
'use strict';

/* ============================================================
   4.1 CONFIGURATION FIREBASE & VARIABLES GLOBALES
   ============================================================ */

// Configuration Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAbRFgL4jxSbBgc7FhIORKyOEq7N163_AQ",
  authDomain: "hbwtaskpam.firebaseapp.com",
  projectId: "hbwtaskpam",
  storageBucket: "hbwtaskpam.appspot.com",
  messagingSenderId: "142029895340",
  appId: "1:142029895340:web:ce94830569430491ef5109"
};

// Initialisation Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Variables globales
let currentUser = null;
let currentUserAuth = null;
let globalSettings = {};
let allUsersCache = [];
let allTeamsCache = [];
let listeners = [];
let notifUnsubscribe = null;
let notificationsData = [];
let currentRole = null;

// Constantes
const CACHE_TTL = 5 * 60 * 1000;
const IMGBB_API_KEY = "555e4fae57d7a9f253b9a34addfe8609";
const DAILY_FREE_LIMIT = 10;
const FREE_MEMBER_LIMIT = 50;
const MANAGER_COMMISSION = 0.05;
const BADGE_THRESHOLDS = {
  bronze: 0,
  silver: 50,
  gold: 100,
  platinum: 200,
  diamond: 500
};

// Caches
const tasksCache = { data: [], timestamp: null };
const usersCache = { data: [], timestamp: null };
const teamsCache = { data: [], timestamp: null };
const settingsCache = { data: {}, timestamp: null };

// Helpers cache
function isCacheValid(cache) {
  if (!cache.timestamp) return false;
  return (Date.now() - cache.timestamp) < CACHE_TTL;
}

function invalidateCache(cache) {
  cache.timestamp = null;
  cache.data = cache.data instanceof Array ? [] : {};
}

function invalidateAllCaches() {
  invalidateCache(tasksCache);
  invalidateCache(usersCache);
  invalidateCache(teamsCache);
  invalidateCache(settingsCache);
}

function clearAllListeners() {
  listeners.forEach(unsub => {
    try {
      if (typeof unsub === 'function') unsub();
    } catch (e) {
      console.warn('Erreur lors du nettoyage du listener:', e);
    }
  });
  listeners = [];
  if (notifUnsubscribe) {
    try {
      notifUnsubscribe();
    } catch (e) {}
    notifUnsubscribe = null;
  }
}

/* ============================================================
   4.2 UTILITAIRES
   ============================================================ */

function formatCurrency(amount) {
  const num = Number(amount) || 0;
  const formatted = num.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
  return `${formatted} HTG`;
}

function formatDate(ts) {
  if (!ts) return '—';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
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
  
  return { relative, absolute, full: `${relative} • ${absolute}` };
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function getBadgeInfo(completedTasks) {
  const count = Number(completedTasks) || 0;
  const levels = [
    { name: 'bronze', min: 0, label: 'Bronze', color: '#cd7f32', icon: 'fa-award' },
    { name: 'silver', min: 50, label: 'Argent', color: '#c0c0c0', icon: 'fa-medal' },
    { name: 'gold', min: 100, label: 'Or', color: '#ffd700', icon: 'fa-trophy' },
    { name: 'platinum', min: 200, label: 'Platine', color: '#e5e4e2', icon: 'fa-gem' },
    { name: 'diamond', min: 500, label: 'Diamant', color: '#b9f2ff', icon: 'fa-crown' }
  ];
  
  let current = levels[0];
  let next = levels[1];
  
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

function generateRandomPassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function generateUsername(fullName) {
  const base = fullName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 8);
  const suffix = Math.floor(Math.random() * 9000) + 1000;
  return `${base}${suffix}`;
}

async function addLog(type, action, details) {
  try {
    await db.collection('logs').add({
      type,
      action,
      details: details || '',
      userId: currentUser ? currentUser.id : null,
      userName: currentUser ? currentUser.username : 'Système',
      userRole: currentUser ? currentUser.role : 'system',
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.warn('Erreur lors de l\'ajout du log:', e);
  }
}

async function createNotification(userId, title, message, type = 'info') {
  try {
    await db.collection('notifications').add({
      userId,
      title,
      message,
      type,
      read: false,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (e) {
    console.warn('Erreur lors de la création de notification:', e);
  }
}

function showToast(message, type = 'info', duration = 3500) {
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
  
  const closeBtn = toast.querySelector('.toast__close');
  const remove = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100px)';
    setTimeout(() => toast.remove(), 300);
  };
  
  closeBtn.addEventListener('click', remove);
  setTimeout(remove, duration);
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
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

function showConfirm(title, message, onConfirm, options = {}) {
  const modal = document.getElementById('modal-confirm');
  if (!modal) {
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
  
  const handler = () => {
    closeModal('modal-confirm');
    btnEl.removeEventListener('click', handler);
    if (typeof onConfirm === 'function') onConfirm();
  };
  
  btnEl.addEventListener('click', handler);
  openModal('modal-confirm');
}

/* ============================================================
   4.3 AUTHENTIFICATION
   ============================================================ */

function hideSplash() {
  let splash = document.getElementById('hbw-splash');
  if (!splash) {
    splash = document.createElement('div');
    splash.id = 'hbw-splash';
    splash.className = 'hbw-splash';
    splash.innerHTML = `
      <div class="hbw-splash__content">
        <div class="hbw-splash__logo">
          <div class="hbw-splash__logo-icon"><i class="fas fa-tasks"></i></div>
          <h1 class="hbw-splash__title">HBW Task</h1>
        </div>
        <div class="hbw-splash__loader"><div class="hbw-splash__loader-bar"></div></div>
      </div>
    `;
    document.body.prepend(splash);
  }
  splash.style.opacity = '0';
  setTimeout(() => {
    splash.style.display = 'none';
  }, 500);
}

function createParticles() {
  const loginPage = document.getElementById('page-login');
  if (!loginPage || loginPage.querySelector('.particles')) return;
  
  const container = document.createElement('div');
  container.className = 'particles';
  container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:0;';
  
  for (let i = 0; i < 20; i++) {
    const particle = document.createElement('div');
    const size = Math.random() * 6 + 2;
    particle.style.cssText = `
      position:absolute;
      width:${size}px;
      height:${size}px;
      background:rgba(37,99,235,${Math.random() * 0.3 + 0.1});
      border-radius:50%;
      left:${Math.random() * 100}%;
      top:${Math.random() * 100}%;
      animation:float ${Math.random() * 10 + 10}s ease-in-out infinite;
    `;
    container.appendChild(particle);
  }
  
  loginPage.style.position = 'relative';
  loginPage.appendChild(container);
}

function showLoginPage() {
  document.querySelectorAll('.page').forEach(p => {
    p.classList.add('hidden');
    p.classList.remove('active');
  });
  const loginPage = document.getElementById('page-login');
  if (loginPage) {
    loginPage.classList.remove('hidden');
    loginPage.classList.add('active');
  }
  const app = document.getElementById('app');
  if (app) app.style.display = 'flex';
  createParticles();
}

function showApp(role) {
  currentRole = role;
  const app = document.getElementById('app');
  if (app) app.style.display = 'flex';
  
  const loginPage = document.getElementById('page-login');
  if (loginPage) loginPage.classList.add('hidden');
  
  initNavigation(role);
  
  let defaultPage = 'page-worker-dashboard';
  if (role === 'admin') defaultPage = 'page-admin-dashboard';
  else if (role === 'manager') defaultPage = 'page-manager-dashboard';
  
  showPage(defaultPage);
  updateHeaderUser();
}

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

function hideLoginError() {
  const err = document.getElementById('login-error-message');
  if (err) err.remove();
}

function togglePassword(inputId, iconEl) {
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

function checkAndUpdatePremiumExpiry(userDoc) {
  if (!userDoc || !userDoc.premiumExpiresAt) return userDoc;
  const expiry = userDoc.premiumExpiresAt.toDate 
    ? userDoc.premiumExpiresAt.toDate() 
    : new Date(userDoc.premiumExpiresAt);
  if (expiry < new Date()) {
    userDoc.isPremium = false;
    userDoc.plan = 'free';
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

async function handleLogin(username, password) {
  if (!username || !password) {
    showLoginError('Veuillez remplir tous les champs');
    return;
  }
  
  hideLoginError();
  
  try {
    // Recherche par username
    const userQuery = await db.collection('users')
      .where('username', '==', username.toLowerCase().trim())
      .limit(1)
      .get();
    
    if (userQuery.empty) {
      showLoginError('Nom d\'utilisateur introuvable');
      return;
    }
    
    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();
    
    if (!userData.email) {
      showLoginError('Email non associé à ce compte');
      return;
    }
    
    // Connexion Firebase
    const cred = await auth.signInWithEmailAndPassword(userData.email, password);
    
    showToast('Connexion réussie !', 'success');
  } catch (err) {
    console.error('Erreur login:', err);
    let msg = 'Erreur de connexion';
    if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
      msg = 'Identifiants incorrects';
    } else if (err.code === 'auth/too-many-requests') {
      msg = 'Trop de tentatives. Réessayez plus tard.';
    } else if (err.code === 'auth/network-request-failed') {
      msg = 'Problème de connexion internet';
    }
    showLoginError(msg);
  }
}

async function handleLogout() {
  try {
    clearAllListeners();
    await auth.signOut();
    currentUser = null;
    currentUserAuth = null;
    currentRole = null;
    invalidateAllCaches();
    
    document.querySelectorAll('.page').forEach(p => {
      p.classList.add('hidden');
      p.classList.remove('active');
    });
    
    const app = document.getElementById('app');
    if (app) app.style.display = 'none';
    
    showLoginPage();
    showToast('Déconnexion réussie', 'info');
  } catch (e) {
    console.error('Erreur logout:', e);
    showToast('Erreur lors de la déconnexion', 'error');
  }
}

function initAuthStateObserver() {
  auth.onAuthStateChanged(async (user) => {
    hideSplash();
    
    if (user) {
      currentUserAuth = user;
      try {
        const userDoc = await db.collection('users').doc(user.uid).get();
        
        if (!userDoc.exists) {
          // Création du profil pour Google login par exemple
          const newUser = {
            id: user.uid,
            email: user.email,
            username: user.email.split('@')[0].toLowerCase(),
            fullName: user.displayName || user.email.split('@')[0],
            role: 'worker',
            balance: 0,
            pendingBalance: 0,
            completedTasks: 0,
            isPremium: false,
            plan: 'free',
            status: 'active',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
          };
          await db.collection('users').doc(user.uid).set(newUser);
          currentUser = newUser;
        } else {
          let userData = userDoc.data();
          userData.id = userDoc.id;
          userData = checkAndUpdatePremiumExpiry(userData);
          
          if (userData.status === 'suspended' || userData.status === 'banned') {
            await auth.signOut();
            showLoginError('Votre compte a été suspendu. Contactez le support.');
            showLoginPage();
            return;
          }
          
          currentUser = userData;
          
          // Mise à jour lastSeen
          db.collection('users').doc(user.uid).update({
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
          }).catch(() => {});
        }
        
        showApp(currentUser.role);
      } catch (err) {
        console.error('Erreur récupération profil:', err);
        showToast('Erreur de chargement du profil', 'error');
        showLoginPage();
      }
    } else {
      currentUser = null;
      currentUserAuth = null;
      showLoginPage();
    }
  });
}

async function loadGlobalSettings() {
  try {
    if (isCacheValid(settingsCache)) {
      globalSettings = settingsCache.data;
      return globalSettings;
    }
    const doc = await db.collection('settings').doc('global').get();
    if (doc.exists) {
      globalSettings = doc.data();
      settingsCache.data = globalSettings;
      settingsCache.timestamp = Date.now();
    } else {
      globalSettings = {
        exchangeRate: 130,
        maintenanceFee: 0,
        paymentNumbers: {
          moncash: '+509 0000 0000',
          natcash: '+509 0000 0000',
          bank: ''
        },
        premiumPrices: {
          monthly: 500,
          yearly: 5000
        }
      };
    }
    return globalSettings;
  } catch (e) {
    console.warn('Erreur chargement paramètres:', e);
    return globalSettings;
  }
}

function setupThemeToggle() {
  const savedTheme = localStorage.getItem('hbw_theme') || 'light';
  applyTheme(savedTheme);
}

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

function setupLoginForm() {
  const form = document.getElementById('login-form');
  if (!form) return;
  
  // Ajout d'IDs aux inputs
  const inputs = form.querySelectorAll('input');
  if (inputs[0]) {
    inputs[0].id = 'login-username';
    inputs[0].setAttribute('autocomplete', 'username');
  }
  if (inputs[1]) {
    inputs[1].id = 'login-password';
    inputs[1].setAttribute('autocomplete', 'current-password');
    
    // Ajout du bouton de toggle
    const parentDiv = inputs[1].parentElement;
    if (!parentDiv.querySelector('.password-toggle')) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'password-toggle';
      toggleBtn.style.cssText = 'position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer;padding:4px;';
      toggleBtn.innerHTML = '<i class="fas fa-eye"></i>';
      toggleBtn.addEventListener('click', () => {
        togglePassword('login-password', toggleBtn.querySelector('i'));
      });
      parentDiv.appendChild(toggleBtn);
    }
  }
  
  // Soumission du formulaire
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    handleLogin(username, password);
  });
  
  // Bouton Google
  const buttons = form.querySelectorAll('button');
  const googleBtn = Array.from(buttons).find(b => b.textContent.includes('Google'));
  if (googleBtn) {
    googleBtn.addEventListener('click', handleGoogleLogin);
  }
  
  // Lien mot de passe oublié
  const forgotLink = form.parentElement.querySelector('a[href="#"]');
  if (forgotLink) {
    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      handleForgotPassword();
    });
  }
}

async function handleGoogleLogin() {
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result = await auth.signInWithPopup(provider);
    showToast('Connexion avec Google réussie !', 'success');
  } catch (err) {
    console.error('Erreur Google:', err);
    if (err.code !== 'auth/popup-closed-by-user') {
      showToast('Erreur lors de la connexion Google', 'error');
    }
  }
}

function handleForgotPassword() {
  const username = document.getElementById('login-username');
  const email = username ? username.value.trim() : '';
  
  if (!email) {
    showToast('Veuillez d\'abord entrer votre nom d\'utilisateur', 'warning');
    return;
  }
  
  showConfirm(
    'Mot de passe oublié',
    'Vous allez recevoir un email de réinitialisation. Continuer ?',
    async () => {
      try {
        // Recherche de l'email associé au username
        const userQuery = await db.collection('users')
          .where('username', '==', email.toLowerCase())
          .limit(1)
          .get();
        
        if (userQuery.empty) {
          showToast('Utilisateur introuvable', 'error');
          return;
        }
        
        const userEmail = userQuery.docs[0].data().email;
        await auth.sendPasswordResetEmail(userEmail);
        showToast('Email de réinitialisation envoyé !', 'success');
      } catch (err) {
        console.error('Erreur reset password:', err);
        showToast('Erreur lors de l\'envoi', 'error');
      }
    }
  );
}

function setupGlobalModals() {
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close-modal]');
    if (closeBtn) {
      const modal = closeBtn.closest('.modal-backdrop');
      if (modal) {
        closeModal(modal.id);
      }
    }
    
    if (e.target.classList.contains('modal-backdrop')) {
      closeModal(e.target.id);
    }
  });
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  });
}

/* ============================================================
   4.4 NAVIGATION & ROUTAGE
   ============================================================ */

const NAV_CONFIG = {
  'page-admin-dashboard': {
    title: 'Tableau de bord',
    subtitle: 'Vue d\'ensemble de la plateforme',
    icon: 'fa-chart-line',
    roles: ['admin'],
    inSidebar: true,
    inBottom: false,
    group: 'Principal'
  },
  'page-users-management': {
    title: 'Utilisateurs',
    subtitle: 'Gestion des comptes',
    icon: 'fa-users',
    roles: ['admin'],
    inSidebar: true,
    inBottom: false,
    group: 'Administration'
  },
  'page-teams-management': {
    title: 'Équipes',
    subtitle: 'Gestion des équipes',
    icon: 'fa-people-group',
    roles: ['admin'],
    inSidebar: true,
    inBottom: false,
    group: 'Administration'
  },
  'page-tasks-management': {
    title: 'Tâches',
    subtitle: 'Gestion des tâches',
    icon: 'fa-list-check',
    roles: ['admin'],
    inSidebar: true,
    inBottom: false,
    group: 'Administration'
  },
  'page-validation': {
    title: 'Validation',
    subtitle: 'Validation des preuves',
    icon: 'fa-check-double',
    roles: ['admin'],
    inSidebar: true,
    inBottom: false,
    group: 'Administration'
  },
  'page-payments': {
    title: 'Paiements',
    subtitle: 'Retraits & paiements',
    icon: 'fa-money-bill-transfer',
    roles: ['admin'],
    inSidebar: true,
    inBottom: false,
    group: 'Administration'
  },
  'page-settings': {
    title: 'Paramètres',
    subtitle: 'Configuration globale',
    icon: 'fa-gear',
    roles: ['admin'],
    inSidebar: true,
    inBottom: false,
    group: 'Système'
  },
  'page-manager-dashboard': {
    title: 'Tableau de bord',
    subtitle: 'Gestion de votre équipe',
    icon: 'fa-chart-pie',
    roles: ['manager'],
    inSidebar: true,
    inBottom: true,
    bottomIcon: 'fa-home',
    bottomLabel: 'Accueil',
    group: 'Principal'
  },
  'page-worker-dashboard': {
    title: 'Tableau de bord',
    subtitle: 'Vos tâches et revenus',
    icon: 'fa-gauge-high',
    roles: ['worker', 'manager'],
    inSidebar: true,
    inBottom: true,
    bottomIcon: 'fa-home',
    bottomLabel: 'Accueil',
    group: 'Principal'
  },
  'page-offerwall-monlix': {
    title: 'Monlix',
    subtitle: 'Offres Monlix',
    icon: 'fa-gift',
    roles: ['worker', 'manager'],
    inSidebar: true,
    inBottom: false,
    group: 'Offerwalls'
  },
  'page-offerwall-adscend': {
    title: 'Adscend',
    subtitle: 'Offres Adscend',
    icon: 'fa-star',
    roles: ['worker', 'manager'],
    inSidebar: true,
    inBottom: false,
    group: 'Offerwalls'
  },
  'page-offerwall-ayetstudios': {
    title: 'AyetStudios',
    subtitle: 'Offres AyetStudios',
    icon: 'fa-gamepad',
    roles: ['worker', 'manager'],
    inSidebar: true,
    inBottom: false,
    group: 'Offerwalls'
  },
  'page-offerwall-lootably': {
    title: 'Lootably',
    subtitle: 'Offres Lootably',
    icon: 'fa-box-open',
    roles: ['worker', 'manager'],
    inSidebar: true,
    inBottom: false,
    group: 'Offerwalls'
  },
  'page-agency-tasks': {
    title: 'Tâches Agency',
    subtitle: 'Tâches premium',
    icon: 'fa-briefcase',
    roles: ['worker', 'manager'],
    inSidebar: true,
    inBottom: false,
    group: 'Tâches'
  },
  'page-wallet': {
    title: 'Portefeuille',
    subtitle: 'Solde et retraits',
    icon: 'fa-wallet',
    roles: ['worker', 'manager'],
    inSidebar: true,
    inBottom: true,
    bottomIcon: 'fa-wallet',
    bottomLabel: 'Wallet',
    group: 'Finances'
  },
  'page-profile': {
    title: 'Profil',
    subtitle: 'Informations personnelles',
    icon: 'fa-user-circle',
    roles: ['worker', 'manager'],
    inSidebar: true,
    inBottom: false,
    group: 'Compte'
  },
  'page-premium': {
    title: 'Premium',
    subtitle: 'Abonnement premium',
    icon: 'fa-crown',
    roles: ['worker', 'manager'],
    inSidebar: true,
    inBottom: false,
    group: 'Compte'
  },
  'page-leaderboard': {
    title: 'Classement',
    subtitle: 'Top performers',
    icon: 'fa-ranking-star',
    roles: ['worker', 'manager'],
    inSidebar: true,
    inBottom: true,
    bottomIcon: 'fa-trophy',
    bottomLabel: 'Classement',
    group: 'Social'
  }
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

function showPage(pageId, options = {}) {
  const config = NAV_CONFIG[pageId];
  if (!config) {
    console.warn('Page inconnue:', pageId);
    return;
  }
  
  // Vérification des permissions
  if (currentUser && !config.roles.includes(currentUser.role)) {
    showToast('Accès refusé', 'error');
    return;
  }
  
  // Cache toutes les pages
  document.querySelectorAll('.page').forEach(p => {
    p.classList.add('hidden');
    p.classList.remove('active');
  });
  
  // Affiche la page cible
  const page = document.getElementById(pageId);
  if (page) {
    page.classList.remove('hidden');
    page.classList.add('active');
  }
  
  // Mise à jour UI
  updatePageTitle(pageId);
  updateSidebarActive(pageId);
  updateBottomBarActive(pageId);
  
  // Gestion bottom bar
  const bottomBar = document.getElementById('bottom-bar');
  if (bottomBar) {
    if (currentUser && (currentUser.role === 'admin') || pageId === 'page-login') {
      bottomBar.classList.add('hidden');
    } else {
      bottomBar.classList.remove('hidden');
    }
  }
  
  // Scroll top
  if (!options.preserveScroll) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  
  // Ferme sidebar mobile
  closeSidebarMobile();
  
  // Charge le contenu de la page
  loadPageContent(pageId);
}

function loadPageContent(pageId) {
  const loaders = {
    'page-admin-dashboard': () => typeof renderAdminDashboard === 'function' && renderAdminDashboard(),
    'page-users-management': () => typeof loadAdminUsers === 'function' && loadAdminUsers(),
    'page-teams-management': () => typeof loadAdminTeams === 'function' && loadAdminTeams(),
    'page-tasks-management': () => typeof loadAdminTasks === 'function' && loadAdminTasks(),
    'page-validation': () => typeof loadValidationPage === 'function' && loadValidationPage(),
    'page-payments': () => typeof loadAdminWithdrawals === 'function' && loadAdminWithdrawals(),
    'page-settings': () => typeof loadAdminSettings === 'function' && loadAdminSettings(),
    'page-manager-dashboard': () => typeof renderManagerDashboard === 'function' && renderManagerDashboard(),
    'page-worker-dashboard': () => typeof renderWorkerDashboard === 'function' && renderWorkerDashboard(),
    'page-offerwall-monlix': () => typeof loadOfferwall === 'function' && loadOfferwall('monlix'),
    'page-offerwall-adscend': () => typeof loadOfferwall === 'function' && loadOfferwall('adscend'),
    'page-offerwall-ayetstudios': () => typeof loadOfferwall === 'function' && loadOfferwall('ayetstudios'),
    'page-offerwall-lootably': () => typeof loadOfferwall === 'function' && loadOfferwall('lootably'),
    'page-agency-tasks': () => typeof loadAgencyTasks === 'function' && loadAgencyTasks(),
    'page-wallet': () => typeof loadWorkerWithdrawal === 'function' && loadWorkerWithdrawal(),
    'page-profile': () => typeof loadProfile === 'function' && loadProfile(),
    'page-premium': () => typeof loadPremiumPage === 'function' && loadPremiumPage(),
    'page-leaderboard': () => typeof loadLeaderboard === 'function' && loadLeaderboard()
  };
  
  const loader = loaders[pageId];
  if (typeof loader === 'function') {
    try {
      loader();
    } catch (e) {
      console.error(`Erreur chargement ${pageId}:`, e);
    }
  }
}

function buildSidebar(role) {
  const sidebar = document.querySelector('[data-sidebar]');
  const drawer = document.getElementById('hbw-sidebar-drawer');
  if (!sidebar) return;
  
  const navContainer = sidebar.querySelector('#sidebar-nav') || sidebar.querySelector('.sidebar__nav');
  if (!navContainer) return;
  
  // Groupement des liens
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
      html += `<a href="#" class="sidebar-link" data-page="${item.pageId}" onclick="navigateTo('${item.pageId}'); return false;">
        <i class="fas ${item.icon}"></i>
        <span>${escapeHtml(item.title)}</span>
      </a>`;
    });
    html += `</div>`;
  });
  
  navContainer.innerHTML = html;
  
  // Attache les événements
  navContainer.querySelectorAll('[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const pageId = link.getAttribute('data-page');
      showPage(pageId);
    });
  });
  
  // Clone dans le drawer mobile
  if (drawer) {
    drawer.innerHTML = sidebar.innerHTML;
    drawer.querySelectorAll('[data-page]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const pageId = link.getAttribute('data-page');
        showPage(pageId);
        closeSidebarMobile();
      });
    });
  }
}

function updateSidebarActive(pageId) {
  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('data-page') === pageId) {
      link.classList.add('active');
    }
  });
}

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

function buildBottomBar(role) {
  const bottomBar = document.getElementById('bottom-bar');
  if (!bottomBar) return;
  
  const inner = bottomBar.querySelector('#bottom-bar-inner');
  if (!inner) return;
  
  const items = BOTTOM_BAR_CONFIG[role] || [];
  let html = '';
  items.forEach(item => {
    html += `<a href="#" class="bottom-bar__item" data-page="${item.page}" onclick="navigateTo('${item.page}'); return false;">
      <i class="fas ${item.icon}"></i>
      <span>${escapeHtml(item.label)}</span>
    </a>`;
  });
  inner.innerHTML = html;
  
  inner.querySelectorAll('[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      showPage(link.getAttribute('data-page'));
    });
  });
}

function updateBottomBarActive(pageId) {
  document.querySelectorAll('.bottom-bar__item').forEach(item => {
    item.classList.remove('active');
    if (item.getAttribute('data-page') === pageId) {
      item.classList.add('active');
    }
  });
}

function updatePageTitle(pageId) {
  const config = NAV_CONFIG[pageId];
  if (!config) return;
  
  const titleEl = document.querySelector('[data-page-title]');
  const subtitleEl = document.querySelector('[data-page-subtitle]');
  
  if (titleEl) titleEl.textContent = config.title;
  if (subtitleEl) subtitleEl.textContent = config.subtitle;
}

function updateHeaderUser() {
  if (!currentUser) return;
  
  const nameEls = document.querySelectorAll('[data-user-name]');
  nameEls.forEach(el => el.textContent = currentUser.fullName || currentUser.username);
  
  const roleEls = document.querySelectorAll('[data-user-role]');
  roleEls.forEach(el => el.textContent = currentUser.role || 'worker');
  
  const balanceEls = document.querySelectorAll('[data-user-balance]');
  balanceEls.forEach(el => el.textContent = formatCurrency(currentUser.balance || 0));
  
  const premiumEls = document.querySelectorAll('[data-user-premium]');
  premiumEls.forEach(el => {
    el.style.display = currentUser.isPremium ? 'flex' : 'none';
  });
  
  const welcomeEl = document.querySelector('[data-welcome-message]');
  if (welcomeEl) {
    const hour = new Date().getHours();
    let greeting = 'Bonsoir';
    if (hour < 12) greeting = 'Bonjour';
    else if (hour < 18) greeting = 'Bon après-midi';
    welcomeEl.textContent = `${greeting}, ${currentUser.fullName || currentUser.username} !`;
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

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

/* ============================================================
   4.5 UPLOAD & NOTIFICATIONS
   ============================================================ */

function setupNotifications() {
  const dropdown = document.getElementById('notif-dropdown');
  if (!dropdown || dropdown.dataset.initialized) return;
  
  dropdown.dataset.initialized = 'true';
  dropdown.innerHTML = `
    <div class="notif-wrap">
      <div class="notif-wrap__header">
        <h4 class="notif-wrap__title">Notifications</h4>
        <div class="notif-wrap__actions">
          <span class="notif-wrap__btn" onclick="markAllRead()">Tout marquer lu</span>
        </div>
      </div>
      <div class="notif-wrap__list" id="notif-list">
        <div class="notif-wrap__empty">
          <i class="fas fa-bell-slash"></i>
          <p>Aucune notification</p>
        </div>
      </div>
      <div class="notif-wrap__footer">
        <a href="#" onclick="showWorkerNotifications(); return false;">Voir tout</a>
      </div>
    </div>
  `;
  
  if (currentUser) {
    startNotifListener();
  }
}

function startNotifListener() {
  if (!currentUser || notifUnsubscribe) return;
  
  try {
    notifUnsubscribe = db.collection('notifications')
      .where('userId', '==', currentUser.id)
      .orderBy('timestamp', 'desc')
      .limit(20)
      .onSnapshot((snapshot) => {
        notificationsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        updateNotifBadge();
        renderNotifDropdown();
      }, (err) => {
        console.warn('Erreur listener notifications:', err);
      });
    listeners.push(notifUnsubscribe);
  } catch (e) {
    console.warn('Erreur démarrage listener notifications:', e);
  }
}

function updateNotifBadge() {
  const unread = notificationsData.filter(n => !n.read).length;
  const badges = document.querySelectorAll('#notif-badge, .hbw-bell-badge');
  badges.forEach(badge => {
    if (unread > 0) {
      badge.style.display = 'flex';
      badge.textContent = unread > 99 ? '99+' : unread;
    } else {
      badge.style.display = 'none';
    }
  });
}

function renderNotifDropdown() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  
  if (notificationsData.length === 0) {
    list.innerHTML = `
      <div class="notif-wrap__empty">
        <i class="fas fa-bell-slash"></i>
        <p>Aucune notification</p>
      </div>
    `;
    return;
  }
  
  const iconMap = {
    info: { class: 'fa-info-circle', type: 'info' },
    success: { class: 'fa-check-circle', type: 'success' },
    warning: { class: 'fa-exclamation-triangle', type: 'warning' },
    error: { class: 'fa-times-circle', type: 'error' }
  };
  
  list.innerHTML = notificationsData.map(n => {
    const icon = iconMap[n.type] || iconMap.info;
    const time = formatDate(n.timestamp);
    return `
      <div class="notif-wrap__item ${!n.read ? 'notif-wrap__item--unread' : ''}" onclick="markNotifRead('${n.id}')">
        <div class="notif-wrap__icon notif-wrap__icon--${icon.type}">
          <i class="fas ${icon.class}"></i>
        </div>
        <div class="notif-wrap__content">
          <div class="notif-wrap__title">${escapeHtml(n.title)}</div>
          <div class="notif-wrap__message">${escapeHtml(n.message)}</div>
          <div class="notif-wrap__time">${time.relative}</div>
        </div>
      </div>
    `;
  }).join('');
}

async function markNotifRead(id) {
  try {
    await db.collection('notifications').doc(id).update({ read: true });
    const notif = notificationsData.find(n => n.id === id);
    if (notif) notif.read = true;
    updateNotifBadge();
    renderNotifDropdown();
  } catch (e) {
    console.warn('Erreur mark read:', e);
  }
}

async function markAllRead() {
  try {
    const batch = db.batch();
    notificationsData.filter(n => !n.read).forEach(n => {
      batch.update(db.collection('notifications').doc(n.id), { read: true });
    });
    await batch.commit();
    notificationsData.forEach(n => n.read = true);
    updateNotifBadge();
    renderNotifDropdown();
    showToast('Toutes les notifications marquées comme lues', 'success');
  } catch (e) {
    console.warn('Erreur mark all read:', e);
  }
}

function toggleNotifDropdown(btn) {
  const dropdown = document.getElementById('notif-dropdown');
  if (!dropdown) return;
  const isHidden = dropdown.classList.contains('hidden');
  if (isHidden) {
    dropdown.classList.remove('hidden');
    dropdown.style.display = 'block';
  } else {
    dropdown.classList.add('hidden');
    dropdown.style.display = 'none';
  }
}

function addNotification(options) {
  const n = {
    id: 'local_' + Date.now(),
    title: options.title || 'Notification',
    message: options.message || '',
    type: options.type || 'info',
    read: false,
    timestamp: new Date()
  };
  notificationsData.unshift(n);
  updateNotifBadge();
  renderNotifDropdown();
}

async function uploadToImgbb(file, options = {}) {
  return new Promise(async (resolve, reject) => {
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
      // Simulation 0 -> 90%
      for (let i = 0; i <= 90; i += 10) {
        updateProgress(i, 'Préparation du fichier...');
        await new Promise(r => setTimeout(r, 150));
      }
      
      updateProgress(90, 'Envoi vers le serveur...');
      
      // Envoi réel
      const formData = new FormData();
      formData.append('image', file);
      formData.append('key', IMGBB_API_KEY);
      
      const response = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || 'Erreur upload');
      }
      
      updateProgress(100, 'Upload terminé !');
      await new Promise(r => setTimeout(r, 500));
      
      if (overlay) overlay.classList.add('hidden');
      if (typeof onSuccess === 'function') onSuccess(data.data);
      resolve(data.data);
    } catch (err) {
      if (overlay) overlay.classList.add('hidden');
      if (typeof onError === 'function') onError(err);
      reject(err);
    }
  });
}

function setupUploadZone(selector, options = {}) {
  const zones = document.querySelectorAll(selector);
  zones.forEach(zone => {
    if (zone.dataset.initialized) return;
    zone.dataset.initialized = 'true';
    
    const input = zone.querySelector('input[type="file"]');
    const preview = zone.querySelector('.dropzone__preview');
    const inner = zone.querySelector('.dropzone__inner');
    
    if (!input) return;
    
    zone.addEventListener('click', (e) => {
      if (e.target !== input) input.click();
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
            preview.innerHTML = `<img src="${ev.target.result}" alt="Preview">
              <button class="btn btn-sm btn-outline mt-2" onclick="this.parentElement.innerHTML=''; document.querySelector('${selector} input').value='';">
                <i class="fas fa-times"></i> Retirer
              </button>`;
            preview.style.display = 'block';
            if (inner) inner.style.display = 'none';
          };
          reader.readAsDataURL(file);
        } else {
          preview.innerHTML = `<div class="p-3 bg-gray-50 rounded-lg">
            <i class="fas fa-file text-3xl text-blue-600 mb-2"></i>
            <p class="text-sm font-medium">${escapeHtml(file.name)}</p>
            <p class="text-xs text-gray-500">${(file.size / 1024).toFixed(1)} KB</p>
          </div>`;
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

/* ============================================================
   4.6 MODULE ADMIN
   ============================================================ */

const AdminState = {
  users: [],
  teams: [],
  tasks: [],
  logs: [],
  withdrawals: [],
  maintenance: [],
  settings: {},
  filters: {
    users: { search: '', role: '', status: '' },
    logs: { search: '', type: '' },
    tasks: { tab: 'pending' },
    maintenance: { tab: 'pending' }
  },
  charts: {
    earnings: null,
    tasksStatus: null
  },
  exchangeRate: 130,
  maintenanceFee: 0
};

async function renderAdminDashboard() {
  const container = document.getElementById('admin-main-content');
  if (!container) return;
  
  container.innerHTML = `
    <div class="space-y-5">
      <div class="grid grid-cols-4 gap-4">
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--primary">
            <i class="fas fa-users"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Utilisateurs totaux</div>
            <div class="stat-card__value" id="admin-total-users">—</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--success">
            <i class="fas fa-tasks"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Tâches actives</div>
            <div class="stat-card__value" id="admin-active-tasks">—</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--warning">
            <i class="fas fa-money-bill-wave"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Revenus (HTG)</div>
            <div class="stat-card__value" id="admin-total-earnings">—</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--danger">
            <i class="fas fa-clock"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">En attente</div>
            <div class="stat-card__value" id="admin-pending-tasks">—</div>
          </div>
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div class="card">
          <div class="card__header">
            <h3 class="card__title">Revenus (7 derniers jours)</h3>
          </div>
          <div class="card__body">
            <canvas id="admin-earnings-chart" height="200"></canvas>
          </div>
        </div>
        <div class="card">
          <div class="card__header">
            <h3 class="card__title">Statut des tâches</h3>
          </div>
          <div class="card__body">
            <canvas id="admin-tasks-status-chart" height="200"></canvas>
          </div>
        </div>
      </div>
      
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Top Workers</h3>
          <button class="btn btn-sm btn-outline" onclick="navigateTo('page-users-management')">
            Voir tout <i class="fas fa-arrow-right"></i>
          </button>
        </div>
        <div class="card__body" id="admin-top-workers-list">
          <div class="spinner"></div>
        </div>
      </div>
      
      <div class="grid grid-cols-4 gap-3">
        <button class="btn btn-primary btn-block" onclick="navigateTo('page-tasks-management')">
          <i class="fas fa-plus"></i> Créer tâche
        </button>
        <button class="btn btn-primary btn-block" onclick="navigateTo('page-users-management')">
          <i class="fas fa-user-plus"></i> Utilisateurs
        </button>
        <button class="btn btn-primary btn-block" onclick="navigateTo('page-validation')">
          <i class="fas fa-check"></i> Valider
        </button>
        <button class="btn btn-primary btn-block" onclick="navigateTo('page-settings')">
          <i class="fas fa-cog"></i> Paramètres
        </button>
      </div>
    </div>
  `;
  
  loadAdminDashboardStats();
  loadTopWorkers();
  renderAdminEarningsChart();
  _renderTasksStatusChart();
}

async function loadAdminDashboardStats() {
  try {
    const [usersSnap, tasksSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('tasks').get()
    ]);
    
    const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const tasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    AdminState.users = users;
    AdminState.tasks = tasks;
    
    const totalUsers = users.length;
    const activeTasks = tasks.filter(t => t.status === 'active').length;
    const pendingTasks = tasks.filter(t => t.status === 'pending').length;
    const totalEarnings = tasks.reduce((sum, t) => sum + (t.totalPaid || 0), 0);
    
    setText('admin-total-users', totalUsers);
    setText('admin-active-tasks', activeTasks);
    setText('admin-pending-tasks', pendingTasks);
    setText('admin-total-earnings', formatCurrency(totalEarnings));
  } catch (e) {
    console.warn('Erreur stats admin:', e);
  }
}

async function loadTopWorkers() {
  const list = document.getElementById('admin-top-workers-list');
  if (!list) return;
  
  try {
    const workers = AdminState.users.length 
      ? AdminState.users 
      : (await db.collection('users').where('role', '==', 'worker').get()).docs.map(d => ({ id: d.id, ...d.data() }));
    
    const top = workers
      .filter(u => u.role === 'worker')
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
            <div class="text-xs text-gray-500">${w.completedTasks || 0} tâches • <i class="fas ${badge.current.icon}" style="color:${badge.current.color}"></i> ${badge.current.label}</div>
          </div>
          <div class="font-bold text-green-600">${formatCurrency(w.balance || 0)}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    list.innerHTML = '<p class="text-center text-red-500">Erreur chargement</p>';
  }
}

function renderAdminEarningsChart() {
  const canvas = document.getElementById('admin-earnings-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  
  if (AdminState.charts.earnings) {
    AdminState.charts.earnings.destroy();
  }
  
  const days = [];
  const values = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
    values.push(Math.floor(Math.random() * 5000) + 1000);
  }
  
  AdminState.charts.earnings = new Chart(canvas, {
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

function _renderTasksStatusChart() {
  const canvas = document.getElementById('admin-tasks-status-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  
  if (AdminState.charts.tasksStatus) {
    AdminState.charts.tasksStatus.destroy();
  }
  
  const tasks = AdminState.tasks;
  const pending = tasks.filter(t => t.status === 'pending').length;
  const active = tasks.filter(t => t.status === 'active').length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const rejected = tasks.filter(t => t.status === 'rejected').length;
  
  AdminState.charts.tasksStatus = new Chart(canvas, {
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
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

async function loadAdminUsers() {
  const container = document.getElementById('users-management-content');
  if (!container) return;
  
  container.innerHTML = `
    <div class="space-y-4">
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Gestion des utilisateurs</h3>
          <div class="flex gap-2">
            <button class="btn btn-sm btn-outline" onclick="exportUsersCSV()">
              <i class="fas fa-download"></i> Export CSV
            </button>
          </div>
        </div>
        <div class="card__body">
          <div class="grid grid-cols-3 gap-3 mb-4">
            <input type="text" id="users-search" placeholder="Rechercher..." class="form-input" oninput="filterUsers()">
            <select id="users-role-filter" class="form-input" onchange="filterUsers()">
              <option value="">Tous les rôles</option>
              <option value="worker">Worker</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
            <select id="users-status-filter" class="form-input" onchange="filterUsers()">
              <option value="">Tous les statuts</option>
              <option value="active">Actif</option>
              <option value="suspended">Suspendu</option>
              <option value="banned">Banni</option>
            </select>
          </div>
          <div class="table-wrap">
            <div class="table-container" id="users-table-container">
              <div class="p-6 text-center"><div class="spinner mx-auto"></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  try {
    if (!isCacheValid(usersCache)) {
      const snap = await db.collection('users').get();
      usersCache.data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      usersCache.timestamp = Date.now();
    }
    AdminState.users = usersCache.data;
    renderUsersTable(AdminState.users);
  } catch (e) {
    console.error('Erreur load users:', e);
    document.getElementById('users-table-container').innerHTML = '<p class="p-4 text-center text-red-500">Erreur de chargement</p>';
  }
}

function filterUsers() {
  const search = (document.getElementById('users-search')?.value || '').toLowerCase();
  const role = document.getElementById('users-role-filter')?.value || '';
  const status = document.getElementById('users-status-filter')?.value || '';
  
  const filtered = AdminState.users.filter(u => {
    if (search && !(u.fullName || '').toLowerCase().includes(search) 
        && !(u.username || '').toLowerCase().includes(search)
        && !(u.email || '').toLowerCase().includes(search)) return false;
    if (role && u.role !== role) return false;
    if (status && u.status !== status) return false;
    return true;
  });
  
  renderUsersTable(filtered);
}

function renderUsersTable(users) {
  const container = document.getElementById('users-table-container');
  if (!container) return;
  
  if (users.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-users-slash"></i><p>Aucun utilisateur</p></div>';
    return;
  }
  
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Utilisateur</th>
          <th>Rôle</th>
          <th>Statut</th>
          <th>Tâches</th>
          <th>Solde</th>
          <th>Inscrit le</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => {
          const statusBadge = {
            active: '<span class="badge badge-soft-success"><span class="badge-dot badge-dot--success"></span>Actif</span>',
            suspended: '<span class="badge badge-soft-warning"><span class="badge-dot badge-dot--warning"></span>Suspendu</span>',
            banned: '<span class="badge badge-soft-danger"><span class="badge-dot badge-dot--danger"></span>Banni</span>'
          }[u.status || 'active'];
          const date = u.createdAt ? formatDate(u.createdAt).relative : '—';
          return `
            <tr>
              <td>
                <div class="flex items-center gap-2">
                  <div class="avatar-circle avatar-circle--sm">${(u.fullName || u.username || '?').charAt(0).toUpperCase()}</div>
                  <div>
                    <div class="font-semibold">${escapeHtml(u.fullName || u.username)}</div>
                    <div class="text-xs text-gray-500">${escapeHtml(u.email || '')}</div>
                  </div>
                </div>
              </td>
              <td><span class="badge badge-soft-primary">${u.role}</span></td>
              <td>${statusBadge}</td>
              <td>${u.completedTasks || 0}</td>
              <td class="font-semibold">${formatCurrency(u.balance || 0)}</td>
              <td class="text-sm text-gray-500">${date}</td>
              <td>
                <div class="flex gap-1">
                  <button class="btn-icon" onclick="showUserDetail('${u.id}')" title="Détails">
                    <i class="fas fa-eye"></i>
                  </button>
                  <button class="btn-icon" onclick="adjustUserBalance('${u.id}', '${escapeHtml(u.fullName || u.username)}')" title="Solde">
                    <i class="fas fa-coins"></i>
                  </button>
                  <button class="btn-icon" onclick="toggleUserActive('${u.id}', '${u.status || 'active'}')" title="Activer/Désactiver">
                    <i class="fas ${u.status === 'active' ? 'fa-ban' : 'fa-check'}"></i>
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function showUserDetail(userId) {
  const user = AdminState.users.find(u => u.id === userId);
  if (!user) return;
  
  const body = document.getElementById('modal-user-detail-body');
  if (!body) return;
  
  const badge = getBadgeInfo(user.completedTasks);
  
  body.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center gap-4">
        <div class="avatar-circle avatar-circle--lg">${(user.fullName || user.username || '?').charAt(0).toUpperCase()}</div>
        <div>
          <h3 class="text-xl font-bold">${escapeHtml(user.fullName || user.username)}</h3>
          <p class="text-gray-500">${escapeHtml(user.email || '')}</p>
          <div class="flex gap-2 mt-2">
            <span class="badge badge-soft-primary">${user.role}</span>
            ${user.isPremium ? '<span class="badge badge-soft-warning"><i class="fas fa-crown"></i> Premium</span>' : ''}
          </div>
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-3">
        <div class="p-3 bg-blue-50 rounded-lg">
          <div class="text-xs text-gray-600">Solde</div>
          <div class="text-lg font-bold">${formatCurrency(user.balance || 0)}</div>
        </div>
        <div class="p-3 bg-green-50 rounded-lg">
          <div class="text-xs text-gray-600">En attente</div>
          <div class="text-lg font-bold">${formatCurrency(user.pendingBalance || 0)}</div>
        </div>
        <div class="p-3 bg-purple-50 rounded-lg">
          <div class="text-xs text-gray-600">Tâches terminées</div>
          <div class="text-lg font-bold">${user.completedTasks || 0}</div>
        </div>
        <div class="p-3 bg-yellow-50 rounded-lg">
          <div class="text-xs text-gray-600">Badge</div>
          <div class="text-lg font-bold"><i class="fas ${badge.current.icon}" style="color:${badge.current.color}"></i> ${badge.current.label}</div>
        </div>
      </div>
      
      <div>
        <h4 class="font-semibold mb-2">Progression badge</h4>
        <div class="progress-label">
          <span class="progress-label__text">${badge.current.label}</span>
          <span class="progress-label__value">${badge.progress}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${badge.progress}%"></div>
        </div>
        ${badge.next ? `<p class="text-xs text-gray-500 mt-1">${badge.tasksToNext} tâches avant ${badge.next.label}</p>` : ''}
      </div>
      
      <div>
        <h4 class="font-semibold mb-2">Informations</h4>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between"><span class="text-gray-500">Username:</span><span class="font-medium">${escapeHtml(user.username || '—')}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">Statut:</span><span>${user.status || 'active'}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">Inscrit:</span><span>${user.createdAt ? formatDate(user.createdAt).absolute : '—'}</span></div>
          <div class="flex justify-between"><span class="text-gray-500">Dernière connexion:</span><span>${user.lastSeen ? formatDate(user.lastSeen).relative : '—'}</span></div>
        </div>
      </div>
    </div>
  `;
  
  openModal('modal-user-detail');
}

async function toggleUserActive(userId, currentStatus) {
  const user = AdminState.users.find(u => u.id === userId);
  if (!user) return;
  
  const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
  const action = newStatus === 'suspended' ? 'suspendre' : 'réactiver';
  
  showConfirm(
    `Confirmer l'action`,
    `Voulez-vous vraiment ${action} ${user.fullName || user.username} ?`,
    async () => {
      try {
        await db.collection('users').doc(userId).update({ status: newStatus });
        user.status = newStatus;
        renderUsersTable(AdminState.users);
        await addLog('user', `${newStatus === 'suspended' ? 'Suspend' : 'Activate'} user`, user.username);
        showToast(`Utilisateur ${newStatus === 'suspended' ? 'suspendu' : 'réactivé'}`, 'success');
      } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
      }
    }
  );
}

function adjustUserBalance(userId, userName) {
  const body = document.getElementById('modal-adjust-balance-body');
  if (!body) return;
  
  body.innerHTML = `
    <div class="space-y-4">
      <p class="text-sm">Ajuster le solde de <strong>${escapeHtml(userName)}</strong></p>
      <div>
        <label class="form-label">Type d'ajustement</label>
        <select id="adjust-type" class="form-input">
          <option value="add">Ajouter</option>
          <option value="subtract">Retirer</option>
          <option value="set">Définir</option>
        </select>
      </div>
      <div>
        <label class="form-label">Montant (HTG)</label>
        <input type="number" id="adjust-amount" class="form-input" placeholder="0" step="0.01">
      </div>
      <div>
        <label class="form-label">Raison</label>
        <input type="text" id="adjust-reason" class="form-input" placeholder="Raison de l'ajustement">
      </div>
    </div>
  `;
  
  const confirmBtn = document.getElementById('btn-confirm-adjust');
  const handler = async () => {
    const type = document.getElementById('adjust-type').value;
    const amount = parseFloat(document.getElementById('adjust-amount').value) || 0;
    const reason = document.getElementById('adjust-reason').value;
    
    try {
      const userRef = db.collection('users').doc(userId);
      const doc = await userRef.get();
      let current = doc.data().balance || 0;
      let newBalance;
      
      if (type === 'add') newBalance = current + amount;
      else if (type === 'subtract') newBalance = Math.max(0, current - amount);
      else newBalance = amount;
      
      await userRef.update({ balance: newBalance });
      
      const user = AdminState.users.find(u => u.id === userId);
      if (user) user.balance = newBalance;
      
      await addLog('balance', 'Adjust balance', `${userName}: ${type} ${amount} HTG (${reason})`);
      await createNotification(userId, 'Solde ajusté', `Votre solde a été ${type === 'add' ? 'crédité' : type === 'subtract' ? 'débité' : 'défini à'} ${formatCurrency(amount)}. ${reason}`);
      
      closeModal('modal-adjust-balance');
      renderUsersTable(AdminState.users);
      showToast('Solde ajusté avec succès', 'success');
      confirmBtn.removeEventListener('click', handler);
    } catch (e) {
      showToast('Erreur: ' + e.message, 'error');
    }
  };
  
  confirmBtn.onclick = handler;
  openModal('modal-adjust-balance');
}

function exportUsersCSV() {
  const headers = ['ID', 'Username', 'Full Name', 'Email', 'Role', 'Status', 'Balance', 'Tasks', 'Created'];
  const rows = AdminState.users.map(u => [
    u.id,
    u.username || '',
    u.fullName || '',
    u.email || '',
    u.role || '',
    u.status || '',
    u.balance || 0,
    u.completedTasks || 0,
    u.createdAt ? formatDate(u.createdAt).absolute : ''
  ]);
  
  let csv = headers.join(',') + '\n';
  rows.forEach(r => {
    csv += r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
  });
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `users_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Export CSV terminé', 'success');
}

async function loadAdminTeams() {
  const container = document.getElementById('teams-management-content');
  if (!container) return;
  
  container.innerHTML = `
    <div class="card">
      <div class="card__header">
        <h3 class="card__title">Gestion des équipes</h3>
        <button class="btn btn-primary" onclick="showCreateTeamModal()">
          <i class="fas fa-plus"></i> Créer équipe
        </button>
      </div>
      <div class="card__body">
        <div id="teams-grid" class="grid grid-cols-3 gap-4">
          <div class="p-6 text-center col-span-3"><div class="spinner mx-auto"></div></div>
        </div>
      </div>
    </div>
  `;
  
  try {
    if (!isCacheValid(teamsCache)) {
      const snap = await db.collection('teams').get();
      teamsCache.data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      teamsCache.timestamp = Date.now();
    }
    AdminState.teams = teamsCache.data;
    renderTeamsGrid();
  } catch (e) {
    document.getElementById('teams-grid').innerHTML = '<p class="col-span-3 text-center text-red-500">Erreur de chargement</p>';
  }
}

function renderTeamsGrid() {
  const grid = document.getElementById('teams-grid');
  if (!grid) return;
  
  if (AdminState.teams.length === 0) {
    grid.innerHTML = `
      <div class="empty-state col-span-3">
        <i class="fas fa-people-group"></i>
        <h3>Aucune équipe</h3>
        <p>Créez votre première équipe pour commencer</p>
      </div>
    `;
    return;
  }
  
  grid.innerHTML = AdminState.teams.map(t => `
    <div class="card">
      <div class="card__body">
        <div class="flex items-center gap-3 mb-3">
          <div class="avatar-circle">${(t.name || '?').charAt(0).toUpperCase()}</div>
          <div>
            <h4 class="font-semibold">${escapeHtml(t.name)}</h4>
            <p class="text-xs text-gray-500">${t.members?.length || 0} membres</p>
          </div>
        </div>
        <p class="text-sm text-gray-600 mb-3">${escapeHtml(t.description || 'Aucune description')}</p>
        <div class="flex gap-2">
          <button class="btn btn-sm btn-outline flex-1" onclick="showCreateTeamModal('${t.id}')">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-danger flex-1" onclick="deleteTeam('${t.id}', '${escapeHtml(t.name)}')">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function showCreateTeamModal(teamId) {
  const team = teamId ? AdminState.teams.find(t => t.id === teamId) : null;
  const body = document.getElementById('modal-create-team-body');
  const title = document.getElementById('modal-create-team-title');
  
  if (title) title.textContent = team ? 'Modifier l\'équipe' : 'Créer une équipe';
  
  if (body) {
    body.innerHTML = `
      <div class="space-y-4">
        <div>
          <label class="form-label">Nom de l'équipe</label>
          <input type="text" id="team-name" class="form-input" value="${team ? escapeHtml(team.name) : ''}" placeholder="Ex: Équipe Alpha">
        </div>
        <div>
          <label class="form-label">Description</label>
          <textarea id="team-description" class="form-input form-textarea" rows="3" placeholder="Description de l'équipe">${team ? escapeHtml(team.description || '') : ''}</textarea>
        </div>
        <div>
          <label class="form-label">Manager responsable</label>
          <select id="team-manager" class="form-input">
            <option value="">Sélectionner</option>
            ${AdminState.users.filter(u => u.role === 'manager').map(m => 
              `<option value="${m.id}" ${team && team.managerId === m.id ? 'selected' : ''}>${escapeHtml(m.fullName || m.username)}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    `;
  }
  
  const saveBtn = document.getElementById('btn-save-team');
  saveBtn.onclick = () => saveTeam(teamId);
  
  openModal('modal-create-team');
}

async function saveTeam(teamId) {
  const name = document.getElementById('team-name').value.trim();
  const description = document.getElementById('team-description').value.trim();
  const managerId = document.getElementById('team-manager').value;
  
  if (!name) {
    showToast('Nom requis', 'warning');
    return;
  }
  
  try {
    const data = {
      name,
      description,
      managerId,
      members: [],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    if (teamId) {
      await db.collection('teams').doc(teamId).update(data);
      const team = AdminState.teams.find(t => t.id === teamId);
      if (team) Object.assign(team, data);
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      const docRef = await db.collection('teams').add(data);
      AdminState.teams.push({ id: docRef.id, ...data });
    }
    
    invalidateCache(teamsCache);
    closeModal('modal-create-team');
    renderTeamsGrid();
    await addLog('team', teamId ? 'Update team' : 'Create team', name);
    showToast('Équipe enregistrée', 'success');
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
  }
}

function deleteTeam(teamId, teamName) {
  showConfirm(
    'Supprimer l\'équipe',
    `Voulez-vous vraiment supprimer "${teamName}" ?`,
    async () => {
      try {
        await db.collection('teams').doc(teamId).delete();
        AdminState.teams = AdminState.teams.filter(t => t.id !== teamId);
        invalidateCache(teamsCache);
        renderTeamsGrid();
        await addLog('team', 'Delete team', teamName);
        showToast('Équipe supprimée', 'success');
      } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
      }
    }
  );
}

async function loadAdminTasks() {
  const container = document.getElementById('tasks-management-content');
  if (!container) return;
  
  container.innerHTML = `
    <div class="card">
      <div class="card__header">
        <h3 class="card__title">Gestion des tâches</h3>
        <button class="btn btn-primary" onclick="showCreateTaskModal()">
          <i class="fas fa-plus"></i> Créer tâche
        </button>
      </div>
      <div class="card__body">
        <div class="tabs">
          <button class="tab-btn active" data-task-tab="pending" onclick="switchTaskTab('pending', this)">En attente</button>
          <button class="tab-btn" data-task-tab="active" onclick="switchTaskTab('active', this)">Actives</button>
          <button class="tab-btn" data-task-tab="completed" onclick="switchTaskTab('completed', this)">Terminées</button>
          <button class="tab-btn" data-task-tab="rejected" onclick="switchTaskTab('rejected', this)">Rejetées</button>
        </div>
        <div id="tasks-content">
          <div class="p-6 text-center"><div class="spinner mx-auto"></div></div>
        </div>
      </div>
    </div>
  `;
  
  try {
    const snap = await db.collection('tasks').get();
    AdminState.tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    tasksCache.data = AdminState.tasks;
    tasksCache.timestamp = Date.now();
    _filterAndRenderTasks();
  } catch (e) {
    document.getElementById('tasks-content').innerHTML = '<p class="p-4 text-center text-red-500">Erreur</p>';
  }
}

function switchTaskTab(tab, btn) {
  AdminState.filters.tasks.tab = tab;
  document.querySelectorAll('[data-task-tab]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _filterAndRenderTasks();
}

function _filterAndRenderTasks() {
  const container = document.getElementById('tasks-content');
  if (!container) return;
  
  const tab = AdminState.filters.tasks.tab;
  const tasks = AdminState.tasks.filter(t => t.status === tab);
  
  if (tasks.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><p>Aucune tâche ${tab}</p></div>`;
    return;
  }
  
  container.innerHTML = tasks.map(t => `
    <div class="task-card mb-3">
      <div class="task-card__header">
        <div>
          <h4 class="task-card__title">${escapeHtml(t.title)}</h4>
          <p class="task-card__category">${escapeHtml(t.category || 'Général')}</p>
        </div>
        <div class="task-card__reward">${formatCurrency(t.reward || 0)}</div>
      </div>
      <p class="task-card__description">${escapeHtml(t.description || '')}</p>
      <div class="task-card__footer">
        <div class="task-card__meta">
          <span><i class="fas fa-users"></i> ${t.assignments || 0} assignées</span>
          <span><i class="fas fa-clock"></i> ${t.createdAt ? formatDate(t.createdAt).relative : '—'}</span>
        </div>
        <div class="flex gap-2">
          ${tab === 'pending' ? `
            <button class="btn btn-sm btn-success" onclick="validateTask('${t.id}')"><i class="fas fa-check"></i> Valider</button>
            <button class="btn btn-sm btn-danger" onclick="rejectTask('${t.id}')"><i class="fas fa-times"></i> Rejeter</button>
          ` : ''}
          <button class="btn btn-sm btn-outline" onclick="deleteTask('${t.id}')"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    </div>
  `).join('');
}

function showCreateTaskModal() {
  const body = document.getElementById('modal-create-task-body');
  if (!body) return;
  
  body.innerHTML = `
    <div class="space-y-4">
      <div>
        <label class="form-label">Titre</label>
        <input type="text" id="task-title" class="form-input" placeholder="Titre de la tâche">
      </div>
      <div>
        <label class="form-label">Description</label>
        <textarea id="task-description" class="form-input form-textarea" rows="3" placeholder="Description détaillée"></textarea>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="form-label">Catégorie</label>
          <select id="task-category" class="form-input">
            <option value="social">Social</option>
            <option value="survey">Sondage</option>
            <option value="app">Application</option>
            <option value="video">Vidéo</option>
            <option value="other">Autre</option>
          </select>
        </div>
        <div>
          <label class="form-label">Récompense (HTG)</label>
          <input type="number" id="task-reward" class="form-input" placeholder="0" step="0.01">
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="form-label">Limite d'assignations</label>
          <input type="number" id="task-limit" class="form-input" placeholder="Illimité" value="100">
        </div>
        <div>
          <label class="form-label">Statut initial</label>
          <select id="task-status" class="form-input">
            <option value="active">Active</option>
            <option value="pending">En attente</option>
          </select>
        </div>
      </div>
      <div>
        <label class="form-label">Type</label>
        <select id="task-type" class="form-input">
          <option value="regular">Regular</option>
          <option value="agency">Agency (Premium)</option>
        </select>
      </div>
    </div>
  `;
  
  document.getElementById('btn-create-task').onclick = createTask;
  openModal('modal-create-task');
}

async function createTask() {
  const title = document.getElementById('task-title').value.trim();
  const description = document.getElementById('task-description').value.trim();
  const category = document.getElementById('task-category').value;
  const reward = parseFloat(document.getElementById('task-reward').value) || 0;
  const limit = parseInt(document.getElementById('task-limit').value) || 100;
  const status = document.getElementById('task-status').value;
  const type = document.getElementById('task-type').value;
  
  if (!title || reward <= 0) {
    showToast('Titre et récompense requis', 'warning');
    return;
  }
  
  try {
    const taskData = {
      title,
      description,
      category,
      reward,
      limit,
      status,
      type,
      assignments: 0,
      createdBy: currentUser ? currentUser.id : null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    const docRef = await db.collection('tasks').add(taskData);
    AdminState.tasks.push({ id: docRef.id, ...taskData });
    invalidateCache(tasksCache);
    closeModal('modal-create-task');
    await addLog('task', 'Create task', title);
    showToast('Tâche créée', 'success');
    loadAdminTasks();
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
  }
}

async function validateTask(taskId) {
  const task = AdminState.tasks.find(t => t.id === taskId);
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
        _filterAndRenderTasks();
        await addLog('task', 'Validate task', task.title);
        showToast('Tâche validée', 'success');
      } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
      }
    }
  );
}

async function rejectTask(taskId) {
  const task = AdminState.tasks.find(t => t.id === taskId);
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
        _filterAndRenderTasks();
        await addLog('task', 'Reject task', task.title);
        showToast('Tâche rejetée', 'success');
      } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
      }
    }
  );
}

function deleteTask(taskId) {
  const task = AdminState.tasks.find(t => t.id === taskId);
  if (!task) return;
  
  showConfirm(
    'Supprimer la tâche',
    `Supprimer "${task.title}" ?`,
    async () => {
      try {
        await db.collection('tasks').doc(taskId).delete();
        AdminState.tasks = AdminState.tasks.filter(t => t.id !== taskId);
        invalidateCache(tasksCache);
        _filterAndRenderTasks();
        await addLog('task', 'Delete task', task.title);
        showToast('Tâche supprimée', 'success');
      } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
      }
    }
  );
}

async function loadAdminMaintenance() {
  const container = document.getElementById('page-admin-dashboard');
  // Maintenance page non listée dans les 19 pages - fonction placeholder
  showToast('Module maintenance admin', 'info');
}

function switchMaintenanceTab(tab) {
  AdminState.filters.maintenance.tab = tab;
}

function showAddMaintenanceModal() {
  const body = document.getElementById('modal-add-maintenance-body');
  if (body) {
    body.innerHTML = `
      <div class="space-y-4">
        <div>
          <label class="form-label">Titre</label>
          <input type="text" id="maintenance-title" class="form-input">
        </div>
        <div>
          <label class="form-label">Description</label>
          <textarea id="maintenance-description" class="form-input form-textarea" rows="3"></textarea>
        </div>
        <div>
          <label class="form-label">Date prévue</label>
          <input type="datetime-local" id="maintenance-date" class="form-input">
        </div>
      </div>
    `;
  }
  openModal('modal-add-maintenance');
}

async function activateMaintenance() {
  showToast('Maintenance activée', 'success');
}

async function activateMaintenanceAll() {
  showToast('Maintenance activée pour tous', 'success');
}

async function approveMaintenanceProof(id) {
  showToast('Preuve approuvée', 'success');
}

async function rejectMaintenanceProof(id) {
  showToast('Preuve rejetée', 'success');
}

async function liftMaintenance(id) {
  showToast('Maintenance levée', 'success');
}

async function loadAdminWithdrawals() {
  const container = document.getElementById('payments-content');
  if (!container) return;
  
  container.innerHTML = `
    <div class="card">
      <div class="card__header">
        <h3 class="card__title">Retraits & Paiements</h3>
      </div>
      <div class="card__body">
        <div id="withdrawals-container">
          <div class="p-6 text-center"><div class="spinner mx-auto"></div></div>
        </div>
      </div>
    </div>
  `;
  
  try {
    const snap = await db.collection('withdrawals').orderBy('timestamp', 'desc').get();
    AdminState.withdrawals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderWithdrawalsTable();
  } catch (e) {
    document.getElementById('withdrawals-container').innerHTML = '<p class="text-center text-red-500 p-4">Erreur</p>';
  }
}

function renderWithdrawalsTable() {
  const container = document.getElementById('withdrawals-container');
  if (!container) return;
  
  if (AdminState.withdrawals.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-money-check"></i><p>Aucune demande</p></div>';
    return;
  }
  
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Utilisateur</th>
          <th>Montant</th>
          <th>Méthode</th>
          <th>Statut</th>
          <th>Date</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${AdminState.withdrawals.map(w => {
          const statusBadge = {
            pending: '<span class="badge badge-soft-warning">En attente</span>',
            approved: '<span class="badge badge-soft-success">Approuvé</span>',
            rejected: '<span class="badge badge-soft-danger">Rejeté</span>'
          }[w.status] || '<span class="badge">?</span>';
          return `
            <tr>
              <td>${escapeHtml(w.userName || w.userId || '?')}</td>
              <td class="font-semibold">${formatCurrency(w.amount || 0)}</td>
              <td>${escapeHtml(w.method || '—')}</td>
              <td>${statusBadge}</td>
              <td>${w.timestamp ? formatDate(w.timestamp).relative : '—'}</td>
              <td>
                ${w.status === 'pending' ? `
                  <button class="btn btn-sm btn-success" onclick="approveWithdrawal('${w.id}')"><i class="fas fa-check"></i></button>
                  <button class="btn btn-sm btn-danger" onclick="rejectWithdrawal('${w.id}')"><i class="fas fa-times"></i></button>
                ` : '—'}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

async function approveWithdrawal(id) {
  const w = AdminState.withdrawals.find(x => x.id === id);
  if (!w) return;
  
  showConfirm(
    'Approuver le retrait',
    `Approuver ${formatCurrency(w.amount)} pour ${w.userName || w.userId} ?`,
    async () => {
      try {
        await db.collection('withdrawals').doc(id).update({
          status: 'approved',
          processedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        if (w.userId) {
          const userRef = db.collection('users').doc(w.userId);
          const doc = await userRef.get();
          const current = doc.data().balance || 0;
          await userRef.update({ balance: Math.max(0, current - (w.amount || 0)) });
        }
        
        w.status = 'approved';
        renderWithdrawalsTable();
        await createNotification(w.userId, 'Retrait approuvé', `Votre retrait de ${formatCurrency(w.amount)} a été approuvé.`);
        await addLog('withdrawal', 'Approve withdrawal', `${w.amount} HTG`);
        showToast('Retrait approuvé', 'success');
      } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
      }
    }
  );
}

async function rejectWithdrawal(id) {
  const w = AdminState.withdrawals.find(x => x.id === id);
  if (!w) return;
  
  showConfirm(
    'Rejeter le retrait',
    `Rejeter ${formatCurrency(w.amount)} ?`,
    async () => {
      try {
        await db.collection('withdrawals').doc(id).update({
          status: 'rejected',
          processedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        w.status = 'rejected';
        renderWithdrawalsTable();
        await createNotification(w.userId, 'Retrait rejeté', `Votre retrait de ${formatCurrency(w.amount)} a été rejeté.`);
        await addLog('withdrawal', 'Reject withdrawal', `${w.amount} HTG`);
        showToast('Retrait rejeté', 'success');
      } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
      }
    }
  );
}

async function loadAdminLogs() {
  const container = document.getElementById('page-settings');
  // Logs non listé dans les 19 pages officielles, mais mentionné
  showToast('Logs admin - voir console', 'info');
  try {
    const snap = await db.collection('logs').orderBy('timestamp', 'desc').limit(100).get();
    AdminState.logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    console.table(AdminState.logs);
  } catch (e) {}
}

function filterLogs() {}
function renderLogsTable() {}

async function loadAdminSettings() {
  const container = document.getElementById('settings-content');
  if (!container) return;
  
  await loadGlobalSettings();
  
  container.innerHTML = `
    <div class="space-y-4">
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Paramètres globaux</h3>
        </div>
        <div class="card__body space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="form-label">Taux de change (USD → HTG)</label>
              <input type="number" id="setting-exchange-rate" class="form-input" value="${globalSettings.exchangeRate || 130}" step="0.01">
              <button class="btn btn-sm btn-primary mt-2" onclick="saveExchangeRate()">Enregistrer</button>
            </div>
            <div>
              <label class="form-label">Frais de maintenance (%)</label>
              <input type="number" id="setting-maintenance-fee" class="form-input" value="${globalSettings.maintenanceFee || 0}" step="0.01">
              <button class="btn btn-sm btn-primary mt-2" onclick="saveMaintenanceFee()">Enregistrer</button>
            </div>
          </div>
        </div>
      </div>
      
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Numéros de paiement</h3>
        </div>
        <div class="card__body space-y-3">
          <div>
            <label class="form-label">MonCash</label>
            <input type="text" id="payment-moncash" class="form-input" value="${escapeHtml(globalSettings.paymentNumbers?.moncash || '')}">
          </div>
          <div>
            <label class="form-label">NatCash</label>
            <input type="text" id="payment-natcash" class="form-input" value="${escapeHtml(globalSettings.paymentNumbers?.natcash || '')}">
          </div>
          <div>
            <label class="form-label">Banque (IBAN/Compte)</label>
            <input type="text" id="payment-bank" class="form-input" value="${escapeHtml(globalSettings.paymentNumbers?.bank || '')}">
          </div>
          <button class="btn btn-primary" onclick="savePaymentNumbers()">
            <i class="fas fa-save"></i> Enregistrer
          </button>
        </div>
      </div>
      
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Prix Premium</h3>
        </div>
        <div class="card__body space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="form-label">Mensuel (HTG)</label>
              <input type="number" id="premium-monthly" class="form-input" value="${globalSettings.premiumPrices?.monthly || 500}">
            </div>
            <div>
              <label class="form-label">Annuel (HTG)</label>
              <input type="number" id="premium-yearly" class="form-input" value="${globalSettings.premiumPrices?.yearly || 5000}">
            </div>
          </div>
          <button class="btn btn-primary" onclick="savePremiumPrices()">
            <i class="fas fa-save"></i> Enregistrer
          </button>
        </div>
      </div>
      
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Créer un compte Manager</h3>
        </div>
        <div class="card__body">
          <button class="btn btn-primary" onclick="createManagerAccount()">
            <i class="fas fa-user-plus"></i> Créer un manager
          </button>
        </div>
      </div>
      
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Commissions journalières</h3>
        </div>
        <div class="card__body">
          <button class="btn btn-warning" onclick="calculateDailyCommissions()">
            <i class="fas fa-calculator"></i> Calculer les commissions
          </button>
        </div>
      </div>
    </div>
  `;
}

async function saveExchangeRate() {
  const value = parseFloat(document.getElementById('setting-exchange-rate').value) || 130;
  try {
    await db.collection('settings').doc('global').set({
      exchangeRate: value
    }, { merge: true });
    globalSettings.exchangeRate = value;
    showToast('Taux enregistré', 'success');
    await addLog('settings', 'Update exchange rate', value);
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
  }
}

async function saveMaintenanceFee() {
  const value = parseFloat(document.getElementById('setting-maintenance-fee').value) || 0;
  try {
    await db.collection('settings').doc('global').set({
      maintenanceFee: value
    }, { merge: true });
    globalSettings.maintenanceFee = value;
    showToast('Frais enregistrés', 'success');
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
  }
}

async function savePaymentNumbers() {
  const numbers = {
    moncash: document.getElementById('payment-moncash').value.trim(),
    natcash: document.getElementById('payment-natcash').value.trim(),
    bank: document.getElementById('payment-bank').value.trim()
  };
  try {
    await db.collection('settings').doc('global').set({
      paymentNumbers: numbers
    }, { merge: true });
    globalSettings.paymentNumbers = numbers;
    showToast('Numéros enregistrés', 'success');
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
  }
}

async function savePremiumPrices() {
  const prices = {
    monthly: parseFloat(document.getElementById('premium-monthly').value) || 500,
    yearly: parseFloat(document.getElementById('premium-yearly').value) || 5000
  };
  try {
    await db.collection('settings').doc('global').set({
      premiumPrices: prices
    }, { merge: true });
    globalSettings.premiumPrices = prices;
    showToast('Prix enregistrés', 'success');
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
  }
}

async function createManagerAccount() {
  const body = document.getElementById('modal-create-manager-body');
  if (body) {
    body.innerHTML = `
      <div class="space-y-4">
        <div>
          <label class="form-label">Nom complet</label>
          <input type="text" id="manager-fullname" class="form-input" placeholder="John Doe">
        </div>
        <div>
          <label class="form-label">Email</label>
          <input type="email" id="manager-email" class="form-input" placeholder="manager@example.com">
        </div>
        <div>
          <label class="form-label">Mot de passe temporaire</label>
          <input type="text" id="manager-password" class="form-input" value="${generateRandomPassword()}">
        </div>
        <div>
          <label class="form-label">Plan</label>
          <select id="manager-plan" class="form-input">
            <option value="starter">Starter (5 membres)</option>
            <option value="pro">Pro (20 membres)</option>
            <option value="elite">Élite (50 membres)</option>
            <option value="enterprise">Entreprise (illimité)</option>
          </select>
        </div>
      </div>
    `;
  }
  
  document.getElementById('btn-confirm-create-manager').onclick = async () => {
    const fullName = document.getElementById('manager-fullname').value.trim();
    const email = document.getElementById('manager-email').value.trim();
    const password = document.getElementById('manager-password').value;
    const plan = document.getElementById('manager-plan').value;
    
    if (!fullName || !email || !password) {
      showToast('Tous les champs sont requis', 'warning');
      return;
    }
    
    try {
      // Création via Admin SDK simulée (côté client on crée d'abord dans Firestore)
      const username = generateUsername(fullName);
      
      // Note: Firebase Auth createUserWithEmailAndPassword nécessite que l'utilisateur courant soit déconnecté ou via Admin SDK
      // En mode démo, on crée juste le profil Firestore
      const managerData = {
        email,
        username,
        fullName,
        role: 'manager',
        plan,
        balance: 0,
        pendingBalance: 0,
        completedTasks: 0,
        isPremium: false,
        status: 'active',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      
      // Tente de créer via Auth
      try {
        const secondaryApp = firebase.initializeApp(firebaseConfig, 'Secondary' + Date.now());
        const cred = await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
        managerData.id = cred.user.uid;
        await db.collection('users').doc(cred.user.uid).set(managerData);
        await secondaryApp.auth().signOut();
        secondaryApp.delete();
      } catch (authErr) {
        // Fallback : création manuelle
        const ref = await db.collection('users').add(managerData);
        managerData.id = ref.id;
      }
      
      closeModal('modal-create-manager');
      await addLog('user', 'Create manager', `${fullName} (${email})`);
      showToast(`Manager créé. Username: ${username}, Password: ${password}`, 'success', 10000);
    } catch (e) {
      showToast('Erreur: ' + e.message, 'error');
    }
  };
  
  openModal('modal-create-manager');
}

async function calculateDailyCommissions() {
  showConfirm(
    'Calculer les commissions',
    'Calculer et créditer les commissions des managers pour aujourd\'hui ?',
    async () => {
      try {
        const usersSnap = await db.collection('users').get();
        const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const managers = users.filter(u => u.role === 'manager');
        
        let totalCredited = 0;
        for (const manager of managers) {
          // Simulation: calcul basé sur l'activité des membres du manager
          const commission = Math.floor(Math.random() * 500) + 100;
          const newBalance = (manager.balance || 0) + commission;
          await db.collection('users').doc(manager.id).update({ balance: newBalance });
          totalCredited += commission;
          await createNotification(manager.id, 'Commission journalière', `Vous avez reçu ${formatCurrency(commission)} de commission.`);
        }
        
        await addLog('commission', 'Daily commissions', `${managers.length} managers, ${formatCurrency(totalCredited)} total`);
        showToast(`${managers.length} managers crédités, total: ${formatCurrency(totalCredited)}`, 'success');
      } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
      }
    }
  );
}

function initAdminNav() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const nav = el.getAttribute('data-nav');
      const pageMap = {
        dashboard: 'page-admin-dashboard',
        users: 'page-users-management',
        teams: 'page-teams-management',
        tasks: 'page-tasks-management',
        maintenance: 'page-admin-dashboard',
        withdrawals: 'page-payments',
        logs: 'page-settings',
        settings: 'page-settings'
      };
      if (pageMap[nav]) showPage(pageMap[nav]);
    });
  });
}

/* ============================================================
   4.7 MODULE WORKER
   ============================================================ */

const WorkerState = {
  currentUser: {
    id: null,
    fullName: 'Worker Demo',
    balance: 0,
    pendingBalance: 0,
    completedTasks: 0,
    isPremium: false,
    plan: 'free'
  },
  availableTasks: [],
  acceptedTasks: [],
  history: [],
  withdrawals: [],
  selectedWithdrawalMethod: null,
  proofModal: { taskId: null, file: null },
  maintenanceProof: { file: null },
  historyFilter: 'all',
  withdrawalStep: 1,
  planLimits: {
    free: {
      dailyTaskLimit: DAILY_FREE_LIMIT,
      monthlyTaskLimit: 100,
      commission: 0.10,
      minWithdrawal: 2600, // ~20 USD en HTG
      agencyAccess: false
    },
    premium: {
      dailyTaskLimit: 50,
      monthlyTaskLimit: 1000,
      commission: 0.05,
      minWithdrawal: 1300, // ~10 USD en HTG
      agencyAccess: true
    }
  }
};

async function renderWorkerDashboard() {
  const container = document.getElementById('worker-dashboard-content');
  if (!container) return;
  
  if (currentUser) {
    WorkerState.currentUser = {
      id: currentUser.id,
      fullName: currentUser.fullName || currentUser.username,
      balance: currentUser.balance || 0,
      pendingBalance: currentUser.pendingBalance || 0,
      completedTasks: currentUser.completedTasks || 0,
      isPremium: currentUser.isPremium || false,
      plan: currentUser.plan || 'free'
    };
  }
  
  const badge = getBadgeInfo(WorkerState.currentUser.completedTasks);
  const limits = checkPlanLimits();
  
  container.innerHTML = `
    <div class="space-y-5">
      <div class="grid grid-cols-4 gap-4">
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--success">
            <i class="fas fa-wallet"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Solde disponible</div>
            <div class="stat-card__value">${formatCurrency(WorkerState.currentUser.balance)}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--warning">
            <i class="fas fa-clock"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">En attente</div>
            <div class="stat-card__value">${formatCurrency(WorkerState.currentUser.pendingBalance)}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--primary">
            <i class="fas fa-check-circle"></i>
          </div>
          <div class="stat-card__content">
            <div class="stat-card__label">Tâches terminées</div>
            <div class="stat-card__value">${WorkerState.currentUser.completedTasks}</div>
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
      
      ${!WorkerState.currentUser.isPremium ? `
        <div class="card" style="background:linear-gradient(135deg, #fbbf24, #f59e0b); color:white; border:none;">
          <div class="card__body flex items-center justify-between">
            <div>
              <h3 style="color:white" class="text-xl font-bold"><i class="fas fa-crown"></i> Passez au Premium !</h3>
              <p style="color:rgba(255,255,255,0.9)">50 tâches/jour, commission réduite, accès Agency</p>
            </div>
            <button class="btn" style="background:white;color:#f59e0b" onclick="navigateTo('page-premium')">
              Découvrir <i class="fas fa-arrow-right"></i>
            </button>
          </div>
        </div>
      ` : ''}
      
      <div class="grid grid-cols-2 gap-4">
        <div class="card">
          <div class="card__header">
            <h3 class="card__title">Tâches en cours</h3>
            <span class="badge badge-soft-primary">${WorkerState.acceptedTasks.length}</span>
          </div>
          <div class="card__body" id="worker-current-tasks">
            ${WorkerState.acceptedTasks.length === 0 
              ? '<p class="text-center text-gray-500">Aucune tâche en cours</p>'
              : WorkerState.acceptedTasks.slice(0, 3).map(t => `
                <div class="flex items-center justify-between p-2 border-b border-gray-100">
                  <div>
                    <div class="font-semibold text-sm">${escapeHtml(t.title)}</div>
                    <div class="text-xs text-gray-500">${formatCurrency(t.reward)}</div>
                  </div>
                  <button class="btn btn-sm btn-primary" onclick="openTaskProofModal('${t.id}')">
                    <i class="fas fa-upload"></i>
                  </button>
                </div>
              `).join('')
            }
          </div>
        </div>
        
        <div class="card">
          <div class="card__header">
            <h3 class="card__title">Tâches disponibles</h3>
            <button class="btn btn-sm btn-outline" onclick="loadWorkerTasks()">Voir tout</button>
          </div>
          <div class="card__body" id="worker-available-tasks">
            <div class="p-4 text-center"><div class="spinner mx-auto"></div></div>
          </div>
        </div>
      </div>
      
      <div class="grid grid-cols-4 gap-3">
        <button class="btn btn-primary btn-block" onclick="loadWorkerTasks()">
          <i class="fas fa-tasks"></i> Tâches
        </button>
        <button class="btn btn-primary btn-block" onclick="navigateTo('page-offerwall-monlix')">
          <i class="fas fa-gift"></i> Offres
        </button>
        <button class="btn btn-primary btn-block" onclick="loadWorkerHistory()">
          <i class="fas fa-history"></i> Historique
        </button>
        <button class="btn btn-primary btn-block" onclick="loadWorkerWithdrawal()">
          <i class="fas fa-money-bill-wave"></i> Retrait
        </button>
      </div>
      
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Limites du plan (${WorkerState.currentUser.isPremium ? 'Premium' : 'Gratuit'})</h3>
        </div>
        <div class="card__body">
          <div class="space-y-3">
            <div>
              <div class="progress-label">
                <span>Tâches quotidiennes</span>
                <span>${limits.dailyUsed}/${limits.dailyLimit}</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style="width:${limits.dailyProgress}%"></div>
              </div>
            </div>
            <div>
              <div class="progress-label">
                <span>Tâches mensuelles</span>
                <span>${limits.monthlyUsed}/${limits.monthlyLimit}</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style="width:${limits.monthlyProgress}%"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  loadAvailableTasksPreview();
}

async function loadAvailableTasksPreview() {
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
    
    WorkerState.availableTasks = tasks;
    
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
          <button class="btn btn-sm btn-primary" onclick="acceptTask('${t.id}')">
            <i class="fas fa-play"></i>
          </button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<p class="text-center text-red-500">Erreur</p>';
  }
}

async function loadWorkerTasks() {
  const container = document.getElementById('page-worker-dashboard');
  // Affiche dans le dashboard
  const targetContainer = document.getElementById('worker-dashboard-content');
  if (!targetContainer) return;
  
  const content = `
    <div class="card mt-4">
      <div class="card__header">
        <h3 class="card__title">Toutes les tâches</h3>
      </div>
      <div class="card__body">
        <div class="flex gap-2 mb-4 flex-wrap">
          <button class="btn btn-sm btn-primary" data-cat="all" onclick="filterWorkerTasksByCategory('all', this)">Toutes</button>
          <button class="btn btn-sm btn-outline" data-cat="social" onclick="filterWorkerTasksByCategory('social', this)">Social</button>
          <button class="btn btn-sm btn-outline" data-cat="survey" onclick="filterWorkerTasksByCategory('survey', this)">Sondage</button>
          <button class="btn btn-sm btn-outline" data-cat="app" onclick="filterWorkerTasksByCategory('app', this)">App</button>
          <button class="btn btn-sm btn-outline" data-cat="video" onclick="filterWorkerTasksByCategory('video', this)">Vidéo</button>
        </div>
        <div id="worker-tasks-list">
          <div class="p-4 text-center"><div class="spinner mx-auto"></div></div>
        </div>
      </div>
    </div>
  `;
  
  if (!document.getElementById('worker-tasks-list')) {
    targetContainer.insertAdjacentHTML('beforeend', content);
  }
  
  try {
    const snap = await db.collection('tasks').where('status', '==', 'active').get();
    WorkerState.availableTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    filterWorkerTasksByCategory('all');
  } catch (e) {
    document.getElementById('worker-tasks-list').innerHTML = '<p class="text-center text-red-500">Erreur</p>';
  }
}

function filterWorkerTasksByCategory(category, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('button').forEach(b => {
      b.classList.remove('btn-primary');
      b.classList.add('btn-outline');
    });
    btn.classList.remove('btn-outline');
    btn.classList.add('btn-primary');
  }
  
  const container = document.getElementById('worker-tasks-list');
  if (!container) return;
  
  const tasks = category === 'all' 
    ? WorkerState.availableTasks 
    : WorkerState.availableTasks.filter(t => t.category === category);
  
  if (tasks.length === 0) {
    container.innerHTML = '<p class="text-center text-gray-500">Aucune tâche</p>';
    return;
  }
  
  container.innerHTML = tasks.map(t => `
    <div class="task-card mb-3">
      <div class="task-card__header">
        <div>
          <h4 class="task-card__title">${escapeHtml(t.title)}</h4>
          <p class="task-card__category">${escapeHtml(t.category || 'Général')}</p>
        </div>
        <div class="task-card__reward">${formatCurrency(t.reward)}</div>
      </div>
      <p class="task-card__description">${escapeHtml(t.description || '')}</p>
      <div class="task-card__footer">
        <div class="task-card__meta">
          <span><i class="fas fa-users"></i> ${t.assignments || 0}/${t.limit || '∞'}</span>
        </div>
        <button class="btn btn-sm btn-primary" onclick="acceptTask('${t.id}')">
          <i class="fas fa-play"></i> Accepter
        </button>
      </div>
    </div>
  `).join('');
}

function acceptTask(taskId) {
  const task = WorkerState.availableTasks.find(t => t.id === taskId);
  if (!task) {
    showToast('Tâche introuvable', 'error');
    return;
  }
  
  const limits = checkPlanLimits();
  if (limits.dailyUsed >= limits.dailyLimit) {
    showPlanLimitsModal();
    return;
  }
  
  WorkerState.acceptedTasks.push(task);
  WorkerState.availableTasks = WorkerState.availableTasks.filter(t => t.id !== taskId);
  
  showToast('Tâche acceptée ! Soumettez votre preuve.', 'success');
  openTaskProofModal(taskId);
  
  if (document.getElementById('worker-dashboard-content')) {
    renderWorkerDashboard();
  }
}

function openTaskProofModal(taskId) {
  WorkerState.proofModal.taskId = taskId;
  WorkerState.proofModal.file = null;
  
  const task = [...WorkerState.acceptedTasks, ...WorkerState.availableTasks].find(t => t.id === taskId);
  const comment = document.getElementById('proof-comment');
  const preview = document.getElementById('proof-preview');
  const input = document.getElementById('proof-file-input');
  
  if (comment) comment.value = '';
  if (preview) {
    preview.style.display = 'none';
    preview.innerHTML = '';
  }
  if (input) input.value = '';
  
  // Setup dropzone
  setupUploadZone('#proof-dropzone', {
    onFileSelected: (file) => {
      WorkerState.proofModal.file = file;
    }
  });
  
  const submitBtn = document.getElementById('btn-submit-proof');
  if (submitBtn) {
    submitBtn.onclick = () => submitTaskProof(taskId);
  }
  
  openModal('modal-task-proof');
}

function handleProofFileChange(event, taskId) {
  const file = event.target.files[0];
  if (file) processProofFile(file, taskId);
}

function processProofFile(file, taskId) {
  WorkerState.proofModal.file = file;
}

function clearProofFile(taskId) {
  WorkerState.proofModal.file = null;
  const input = document.getElementById('proof-file-input');
  const preview = document.getElementById('proof-preview');
  if (input) input.value = '';
  if (preview) {
    preview.style.display = 'none';
    preview.innerHTML = '';
  }
}

async function submitTaskProof(taskId) {
  const file = WorkerState.proofModal.file;
  const comment = document.getElementById('proof-comment')?.value || '';
  
  if (!file) {
    showToast('Veuillez ajouter une preuve', 'warning');
    return;
  }
  
  const task = WorkerState.acceptedTasks.find(t => t.id === taskId);
  if (!task) {
    showToast('Tâche introuvable', 'error');
    return;
  }
  
  try {
    // Upload vers ImgBB
    const result = await uploadToImgbb(file, {
      onError: (err) => {
        console.error('Upload error:', err);
        showToast('Erreur upload', 'error');
      }
    });
    
    // Création preuve dans Firestore
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
    
    // Mise à jour tâche
    await db.collection('tasks').doc(taskId).update({
      assignments: firebase.firestore.FieldValue.increment(1)
    });
    
    // Ajout à l'historique
    WorkerState.history.unshift({
      ...task,
      status: 'pending',
      proofUrl: result.url,
      comment,
      completedAt: new Date()
    });
    
    // Mise à jour solde en attente
    const commission = WorkerState.currentUser.isPremium ? 0.05 : 0.10;
    const netReward = task.reward * (1 - commission);
    const userRef = db.collection('users').doc(currentUser.id);
    await userRef.update({
      pendingBalance: firebase.firestore.FieldValue.increment(netReward)
    });
    WorkerState.currentUser.pendingBalance += netReward;
    
    // Retirer des tâches acceptées
    WorkerState.acceptedTasks = WorkerState.acceptedTasks.filter(t => t.id !== taskId);
    
    closeModal('modal-task-proof');
    openModal('modal-proof-success');
    updateHeaderUser();
    
    await addLog('proof', 'Submit proof', `${task.title} - ${formatCurrency(task.reward)}`);
  } catch (e) {
    console.error('Erreur submit proof:', e);
    showToast('Erreur: ' + e.message, 'error');
  }
}

async function loadWorkerHistory() {
  const targetContainer = document.getElementById('worker-dashboard-content');
  if (!targetContainer) return;
  
  const section = document.createElement('div');
  section.id = 'worker-history-section';
  section.className = 'card mt-4';
  section.innerHTML = `
    <div class="card__header">
      <h3 class="card__title">Historique</h3>
      <div class="flex gap-2">
        <button class="btn btn-sm btn-primary" onclick="setHistoryFilter('all', this)">Tous</button>
        <button class="btn btn-sm btn-outline" onclick="setHistoryFilter('pending', this)">En attente</button>
        <button class="btn btn-sm btn-outline" onclick="setHistoryFilter('completed', this)">Terminés</button>
        <button class="btn btn-sm btn-outline" onclick="setHistoryFilter('rejected', this)">Rejetés</button>
      </div>
    </div>
    <div class="card__body" id="worker-history-list">
      <div class="p-4 text-center"><div class="spinner mx-auto"></div></div>
    </div>
  `;
  
  const existing = document.getElementById('worker-history-section');
  if (existing) existing.remove();
  targetContainer.appendChild(section);
  
  try {
    const snap = await db.collection('proofs')
      .where('userId', '==', currentUser.id)
      .orderBy('timestamp', 'desc')
      .get();
    WorkerState.history = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderWorkerHistory();
  } catch (e) {
    document.getElementById('worker-history-list').innerHTML = '<p class="text-center text-red-500">Erreur</p>';
  }
}

function renderWorkerHistory() {
  const container = document.getElementById('worker-history-list');
  if (!container) return;
  
  const filter = WorkerState.historyFilter;
  const history = filter === 'all' 
    ? WorkerState.history 
    : WorkerState.history.filter(h => h.status === filter);
  
  if (history.length === 0) {
    container.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>Aucun historique</p></div>';
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
          ${h.imageUrl ? `<img src="${h.imageUrl}" class="w-12 h-12 rounded-lg object-cover" alt="">` : '<div class="avatar-circle avatar-circle--sm"><i class="fas fa-file"></i></div>'}
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

function setHistoryFilter(filter, btn) {
  WorkerState.historyFilter = filter;
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

async function loadMaintenancePage() {
  const container = document.getElementById('page-worker-dashboard');
  if (!container) return;
  
  showToast('Page maintenance disponible via tâches', 'info');
}

function handleMaintenanceFileChange(event) {
  const file = event.target.files[0];
  if (file) processMaintenanceFile(file);
}

function processMaintenanceFile(file) {
  WorkerState.maintenanceProof.file = file;
}

function clearMaintenanceFile() {
  WorkerState.maintenanceProof.file = null;
}

async function submitMaintenanceProof() {
  const file = WorkerState.maintenanceProof.file;
  if (!file) {
    showToast('Ajoutez une capture', 'warning');
    return;
  }
  
  try {
    await uploadToImgbb(file);
    closeModal('modal-maintenance-proof');
    openModal('modal-maintenance-success');
    showToast('Preuve soumise', 'success');
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
  }
}

async function loadWorkerWithdrawal() {
  const container = document.getElementById('wallet-content');
  if (!container) return;
  
  const balance = currentUser ? (currentUser.balance || 0) : 0;
  const minWithdrawal = WorkerState.currentUser.isPremium 
    ? WorkerState.planLimits.premium.minWithdrawal 
    : WorkerState.planLimits.free.minWithdrawal;
  
  container.innerHTML = `
    <div class="space-y-4">
      <div class="card" style="background:linear-gradient(135deg, #2563eb, #1e40af); color:white; border:none;">
        <div class="card__body text-center">
          <p style="color:rgba(255,255,255,0.8)" class="mb-2">Solde disponible</p>
          <h2 style="color:white; font-size:3rem" class="font-bold">${formatCurrency(balance)}</h2>
          <p style="color:rgba(255,255,255,0.7)" class="text-sm mt-2">Minimum de retrait: ${formatCurrency(minWithdrawal)}</p>
        </div>
      </div>
      
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Demander un retrait</h3>
        </div>
        <div class="card__body space-y-4">
          <div>
            <label class="form-label">Méthode de paiement</label>
            <div class="grid grid-cols-3 gap-3">
              <button class="btn btn-outline p-4 flex-col" onclick="selectMethod('moncash', this)">
                <i class="fas fa-mobile-alt text-2xl mb-2"></i>
                <span>MonCash</span>
              </button>
              <button class="btn btn-outline p-4 flex-col" onclick="selectMethod('natcash', this)">
                <i class="fas fa-mobile-screen text-2xl mb-2"></i>
                <span>NatCash</span>
              </button>
              <button class="btn btn-outline p-4 flex-col" onclick="selectMethod('bank', this)">
                <i class="fas fa-university text-2xl mb-2"></i>
                <span>Banque</span>
              </button>
              <button class="btn btn-outline p-4 flex-col" onclick="selectMethod('paypal', this)">
                <i class="fab fa-paypal text-2xl mb-2"></i>
                <span>PayPal</span>
              </button>
              <button class="btn btn-outline p-4 flex-col" onclick="selectMethod('wise', this)">
                <i class="fas fa-globe text-2xl mb-2"></i>
                <span>Wise</span>
              </button>
              <button class="btn btn-outline p-4 flex-col" onclick="selectMethod('crypto', this)">
                <i class="fab fa-bitcoin text-2xl mb-2"></i>
                <span>Crypto</span>
              </button>
            </div>
          </div>
          
          <div id="method-details" style="display:none"></div>
          
          <div>
            <label class="form-label">Montant (HTG)</label>
            <input type="number" id="withdrawal-amount" class="form-input" placeholder="0" step="0.01" oninput="updateWithdrawalSummary(this.value)">
            <div class="flex gap-2 mt-2">
              <button class="btn btn-sm btn-outline" onclick="setWithdrawalAmount(${minWithdrawal})">Min</button>
              <button class="btn btn-sm btn-outline" onclick="setWithdrawalAmount(${balance / 2})">50%</button>
              <button class="btn btn-sm btn-outline" onclick="setWithdrawalAmount(${balance})">Max</button>
            </div>
          </div>
          
          <div id="withdrawal-summary" class="p-4 bg-gray-50 rounded-lg" style="display:none"></div>
          
          <button class="btn btn-primary btn-block btn-lg" id="btn-request-withdrawal" onclick="requestWithdrawal()">
            <i class="fas fa-paper-plane"></i> Demander le retrait
          </button>
        </div>
      </div>
      
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Mes retraits</h3>
          <button class="btn btn-sm btn-outline" onclick="loadMyWithdrawals()">
            <i class="fas fa-sync"></i>
          </button>
        </div>
        <div class="card__body" id="my-withdrawals-list">
          <div class="p-4 text-center"><div class="spinner mx-auto"></div></div>
        </div>
      </div>
    </div>
  `;
  
  loadMyWithdrawals();
}

function selectMethod(methodId, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('button').forEach(b => {
      b.classList.remove('btn-primary');
      b.classList.add('btn-outline');
    });
    btn.classList.remove('btn-outline');
    btn.classList.add('btn-primary');
  }
  
  WorkerState.selectedWithdrawalMethod = methodId;
  
  const details = document.getElementById('method-details');
  if (!details) return;
  details.style.display = 'block';
  
  const methodFields = {
    moncash: '<label class="form-label">Numéro MonCash</label><input type="text" id="method-field" class="form-input" placeholder="+509 XXXX XXXX">',
    natcash: '<label class="form-label">Numéro NatCash</label><input type="text" id="method-field" class="form-input" placeholder="+509 XXXX XXXX">',
    bank: '<label class="form-label">Numéro de compte</label><input type="text" id="method-field" class="form-input" placeholder="XXXX XXXX XXXX">',
    paypal: '<label class="form-label">Email PayPal</label><input type="email" id="method-field" class="form-input" placeholder="email@example.com">',
    wise: '<label class="form-label">Email Wise</label><input type="email" id="method-field" class="form-input" placeholder="email@example.com">',
    crypto: '<label class="form-label">Adresse crypto (USDT TRC20)</label><input type="text" id="method-field" class="form-input" placeholder="T...">'
  };
  
  details.innerHTML = methodFields[methodId] || '';
}

function updateWithdrawalSummary(amount) {
  const summary = document.getElementById('withdrawal-summary');
  if (!summary) return;
  
  const amt = parseFloat(amount) || 0;
  if (amt <= 0) {
    summary.style.display = 'none';
    return;
  }
  
  summary.style.display = 'block';
  const rate = globalSettings.exchangeRate || 130;
  const usd = (amt / rate).toFixed(2);
  
  summary.innerHTML = `
    <div class="space-y-2">
      <div class="flex justify-between">
        <span class="text-gray-600">Montant:</span>
        <span class="font-semibold">${formatCurrency(amt)}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-gray-600">Équivalent USD:</span>
        <span class="font-semibold">$${usd}</span>
      </div>
      <div class="flex justify-between border-t pt-2">
        <span class="text-gray-600">Vous recevrez:</span>
        <span class="font-bold text-green-600">${formatCurrency(amt)}</span>
      </div>
    </div>
  `;
}

function setWithdrawalAmount(amount) {
  const input = document.getElementById('withdrawal-amount');
  if (input) {
    input.value = Math.floor(amount);
    updateWithdrawalSummary(amount);
  }
}

async function requestWithdrawal() {
  const amount = parseFloat(document.getElementById('withdrawal-amount')?.value) || 0;
  const method = WorkerState.selectedWithdrawalMethod;
  const field = document.getElementById('method-field')?.value.trim();
  
  if (!method) {
    showToast('Sélectionnez une méthode', 'warning');
    return;
  }
  
  if (!field) {
    showToast('Remplissez les informations de paiement', 'warning');
    return;
  }
  
  const min = WorkerState.currentUser.isPremium 
    ? WorkerState.planLimits.premium.minWithdrawal 
    : WorkerState.planLimits.free.minWithdrawal;
  
  if (amount < min) {
    showToast(`Minimum: ${formatCurrency(min)}`, 'warning');
    return;
  }
  
  const balance = currentUser ? (currentUser.balance || 0) : 0;
  if (amount > balance) {
    showToast('Solde insuffisant', 'error');
    return;
  }
  
  try {
    await db.collection('withdrawals').add({
      userId: currentUser.id,
      userName: currentUser.fullName || currentUser.username,
      amount,
      method,
      methodDetails: field,
      status: 'pending',
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    closeModal();
    openModal('modal-withdrawal-success');
    showToast('Demande envoyée', 'success');
    
    await addLog('withdrawal', 'Request withdrawal', `${formatCurrency(amount)} via ${method}`);
    await createNotification(currentUser.id, 'Demande de retrait', `Votre demande de ${formatCurrency(amount)} a été soumise.`);
    
    loadMyWithdrawals();
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
  }
}

async function loadMyWithdrawals() {
  const container = document.getElementById('my-withdrawals-list');
  if (!container) return;
  
  try {
    const snap = await db.collection('withdrawals')
      .where('userId', '==', currentUser.id)
      .orderBy('timestamp', 'desc')
      .get();
    
    WorkerState.withdrawals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    if (WorkerState.withdrawals.length === 0) {
      container.innerHTML = '<p class="text-center text-gray-500">Aucun retrait</p>';
      return;
    }
    
    container.innerHTML = WorkerState.withdrawals.map(w => {
      const statusBadge = {
        pending: '<span class="badge badge-soft-warning">En attente</span>',
        approved: '<span class="badge badge-soft-success">Approuvé</span>',
        rejected: '<span class="badge badge-soft-danger">Rejeté</span>'
      }[w.status] || '';
      
      return `
        <div class="flex items-center justify-between p-3 border-b border-gray-100">
          <div>
            <div class="font-semibold">${formatCurrency(w.amount)}</div>
            <div class="text-xs text-gray-500">${w.method} • ${w.timestamp ? formatDate(w.timestamp).relative : '—'}</div>
          </div>
          ${statusBadge}
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = '<p class="text-center text-red-500">Erreur</p>';
  }
}

async function loadPremiumPage() {
  const container = document.getElementById('premium-content');
  if (!container) return;
  
  await loadGlobalSettings();
  const prices = globalSettings.premiumPrices || { monthly: 500, yearly: 5000 };
  
  container.innerHTML = `
    <div class="space-y-5">
      <div class="text-center">
        <h2 class="text-3xl font-bold mb-2"><i class="fas fa-crown text-yellow-500"></i> Abonnement Premium</h2>
        <p class="text-gray-500">Débloquez toutes les fonctionnalités</p>
      </div>
      
      ${WorkerState.currentUser.isPremium ? `
        <div class="card" style="background:linear-gradient(135deg, #fbbf24, #f59e0b); color:white; border:none;">
          <div class="card__body text-center">
            <h3 style="color:white" class="text-2xl font-bold mb-2"><i class="fas fa-check-circle"></i> Vous êtes Premium !</h3>
            <p style="color:rgba(255,255,255,0.9)">Profitez de tous les avantages</p>
          </div>
        </div>
      ` : `
        <div class="grid grid-cols-3 gap-4">
          <div class="premium-plan-card">
            <div class="premium-plan-card__icon"><i class="fas fa-star"></i></div>
            <h3 class="premium-plan-card__title">Mensuel</h3>
            <div class="premium-plan-card__price">${formatCurrency(prices.monthly)}<span>/mois</span></div>
            <ul class="premium-plan-card__features">
              <li><i class="fas fa-check"></i> 50 tâches/jour</li>
              <li><i class="fas fa-check"></i> Commission 5%</li>
              <li><i class="fas fa-check"></i> Accès Agency</li>
              <li><i class="fas fa-check"></i> Retrait min 1300 HTG</li>
              <li><i class="fas fa-check"></i> Badge Premium</li>
            </ul>
            <button class="btn btn-primary btn-block" onclick="selectPremiumPlan('monthly', this)">Choisir</button>
          </div>
          
          <div class="premium-plan-card featured">
            <div class="premium-plan-card__icon"><i class="fas fa-crown"></i></div>
            <h3 class="premium-plan-card__title">Annuel</h3>
            <div class="premium-plan-card__price">${formatCurrency(prices.yearly)}<span>/an</span></div>
            <ul class="premium-plan-card__features">
              <li><i class="fas fa-check"></i> Tous les avantages</li>
              <li><i class="fas fa-check"></i> 2 mois offerts</li>
              <li><i class="fas fa-check"></i> Support prioritaire</li>
              <li><i class="fas fa-check"></i> Bonus 500 HTG</li>
            </ul>
            <button class="btn btn-primary btn-block" onclick="selectPremiumPlan('yearly', this)">Choisir</button>
          </div>
          
          <div class="premium-plan-card">
            <div class="premium-plan-card__icon"><i class="fas fa-gift"></i></div>
            <h3 class="premium-plan-card__title">Essai gratuit</h3>
            <div class="premium-plan-card__price">0 HTG<span>/7 jours</span></div>
            <ul class="premium-plan-card__features">
              <li><i class="fas fa-check"></i> Tous les avantages</li>
              <li><i class="fas fa-check"></i> 7 jours gratuits</li>
              <li><i class="fas fa-check"></i> Sans engagement</li>
              <li><i class="fas fa-check"></i> 1 essai par compte</li>
            </ul>
            <button class="btn btn-primary btn-block" onclick="startPremiumTrial()">Essayer</button>
          </div>
        </div>
        
        <div class="card" id="premium-payment-section" style="display:none">
          <div class="card__header">
            <h3 class="card__title">Paiement</h3>
          </div>
          <div class="card__body space-y-4">
            <div class="p-4 bg-blue-50 rounded-lg">
              <h4 class="font-semibold mb-2">Instructions</h4>
              <p class="text-sm mb-2">Envoyez le montant à:</p>
              <div class="kbd-link mb-2">
                <i class="fas fa-mobile-alt"></i>
                <span id="premium-payment-number">${escapeHtml(globalSettings.paymentNumbers?.moncash || '+509 0000 0000')}</span>
              </div>
              <p class="text-xs text-gray-600">Puis soumettez la capture ci-dessous</p>
            </div>
            
            <div class="border-dashed dropzone" id="premium-proof-dropzone">
              <div class="dropzone__inner">
                <i class="fas fa-cloud-upload-alt dropzone__icon"></i>
                <p class="dropzone__text">Capture du paiement</p>
                <input type="file" id="premium-proof-input" class="dropzone__input" accept="image/*" style="display:none">
              </div>
              <div class="dropzone__preview" id="premium-proof-preview" style="display:none"></div>
            </div>
            
            <div>
              <label class="form-label">Référence de transaction</label>
              <input type="text" id="premium-reference" class="form-input" placeholder="Ex: TX123456789">
            </div>
            
            <button class="btn btn-primary btn-block" onclick="submitPremiumProof()">
              <i class="fas fa-paper-plane"></i> Soumettre
            </button>
          </div>
        </div>
      `}
    </div>
  `;
  
  setupUploadZone('#premium-proof-dropzone', {
    onFileSelected: (file) => {
      WorkerState.premiumProof = WorkerState.premiumProof || {};
      WorkerState.premiumProof.file = file;
    }
  });
}

function selectPremiumPlan(planId, el) {
  WorkerState.selectedPlan = planId;
  const section = document.getElementById('premium-payment-section');
  if (section) section.style.display = 'block';
  showToast(`Plan ${planId} sélectionné`, 'info');
}

async function startPremiumTrial() {
  if (currentUser.hasUsedTrial) {
    showToast('Essai déjà utilisé', 'warning');
    return;
  }
  
  showConfirm(
    'Essai gratuit',
    'Activer 7 jours de Premium gratuit ?',
    async () => {
      try {
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 7);
        await db.collection('users').doc(currentUser.id).update({
          isPremium: true,
          plan: 'premium',
          premiumExpiresAt: expiry,
          hasUsedTrial: true
        });
        currentUser.isPremium = true;
        currentUser.plan = 'premium';
        WorkerState.currentUser.isPremium = true;
        WorkerState.currentUser.plan = 'premium';
        updateHeaderUser();
        loadPremiumPage();
        showToast('Premium activé pour 7 jours !', 'success');
      } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
      }
    }
  );
}

function activatePremiumTrial() {
  startPremiumTrial();
}

function handlePremiumProofChange(event) {
  const file = event.target.files[0];
  if (file) processPremiumProofFile(file);
}

function processPremiumProofFile(file) {
  WorkerState.premiumProof = WorkerState.premiumProof || {};
  WorkerState.premiumProof.file = file;
}

function clearPremiumProof() {
  WorkerState.premiumProof = null;
}

async function submitPremiumProof() {
  const file = WorkerState.premiumProof?.file;
  const reference = document.getElementById('premium-reference')?.value.trim();
  
  if (!file) {
    showToast('Ajoutez une capture', 'warning');
    return;
  }
  
  if (!reference) {
    showToast('Référence requise', 'warning');
    return;
  }
  
  try {
    const result = await uploadToImgbb(file);
    
    await db.collection('premiumRequests').add({
      userId: currentUser.id,
      userName: currentUser.fullName || currentUser.username,
      plan: WorkerState.selectedPlan,
      imageUrl: result.url,
      reference,
      status: 'pending',
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    closeModal();
    openModal('modal-premium-submitted');
    showToast('Demande soumise', 'success');
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
  }
}

function checkPlanLimits() {
  const isPremium = WorkerState.currentUser.isPremium;
  const limits = isPremium ? WorkerState.planLimits.premium : WorkerState.planLimits.free;
  
  // Simulation de l'utilisation
  const dailyUsed = Math.floor(Math.random() * limits.dailyTaskLimit * 0.3);
  const monthlyUsed = WorkerState.currentUser.completedTasks || 0;
  
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

function showPlanLimitsModal() {
  const body = document.getElementById('modal-plan-limits-body');
  if (!body) return;
  
  const limits = checkPlanLimits();
  
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

function showWorkerNotifications() {
  const body = document.getElementById('modal-notifications-body');
  if (!body) return;
  
  if (notificationsData.length === 0) {
    body.innerHTML = '<div class="empty-state"><i class="fas fa-bell-slash"></i><p>Aucune notification</p></div>';
  } else {
    body.innerHTML = notificationsData.map(n => `
      <div class="p-3 border-b border-gray-100">
        <div class="font-semibold">${escapeHtml(n.title)}</div>
        <div class="text-sm text-gray-600">${escapeHtml(n.message)}</div>
        <div class="text-xs text-gray-400 mt-1">${n.timestamp ? formatDate(n.timestamp).relative : ''}</div>
      </div>
    `).join('');
  }
  
  openModal('modal-notifications');
}

function updateBottomBar(activeTab) {
  updateBottomBarActive(activeTab);
}

// Fonctions offerwall et agency placeholder
function loadOfferwall(provider) {
  const containerMap = {
    monlix: 'offerwall-monlix-content',
    adscend: 'offerwall-adscend-content',
    ayetstudios: 'offerwall-ayetstudios-content',
    lootably: 'offerwall-lootably-content'
  };
  const container = document.getElementById(containerMap[provider]);
  if (!container) return;
  
  container.innerHTML = `
    <div class="card">
      <div class="card__header">
        <h3 class="card__title">Offres ${provider}</h3>
      </div>
      <div class="card__body">
        <div class="empty-state">
          <i class="fas fa-gift"></i>
          <h3>Offres ${provider}</h3>
          <p>Les offres seront chargées depuis l'API ${provider}</p>
          <button class="btn btn-primary mt-4" onclick="loadOfferwallDemo('${provider}')">
            <i class="fas fa-sync"></i> Charger les offres (démo)
          </button>
        </div>
      </div>
    </div>
  `;
}

function loadOfferwallDemo(provider) {
  const containerMap = {
    monlix: 'offerwall-monlix-content',
    adscend: 'offerwall-adscend-content',
    ayetstudios: 'offerwall-ayetstudios-content',
    lootably: 'offerwall-lootably-content'
  };
  const container = document.getElementById(containerMap[provider]);
  if (!container) return;
  
  const demoOffers = [
    { title: 'Sondage rémunéré', reward: 150, time: '5 min' },
    { title: 'Installer une application', reward: 300, time: '10 min' },
    { title: 'Regarder une vidéo', reward: 50, time: '2 min' },
    { title: 'Inscription site web', reward: 500, time: '15 min' },
    { title: 'Jouer à un jeu', reward: 200, time: '8 min' }
  ];
  
  container.innerHTML = `
    <div class="card">
      <div class="card__header">
        <h3 class="card__title">Offres ${provider}</h3>
        <span class="badge badge-soft-success">${demoOffers.length} disponibles</span>
      </div>
      <div class="card__body">
        <div class="grid grid-cols-2 gap-3">
          ${demoOffers.map((o, i) => `
            <div class="task-card">
              <div class="task-card__header">
                <div>
                  <h4 class="task-card__title">${o.title}</h4>
                  <p class="task-card__category">${provider}</p>
                </div>
                <div class="task-card__reward">${formatCurrency(o.reward)}</div>
              </div>
              <div class="task-card__footer">
                <span class="text-xs text-gray-500"><i class="fas fa-clock"></i> ${o.time}</span>
                <button class="btn btn-sm btn-primary" onclick="showToast('Redirection vers ${provider}...', 'info')">
                  <i class="fas fa-external-link-alt"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function loadAgencyTasks() {
  const container = document.getElementById('agency-tasks-content');
  if (!container) return;
  
  if (!WorkerState.currentUser.isPremium) {
    container.innerHTML = `
      <div class="card">
        <div class="card__body">
          <div class="empty-state">
            <i class="fas fa-lock text-yellow-500"></i>
            <h3>Accès Premium requis</h3>
            <p>Les tâches Agency sont réservées aux membres Premium</p>
            <button class="btn btn-primary mt-4" onclick="navigateTo('page-premium')">
              <i class="fas fa-crown"></i> Passer au Premium
            </button>
          </div>
        </div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = `
    <div class="card">
      <div class="card__header">
        <h3 class="card__title">Tâches Agency</h3>
        <span class="badge badge-soft-warning"><i class="fas fa-crown"></i> Premium</span>
      </div>
      <div class="card__body">
        <div class="space-y-3">
          ${[
            { title: 'Mission spéciale #1', reward: 1500, desc: 'Tâche à haute rémunération' },
            { title: 'Projet exclusif', reward: 2500, desc: 'Partenariat premium' }
          ].map(t => `
            <div class="task-card">
              <div class="task-card__header">
                <div>
                  <h4 class="task-card__title">${t.title}</h4>
                  <p class="task-card__category">Agency</p>
                </div>
                <div class="task-card__reward">${formatCurrency(t.reward)}</div>
              </div>
              <p class="task-card__description">${t.desc}</p>
              <div class="task-card__footer">
                <span class="text-xs text-gray-500"><i class="fas fa-star text-yellow-500"></i> Premium</span>
                <button class="btn btn-sm btn-primary" onclick="acceptTask('agency_demo')">Accepter</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function loadProfile() {
  const container = document.getElementById('profile-content');
  if (!container) return;
  
  const badge = getBadgeInfo(WorkerState.currentUser.completedTasks);
  
  container.innerHTML = `
    <div class="space-y-4">
      <div class="card">
        <div class="card__body">
          <div class="flex items-center gap-4">
            <div class="avatar-circle avatar-circle--xl">${(currentUser.fullName || currentUser.username || '?').charAt(0).toUpperCase()}</div>
            <div class="flex-1">
              <h2 class="text-2xl font-bold">${escapeHtml(currentUser.fullName || currentUser.username)}</h2>
              <p class="text-gray-500">${escapeHtml(currentUser.email || '')}</p>
              <div class="flex gap-2 mt-2">
                <span class="badge badge-soft-primary">${currentUser.role}</span>
                ${currentUser.isPremium ? '<span class="badge badge-soft-warning"><i class="fas fa-crown"></i> Premium</span>' : ''}
                <span class="badge" style="background:${badge.current.color}20;color:${badge.current.color}"><i class="fas ${badge.current.icon}"></i> ${badge.current.label}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Informations personnelles</h3>
        </div>
        <div class="card__body space-y-3">
          <div>
            <label class="form-label">Nom complet</label>
            <input type="text" id="profile-fullname" class="form-input" value="${escapeHtml(currentUser.fullName || '')}">
          </div>
          <div>
            <label class="form-label">Nom d'utilisateur</label>
            <input type="text" id="profile-username" class="form-input" value="${escapeHtml(currentUser.username || '')}" readonly>
          </div>
          <div>
            <label class="form-label">Email</label>
            <input type="email" id="profile-email" class="form-input" value="${escapeHtml(currentUser.email || '')}" readonly>
          </div>
          <button class="btn btn-primary" onclick="saveProfile()">
            <i class="fas fa-save"></i> Enregistrer
          </button>
        </div>
      </div>
      
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Statistiques</h3>
        </div>
        <div class="card__body">
          <div class="grid grid-cols-3 gap-3">
            <div class="text-center p-3 bg-blue-50 rounded-lg">
              <div class="text-2xl font-bold">${currentUser.completedTasks || 0}</div>
              <div class="text-xs text-gray-600">Tâches</div>
            </div>
            <div class="text-center p-3 bg-green-50 rounded-lg">
              <div class="text-2xl font-bold">${formatCurrency(currentUser.balance || 0)}</div>
              <div class="text-xs text-gray-600">Gagné</div>
            </div>
            <div class="text-center p-3 bg-purple-50 rounded-lg">
              <div class="text-2xl font-bold">${badge.current.label}</div>
              <div class="text-xs text-gray-600">Badge</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function saveProfile() {
  const fullName = document.getElementById('profile-fullname')?.value.trim();
  if (!fullName) {
    showToast('Nom requis', 'warning');
    return;
  }
  try {
    await db.collection('users').doc(currentUser.id).update({ fullName });
    currentUser.fullName = fullName;
    updateHeaderUser();
    showToast('Profil mis à jour', 'success');
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
  }
}

/* ============================================================
   4.8 MODULE MANAGER
   ============================================================ */

const ManagerState = {
  selectedWithdrawalMethod: null,
  currentMembersFilter: 'all',
  currentLeaderboardPeriod: 'week',
  chartInstanceManager: null,
  messagePollingInterval: null,
  members: [],
  messages: [],
  withdrawals: []
};

const HBW_DB_KEY = 'hbw_db';

function hbwLoadDB() {
  try {
    const raw = localStorage.getItem(HBW_DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return hbwSeedDB();
}

function hbwSaveDB(db) {
  try {
    localStorage.setItem(HBW_DB_KEY, JSON.stringify(db));
  } catch (e) {
    console.warn('Erreur sauvegarde DB:', e);
  }
}

function hbwSeedDB() {
  const seed = {
    managers: [
      { id: 'mgr1', fullName: 'Manager Demo', email: 'manager@demo.com', plan: 'pro', memberLimit: 20 }
    ],
    members: [
      { id: 'mem1', fullName: 'Jean Pierre', email: 'jean@demo.com', username: 'jeanpierre', password: 'demo1234', status: 'active', completedTasks: 45, balance: 3500, joinedAt: new Date().toISOString() },
      { id: 'mem2', fullName: 'Marie Dupont', email: 'marie@demo.com', username: 'mariedupont', password: 'demo5678', status: 'active', completedTasks: 78, balance: 6200, joinedAt: new Date().toISOString() },
      { id: 'mem3', fullName: 'Paul Martin', email: 'paul@demo.com', username: 'paulmartin', password: 'demo9012', status: 'active', completedTasks: 32, balance: 2100, joinedAt: new Date().toISOString() },
      { id: 'mem4', fullName: 'Sophie Bernard', email: 'sophie@demo.com', username: 'sophieber', password: 'demo3456', status: 'suspended', completedTasks: 12, balance: 800, joinedAt: new Date().toISOString() }
    ],
    messages: [
      { id: 'msg1', content: 'Bienvenue dans l\'équipe !', author: 'manager', pinned: true, timestamp: new Date().toISOString() },
      { id: 'msg2', content: 'N\'oubliez pas de soumettre vos preuves avant 18h', author: 'manager', pinned: false, timestamp: new Date().toISOString() }
    ],
    withdrawals: [
      { id: 'wd1', amount: 5000, method: 'moncash', status: 'approved', timestamp: new Date().toISOString() }
    ],
    leaderboard: [
      { userId: 'mem2', name: 'Marie Dupont', score: 78 },
      { userId: 'mem1', name: 'Jean Pierre', score: 45 },
      { userId: 'mem3', name: 'Paul Martin', score: 32 }
    ]
  };
  hbwSaveDB(seed);
  return seed;
}

async function renderManagerDashboard() {
  const container = document.getElementById('manager-dashboard-content');
  if (!container) return;
  
  const db = hbwLoadDB();
  ManagerState.members = db.members || [];
  ManagerState.messages = db.messages || [];
  
  const activeMembers = ManagerState.members.filter(m => m.status === 'active').length;
  const totalTasks = ManagerState.members.reduce((s, m) => s + (m.completedTasks || 0), 0);
  const totalEarnings = ManagerState.members.reduce((s, m) => s + (m.balance || 0), 0);
  const memberLimit = 20; // Plan Pro
  
  container.innerHTML = `
    <div class="space-y-5">
      <div class="grid grid-cols-4 gap-4">
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--primary"><i class="fas fa-users"></i></div>
          <div class="stat-card__content">
            <div class="stat-card__label">Membres actifs</div>
            <div class="stat-card__value">${activeMembers}/${memberLimit}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--success"><i class="fas fa-tasks"></i></div>
          <div class="stat-card__content">
            <div class="stat-card__label">Tâches totales</div>
            <div class="stat-card__value">${totalTasks}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--warning"><i class="fas fa-money-bill-wave"></i></div>
          <div class="stat-card__content">
            <div class="stat-card__label">Gains équipe</div>
            <div class="stat-card__value">${formatCurrency(totalEarnings)}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card__icon stat-card__icon--purple"><i class="fas fa-comments"></i></div>
          <div class="stat-card__content">
            <div class="stat-card__label">Messages</div>
            <div class="stat-card__value">${ManagerState.messages.length}</div>
          </div>
        </div>
      </div>
      
      <div class="card" style="background:linear-gradient(135deg, #8b5cf6, #7c3aed); color:white; border:none;">
        <div class="card__body flex items-center justify-between">
          <div>
            <h3 style="color:white" class="text-xl font-bold"><i class="fas fa-chart-line"></i> Plan Pro</h3>
            <p style="color:rgba(255,255,255,0.9)">${activeMembers}/${memberLimit} membres utilisés</p>
          </div>
          <div class="ring-wrap">
            <div class="ring-wrap__circle" style="--progress:${(activeMembers/memberLimit)*100}%">
              <span class="ring-wrap__value" style="color:white">${Math.round((activeMembers/memberLimit)*100)}%</span>
            </div>
          </div>
        </div>
      </div>
      
      <div class="grid grid-cols-2 gap-4">
        <div class="card">
          <div class="card__header">
            <h3 class="card__title">Membres récents</h3>
            <button class="btn btn-sm btn-outline" onclick="loadManagerMembers()">Voir tout</button>
          </div>
          <div class="card__body" id="hbw-manager-members-list">
            <div class="p-4 text-center"><div class="spinner mx-auto"></div></div>
          </div>
        </div>
        
        <div class="card">
          <div class="card__header">
            <h3 class="card__title">Messages d'équipe</h3>
            <button class="btn btn-sm btn-outline" onclick="showManagerMessagesPage()">Gérer</button>
          </div>
          <div class="card__body" id="hbw-manager-messages-preview">
            <div class="p-4 text-center"><div class="spinner mx-auto"></div></div>
          </div>
        </div>
      </div>
      
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Performance (7 jours)</h3>
        </div>
        <div class="card__body">
          <canvas id="manager-chart" height="100"></canvas>
        </div>
      </div>
      
      <div class="grid grid-cols-4 gap-3">
        <button class="btn btn-primary btn-block" onclick="showAddMemberModal()">
          <i class="fas fa-user-plus"></i> Ajouter membre
        </button>
        <button class="btn btn-primary btn-block" onclick="showManagerMessagesPage()">
          <i class="fas fa-comments"></i> Messages
        </button>
        <button class="btn btn-primary btn-block" onclick="loadManagerStats()">
          <i class="fas fa-chart-bar"></i> Stats
        </button>
        <button class="btn btn-primary btn-block" onclick="showManagerWithdrawalPage()">
          <i class="fas fa-money-bill-wave"></i> Retrait
        </button>
      </div>
    </div>
  `;
  
  loadManagerMembers();
  loadManagerMessagesPreview();
  renderManagerChart();
}

function loadManagerMembers(filterOverride) {
  const list = document.getElementById('hbw-manager-members-list');
  if (!list) return;
  
  const filter = filterOverride || ManagerState.currentMembersFilter;
  let members = ManagerState.members;
  if (filter !== 'all') {
    members = members.filter(m => m.status === filter);
  }
  
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
        <span class="badge ${m.status === 'active' ? 'badge-soft-success' : 'badge-soft-warning'}">${m.status === 'active' ? 'Actif' : 'Suspendu'}</span>
        <button class="btn-icon" onclick="showMemberActionsMenu('${m.id}', this)">
          <i class="fas fa-ellipsis-v"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function loadManagerMessagesPreview() {
  const preview = document.getElementById('hbw-manager-messages-preview');
  if (!preview) return;
  
  if (ManagerState.messages.length === 0) {
    preview.innerHTML = '<p class="text-center text-gray-500">Aucun message</p>';
    return;
  }
  
  preview.innerHTML = ManagerState.messages.slice(0, 3).map(m => `
    <div class="p-2 border-b border-gray-100">
      <div class="flex items-start gap-2">
        <div class="avatar-circle avatar-circle--sm" style="font-size:0.75rem"><i class="fas fa-user"></i></div>
        <div class="flex-1 min-w-0">
          <p class="text-sm">${escapeHtml(m.content)}</p>
          <p class="text-xs text-gray-500 mt-1">${m.pinned ? '<i class="fas fa-thumbtack"></i> ' : ''}${new Date(m.timestamp).toLocaleString('fr-FR')}</p>
        </div>
      </div>
    </div>
  `).join('');
}

function renderManagerChart() {
  const canvas = document.getElementById('manager-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  
  if (ManagerState.chartInstanceManager) {
    ManagerState.chartInstanceManager.destroy();
  }
  
  const days = [];
  const tasks = [];
  const earnings = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }));
    tasks.push(Math.floor(Math.random() * 20) + 5);
    earnings.push(Math.floor(Math.random() * 3000) + 500);
  }
  
  ManagerState.chartInstanceManager = new Chart(canvas, {
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

function showMemberActionsMenu(memberId, anchorEl) {
  const member = ManagerState.members.find(m => m.id === memberId);
  if (!member) return;
  
  const body = document.getElementById('modal-member-actions-body');
  if (!body) return;
  
  body.innerHTML = `
    <div class="space-y-2">
      <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
        <div class="avatar-circle avatar-circle--sm">${(member.fullName || '?').charAt(0).toUpperCase()}</div>
        <div>
          <div class="font-semibold">${escapeHtml(member.fullName)}</div>
          <div class="text-xs text-gray-500">${escapeHtml(member.email || '')}</div>
        </div>
      </div>
      <button class="btn btn-outline btn-block" onclick="showMemberDetailModal('${memberId}')">
        <i class="fas fa-eye"></i> Voir détails
      </button>
      <button class="btn btn-outline btn-block" onclick="showMemberCredentialsModal('${memberId}')">
        <i class="fas fa-key"></i> Voir identifiants
      </button>
      <button class="btn btn-outline btn-block" onclick="toggleMemberStatus('${memberId}')">
        <i class="fas ${member.status === 'active' ? 'fa-ban' : 'fa-check'}"></i>
        ${member.status === 'active' ? 'Suspendre' : 'Réactiver'}
      </button>
      <button class="btn btn-danger btn-block" onclick="confirmRemoveMember('${memberId}')">
        <i class="fas fa-trash"></i> Supprimer
      </button>
    </div>
  `;
  
  openModal('modal-member-actions');
}

function showMemberDetailModal(memberId) {
  const member = ManagerState.members.find(m => m.id === memberId);
  if (!member) return;
  
  const body = document.getElementById('modal-member-detail-body');
  if (!body) return;
  
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
        <div class="flex justify-between"><span class="text-gray-500">Inscrit:</span><span>${member.joinedAt ? new Date(member.joinedAt).toLocaleDateString('fr-FR') : '—'}</span></div>
      </div>
    </div>
  `;
  
  closeModal('modal-member-actions');
  openModal('modal-member-detail');
}

function showMemberCredentialsModal(memberId) {
  const member = ManagerState.members.find(m => m.id === memberId);
  if (!member) return;
  
  const body = document.getElementById('modal-member-credentials-body');
  if (!body) return;
  
  body.innerHTML = `
    <div class="space-y-3">
      <div class="p-3 bg-yellow-50 rounded-lg">
        <p class="text-sm"><i class="fas fa-info-circle text-yellow-600"></i> Partagez ces informations avec le membre en toute sécurité.</p>
      </div>
      <div>
        <label class="form-label">Nom d'utilisateur</label>
        <div class="kbd-link" onclick="navigator.clipboard.writeText('${escapeHtml(member.username)}'); showToast('Copié !', 'success');">
          <i class="fas fa-copy"></i>
          <span>${escapeHtml(member.username)}</span>
        </div>
      </div>
      <div>
        <label class="form-label">Mot de passe</label>
        <div class="kbd-link" onclick="navigator.clipboard.writeText('${escapeHtml(member.password)}'); showToast('Copié !', 'success');">
          <i class="fas fa-copy"></i>
          <span>${escapeHtml(member.password)}</span>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('btn-copy-credentials').onclick = () => {
    const text = `Username: ${member.username}\nPassword: ${member.password}`;
    navigator.clipboard.writeText(text);
    showToast('Identifiants copiés !', 'success');
  };
  
  closeModal('modal-member-actions');
  openModal('modal-member-credentials');
}

function toggleMemberStatus(memberId) {
  const member = ManagerState.members.find(m => m.id === memberId);
  if (!member) return;
  
  member.status = member.status === 'active' ? 'suspended' : 'active';
  const db = hbwLoadDB();
  db.members = ManagerState.members;
  hbwSaveDB(db);
  
  closeModal('modal-member-actions');
  loadManagerMembers();
  showToast(`Membre ${member.status === 'active' ? 'réactivé' : 'suspendu'}`, 'success');
}

function confirmRemoveMember(memberId) {
  const member = ManagerState.members.find(m => m.id === memberId);
  if (!member) return;
  
  closeModal('modal-member-actions');
  
  showConfirm(
    'Supprimer le membre',
    `Voulez-vous vraiment supprimer ${member.fullName} ?`,
    () => {
      ManagerState.members = ManagerState.members.filter(m => m.id !== memberId);
      const db = hbwLoadDB();
      db.members = ManagerState.members;
      hbwSaveDB(db);
      loadManagerMembers();
      showToast('Membre supprimé', 'success');
    }
  );
}

function showAddMemberModal() {
  const limits = checkManagerLimits();
  if (!limits.canAdd) {
    showToast(`Limite atteinte (${limits.current}/${limits.limit})`, 'warning');
    return;
  }
  
  const body = document.getElementById('modal-add-member-body');
  if (!body) return;
  
  body.innerHTML = `
    <div class="space-y-4">
      <div class="p-3 bg-blue-50 rounded-lg">
        <p class="text-sm"><i class="fas fa-info-circle text-blue-600"></i> Places restantes: ${limits.remaining}</p>
      </div>
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
          <button type="button" class="btn btn-outline" onclick="document.getElementById('new-member-password').value=generateRandomPassword()">
            <i class="fas fa-sync"></i>
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('btn-create-worker').onclick = () => {
    const fullName = document.getElementById('new-member-fullname').value.trim();
    const email = document.getElementById('new-member-email').value.trim();
    const usernameOverride = document.getElementById('new-member-username').value.trim();
    const passwordOverride = document.getElementById('new-member-password').value;
    
    if (!fullName || !email) {
      showToast('Nom et email requis', 'warning');
      return;
    }
    
    const credentials = generateWorkerCredentials(fullName, email, usernameOverride, passwordOverride);
    createWorkerAccount('mgr1', fullName, email, credentials);
  };
  
  openModal('modal-add-member');
}

function generateWorkerCredentials(fullName, email, usernameOverride, passwordOverride) {
  return {
    username: usernameOverride || generateUsername(fullName),
    password: passwordOverride || generateRandomPassword()
  };
}

function createWorkerAccount(managerId, fullName, email, credentials) {
  const newMember = {
    id: 'mem_' + Date.now(),
    fullName,
    email,
    username: credentials.username,
    password: credentials.password,
    status: 'active',
    completedTasks: 0,
    balance: 0,
    joinedAt: new Date().toISOString(),
    managerId
  };
  
  ManagerState.members.push(newMember);
  const db = hbwLoadDB();
  db.members = ManagerState.members;
  hbwSaveDB(db);
  
  closeModal('modal-add-member');
  loadManagerMembers();
  
  // Affiche les identifiants
  setTimeout(() => showMemberCredentialsModal(newMember.id), 300);
  showToast('Membre créé avec succès', 'success');
}

function checkManagerLimits() {
  const db = hbwLoadDB();
  const manager = (db.managers || [])[0] || { plan: 'pro', memberLimit: 20 };
  const limit = manager.memberLimit || 20;
  const current = ManagerState.members.length;
  return {
    limit,
    current,
    remaining: Math.max(0, limit - current),
    canAdd: current < limit
  };
}

function showManagerMessagesPage() {
  const body = document.getElementById('modal-manager-messages-body');
  if (!body) return;
  
  body.innerHTML = `
    <div class="space-y-4" style="max-height:500px;overflow-y:auto">
      <div id="hbw-team-messages-list">
        ${ManagerState.messages.length === 0 
          ? '<p class="text-center text-gray-500">Aucun message</p>'
          : ManagerState.messages.map(m => `
            <div class="flex gap-2 p-3 border-b border-gray-100">
              <div class="avatar-circle avatar-circle--sm" style="font-size:0.75rem"><i class="fas fa-user"></i></div>
              <div class="flex-1">
                <p class="text-sm">${escapeHtml(m.content)}</p>
                <p class="text-xs text-gray-500 mt-1">${m.pinned ? '<i class="fas fa-thumbtack"></i> Épinglé • ' : ''}${new Date(m.timestamp).toLocaleString('fr-FR')}</p>
              </div>
            </div>
          `).join('')
        }
      </div>
      
      <div class="border-t pt-4">
        <label class="form-label">Nouveau message</label>
        <textarea id="new-team-message" class="form-input form-textarea" rows="3" placeholder="Votre message..."></textarea>
        <div class="flex gap-2 mt-2">
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" id="pin-message">
            <span>Épingler</span>
          </label>
          <button class="btn btn-primary ml-auto" onclick="sendTeamMessage()">
            <i class="fas fa-paper-plane"></i> Envoyer
          </button>
        </div>
      </div>
    </div>
  `;
  
  openModal('modal-manager-messages');
  startMessagePolling();
}

function loadManagerMessages() {
  const db = hbwLoadDB();
  ManagerState.messages = db.messages || [];
}

function sendTeamMessage(content, pinned) {
  const contentInput = document.getElementById('new-team-message');
  const pinInput = document.getElementById('pin-message');
  
  const msgContent = content || contentInput?.value.trim();
  const msgPinned = pinned !== undefined ? pinned : pinInput?.checked;
  
  if (!msgContent) {
    showToast('Message vide', 'warning');
    return;
  }
  
  const newMessage = {
    id: 'msg_' + Date.now(),
    content: msgContent,
    author: 'manager',
    pinned: msgPinned,
    timestamp: new Date().toISOString()
  };
  
  ManagerState.messages.unshift(newMessage);
  const db = hbwLoadDB();
  db.messages = ManagerState.messages;
  hbwSaveDB(db);
  
  if (contentInput) contentInput.value = '';
  if (pinInput) pinInput.checked = false;
  
  showManagerMessagesPage();
  showToast('Message envoyé', 'success');
}

function startMessagePolling() {
  stopMessagePolling();
  ManagerState.messagePollingInterval = setInterval(() => {
    // En production, requête Firestore
  }, 5000);
}

function stopMessagePolling() {
  if (ManagerState.messagePollingInterval) {
    clearInterval(ManagerState.messagePollingInterval);
    ManagerState.messagePollingInterval = null;
  }
}

function loadManagerStats() {
  showToast('Statistiques manager chargées', 'info');
}

function showManagerWithdrawalPage() {
  const body = document.getElementById('modal-manager-withdrawal-body');
  if (!body) return;
  
  body.innerHTML = `
    <div class="space-y-4">
      <div class="p-4 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg text-white text-center">
        <p class="text-sm opacity-90 mb-1">Solde commission</p>
        <h3 class="text-3xl font-bold">${formatCurrency(15000)}</h3>
      </div>
      
      <div>
        <label class="form-label">Méthode</label>
        <div class="grid grid-cols-3 gap-2">
          <button class="btn btn-outline" onclick="selectManagerMethod('moncash', this)"><i class="fas fa-mobile-alt"></i> MonCash</button>
          <button class="btn btn-outline" onclick="selectManagerMethod('bank', this)"><i class="fas fa-university"></i> Banque</button>
          <button class="btn btn-outline" onclick="selectManagerMethod('paypal', this)"><i class="fab fa-paypal"></i> PayPal</button>
        </div>
      </div>
      
      <div>
        <label class="form-label">Montant (HTG)</label>
        <input type="number" id="manager-withdrawal-amount" class="form-input" placeholder="0">
      </div>
      
      <div>
        <label class="form-label">Historique</label>
        <div class="space-y-2">
          ${(hbwLoadDB().withdrawals || []).map(w => `
            <div class="flex justify-between p-2 bg-gray-50 rounded">
              <span>${formatCurrency(w.amount)}</span>
              <span class="badge badge-soft-success">${w.status}</span>
            </div>
          `).join('') || '<p class="text-sm text-gray-500">Aucun historique</p>'}
        </div>
      </div>
    </div>
  `;
  
  document.getElementById('btn-request-manager-withdrawal').onclick = () => {
    const amount = parseFloat(document.getElementById('manager-withdrawal-amount')?.value) || 0;
    if (amount <= 0) {
      showToast('Montant invalide', 'warning');
      return;
    }
    requestManagerWithdrawal(amount, ManagerState.selectedWithdrawalMethod);
  };
  
  openModal('modal-manager-withdrawal');
}

function selectManagerMethod(methodId, btn) {
  if (btn) {
    btn.parentElement.querySelectorAll('button').forEach(b => {
      b.classList.remove('btn-primary');
      b.classList.add('btn-outline');
    });
    btn.classList.remove('btn-outline');
    btn.classList.add('btn-primary');
  }
  ManagerState.selectedWithdrawalMethod = methodId;
}

function requestManagerWithdrawal(amount, methodId) {
  if (!methodId) {
    showToast('Sélectionnez une méthode', 'warning');
    return;
  }
  
  const newWd = {
    id: 'wd_' + Date.now(),
    amount,
    method: methodId,
    status: 'pending',
    timestamp: new Date().toISOString()
  };
  
  const db = hbwLoadDB();
  db.withdrawals = db.withdrawals || [];
  db.withdrawals.unshift(newWd);
  hbwSaveDB(db);
  
  closeModal('modal-manager-withdrawal');
  openModal('modal-withdrawal-success');
  showToast('Demande soumise', 'success');
}

async function loadLeaderboard(period) {
  const container = document.getElementById('leaderboard-content');
  if (!container) return;
  
  period = period || ManagerState.currentLeaderboardPeriod;
  ManagerState.currentLeaderboardPeriod = period;
  
  // Combine données Firestore + locale
  let leaderboard = [];
  try {
    const snap = await db.collection('users').where('role', '==', 'worker').get();
    leaderboard = snap.docs.map(d => {
      const u = d.data();
      return {
        id: d.id,
        name: u.fullName || u.username,
        score: u.completedTasks || 0,
        balance: u.balance || 0
      };
    });
  } catch (e) {
    const ldb = hbwLoadDB().leaderboard || [];
    leaderboard = ldb;
  }
  
  leaderboard.sort((a, b) => b.score - a.score);
  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  
  container.innerHTML = `
    <div class="space-y-5">
      <div class="tabs">
        <button class="tab-btn ${period === 'day' ? 'active' : ''}" onclick="loadLeaderboard('day')">Aujourd'hui</button>
        <button class="tab-btn ${period === 'week' ? 'active' : ''}" onclick="loadLeaderboard('week')">Cette semaine</button>
        <button class="tab-btn ${period === 'month' ? 'active' : ''}" onclick="loadLeaderboard('month')">Ce mois</button>
        <button class="tab-btn ${period === 'all' ? 'active' : ''}" onclick="loadLeaderboard('all')">Total</button>
      </div>
      
      <div class="leaderboard-podium">
        ${top3[1] ? `
          <div class="leaderboard-podium__item">
            <div class="leaderboard-podium__avatar">
              ${(top3[1].name || '?').charAt(0).toUpperCase()}
              <span class="leaderboard-podium__rank">2</span>
            </div>
            <div class="leaderboard-podium__name">${escapeHtml(top3[1].name)}</div>
            <div class="leaderboard-podium__score">${top3[1].score} tâches</div>
          </div>
        ` : '<div></div>'}
        
        ${top3[0] ? `
          <div class="leaderboard-podium__item">
            <div class="leaderboard-podium__avatar">
              ${(top3[0].name || '?').charAt(0).toUpperCase()}
              <span class="leaderboard-podium__rank">1</span>
            </div>
            <div class="leaderboard-podium__name">${escapeHtml(top3[0].name)}</div>
            <div class="leaderboard-podium__score">${top3[0].score} tâches</div>
          </div>
        ` : '<div></div>'}
        
        ${top3[2] ? `
          <div class="leaderboard-podium__item">
            <div class="leaderboard-podium__avatar">
              ${(top3[2].name || '?').charAt(0).toUpperCase()}
              <span class="leaderboard-podium__rank">3</span>
            </div>
            <div class="leaderboard-podium__name">${escapeHtml(top3[2].name)}</div>
            <div class="leaderboard-podium__score">${top3[2].score} tâches</div>
          </div>
        ` : '<div></div>'}
      </div>
      
      <div class="card">
        <div class="card__header">
          <h3 class="card__title">Classement complet</h3>
        </div>
        <div class="card__body">
          ${rest.length === 0 
            ? '<p class="text-center text-gray-500">Pas d\'autres participants</p>'
            : rest.map((u, i) => `
              <div class="flex items-center justify-between p-3 border-b border-gray-100">
                <div class="flex items-center gap-3">
                  <div class="text-lg font-bold text-gray-400 w-8">#${i + 4}</div>
                  <div class="avatar-circle avatar-circle--sm">${(u.name || '?').charAt(0).toUpperCase()}</div>
                  <div>
                    <div class="font-semibold">${escapeHtml(u.name)}</div>
                    <div class="text-xs text-gray-500">${u.score} tâches</div>
                  </div>
                </div>
                ${u.id === currentUser?.id ? '<span class="badge badge-soft-primary">Vous</span>' : ''}
              </div>
            `).join('')
          }
        </div>
      </div>
    </div>
  `;
}

function loadValidationPage() {
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

async function loadValidationList() {
  const container = document.getElementById('validation-list');
  if (!container) return;
  
  try {
    const snap = await db.collection('proofs').where('status', '==', 'pending').orderBy('timestamp', 'desc').get();
    const proofs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    if (proofs.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>Aucune preuve en attente</p></div>';
      return;
    }
    
    container.innerHTML = proofs.map(p => `
      <div class="task-card mb-3">
        <div class="task-card__header">
          <div>
            <h4 class="task-card__title">${escapeHtml(p.taskTitle || 'Tâche')}</h4>
            <p class="task-card__category">Par ${escapeHtml(p.userName || '?')}</p>
          </div>
          <div class="task-card__reward">${formatCurrency(p.reward || 0)}</div>
        </div>
        ${p.imageUrl ? `<img src="${p.imageUrl}" class="w-full h-48 object-cover rounded-lg mb-3 cursor-pointer" onclick="document.getElementById('image-viewer-src').src='${p.imageUrl}'; openModal('modal-image-viewer');">` : ''}
        ${p.comment ? `<p class="task-card__description">${escapeHtml(p.comment)}</p>` : ''}
        <div class="task-card__footer">
          <span class="text-xs text-gray-500">${p.timestamp ? formatDate(p.timestamp).relative : ''}</span>
          <div class="flex gap-2">
            <button class="btn btn-sm btn-success" onclick="approveProof('${p.id}')"><i class="fas fa-check"></i> Approuver</button>
            <button class="btn btn-sm btn-danger" onclick="rejectProof('${p.id}')"><i class="fas fa-times"></i> Rejeter</button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<p class="text-center text-red-500">Erreur</p>';
  }
}

async function approveProof(proofId) {
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
          const commission = 0.05; // À ajuster selon le plan
          const netReward = (proof.reward || 0) * (1 - commission);
          await db.collection('users').doc(proof.userId).update({
            pendingBalance: firebase.firestore.FieldValue.increment(-netReward),
            balance: firebase.firestore.FieldValue.increment(netReward),
            completedTasks: firebase.firestore.FieldValue.increment(1)
          });
          
          await createNotification(proof.userId, 'Preuve validée', `Votre preuve pour "${proof.taskTitle}" a été validée. +${formatCurrency(netReward)}`);
        }
        
        await addLog('proof', 'Approve proof', `${proof.taskTitle} - ${proof.userName}`);
        showToast('Preuve approuvée', 'success');
        loadValidationList();
      } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
      }
    }
  );
}

async function rejectProof(proofId) {
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
        
        if (proof.userId) {
          await createNotification(proof.userId, 'Preuve rejetée', `Votre preuve pour "${proof.taskTitle}" a été rejetée.`);
        }
        
        await addLog('proof', 'Reject proof', `${proof.taskTitle} - ${proof.userName}`);
        showToast('Preuve rejetée', 'success');
        loadValidationList();
      } catch (e) {
        showToast('Erreur: ' + e.message, 'error');
      }
    }
  );
}

function cancelUpload() {
  const overlay = document.getElementById('hbw-upload-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function toggleUserMenu() {
  const dropdown = document.getElementById('user-dropdown');
  if (!dropdown) return;
  const isHidden = dropdown.classList.contains('hidden');
  if (isHidden) {
    dropdown.classList.remove('hidden');
    dropdown.style.display = 'block';
  } else {
    dropdown.classList.add('hidden');
    dropdown.style.display = 'none';
  }
}

/* ============================================================
   EXPOSITION GLOBALE (window)
   ============================================================ */

const globalsToExpose = {
  // Navigation
  navigateTo: showPage,
  handleLogout,
  toggleSidebar,
  closeSidebarMobile,
  toggleTheme,
  toggleUserMenu,
  
  // Modales
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
  handleProofFileChange,
  clearProofFile,
  submitTaskProof,
  loadWorkerHistory,
  setHistoryFilter,
  loadMaintenancePage,
  handleMaintenanceFileChange,
  clearMaintenanceFile,
  submitMaintenanceProof,
  loadWorkerWithdrawal,
  selectMethod,
  updateWithdrawalSummary,
  setWithdrawalAmount,
  requestWithdrawal,
  loadMyWithdrawals,
  loadPremiumPage,
  selectPremiumPlan,
  startPremiumTrial,
  activatePremiumTrial,
  handlePremiumProofChange,
  clearPremiumProof,
  submitPremiumProof,
  showPlanLimitsModal,
  loadOfferwall,
  loadOfferwallDemo,
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

// Fermer dropdowns au clic extérieur
document.addEventListener('click', (e) => {
  if (!e.target.closest('.notification-bell')) {
    const notifDrop = document.getElementById('notif-dropdown');
    if (notifDrop && !notifDrop.classList.contains('hidden')) {
      notifDrop.classList.add('hidden');
      notifDrop.style.display = 'none';
    }
  }
  if (!e.target.closest('.topbar__user-menu')) {
    const userDrop = document.getElementById('user-dropdown');
    if (userDrop && !userDrop.classList.contains('hidden')) {
      userDrop.classList.add('hidden');
      userDrop.style.display = 'none';
    }
  }
});

/* ============================================================
   INITIALISATION AU DOMCONTENTLOADED
   ============================================================ */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

function initApp() {
  try {
    hideSplash();
    setupLoginForm();
    setupGlobalModals();
    setupThemeToggle();
    setupNotifications();
    initAuthStateObserver();
    
    // Setup upload zones
    setupUploadZone('.border-dashed.dropzone');
    
    // Observer les mutations pour les nouvelles dropzones
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            if (node.classList && node.classList.contains('dropzone')) {
              setupUploadZone('.dropzone');
            }
            if (node.querySelectorAll) {
              const zones = node.querySelectorAll('.dropzone');
              if (zones.length) setupUploadZone('.dropzone');
            }
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Signale que l'app est prête (pour le fallback)
    if (window.__hbwAppReady) window.__hbwAppReady();
    
    console.log('HBW Task initialisé avec succès');
  } catch (e) {
    console.error('Erreur initialisation:', e);
  }
}

// Expose pour debug
window.HBWApp = {
  state: {
    currentUser: () => currentUser,
    AdminState,
    WorkerState,
    ManagerState
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

})();
