/* ============================================================
   HBW TASK - Application JavaScript Complète
   Version 2.0 - Production Ready
   Architecture modulaire en un seul fichier
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
  
  const BADGE_THRESHOLDS = [
    { name: 'bronze', min: 0, label: 'Bronze', color: '#cd7f32', icon: 'fa-award' },
    { name: 'silver', min: 50, label: 'Argent', color: '#c0c0c0', icon: 'fa-medal' },
    { name: 'gold', min: 100, label: 'Or', color: '#ffd700', icon: 'fa-trophy' },
    { name: 'platinum', min: 200, label: 'Platine', color: '#e5e4e2', icon: 'fa-gem' },
    { name: 'diamond', min: 500, label: 'Diamant', color: '#b9f2ff', icon: 'fa-crown' }
  ];

  // Caches
  const tasksCache = { data: [], timestamp: null };
  const usersCache = { data: [], timestamp: null };
  const teamsCache = { data: [], timestamp: null };
  const settingsCache = { data: {}, timestamp: null };

  /* ============================================================
     4.2 UTILITAIRES
     ============================================================ */

  function isCacheValid(cache) {
    if (!cache || !cache.timestamp) return false;
    return (Date.now() - cache.timestamp) < CACHE_TTL;
  }

  function invalidateCache(cache) {
    if (!cache) return;
    cache.timestamp = null;
    cache.data = Array.isArray(cache.data) ? [] : {};
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

  // CORRIGÉ : escapeHtml avec les vraies entités HTML
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
    const levels = BADGE_THRESHOLDS;
    
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

  function generateRandomPassword(length = 8) {
    const chars = '1234567890';
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
    const splash = document.getElementById('hbw-splash');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => {
        splash.style.display = 'none';
      }, 500);
    }
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
    
    // Cacher sidebar, topbar, bottom bar sur la page login
    document.body.classList.add('page-login-active');
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
    
    // Désactiver le bouton pendant la connexion
    const submitBtn = document.querySelector('#login-form button[type="submit"]');
    const originalText = submitBtn ? submitBtn.innerHTML : '';
    
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Connexion...';
    }
    
    try {
      // Construire la liste des emails à essayer
      const emailsToTry = [];
      const usernameLower = username.toLowerCase().trim();
      
      // Si l'utilisateur a tapé un email complet
      if (usernameLower.includes('@')) {
        emailsToTry.push(usernameLower);
      } else {
        // Email standard : username@hbwtask.com
        emailsToTry.push(`${usernameLower}@hbwtask.com`);
        
        // Variante alternative : username@taskpam.com
        emailsToTry.push(`${usernameLower}@taskpam.com`);
        
        // Cas particulier des administrateurs : essayer plusieurs variantes
        if (usernameLower.startsWith('admin')) {
          emailsToTry.unshift('admin@hbwtask.com');
          emailsToTry.unshift('admin@taskpam.com');
        }
      }
      
      // Supprimer les doublons tout en gardant l'ordre
      const uniqueEmails = [...new Set(emailsToTry)];
      
      let credential = null;
      let lastError = null;
      
      // Essayer chaque email jusqu'à ce qu'un fonctionne
      for (const tryEmail of uniqueEmails) {
        try {
          credential = await auth.signInWithEmailAndPassword(tryEmail, password);
          console.log(`✅ Connexion réussie avec : ${tryEmail}`);
          break;
        } catch (err) {
          lastError = err;
          console.log(`⚠️ Échec avec ${tryEmail}: ${err.code}`);
          
          // Si c'est une erreur de mot de passe (et non "utilisateur inexistant"),
          // on peut arrêter car le compte existe mais le mot de passe est faux
          if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
            // Pour les admins, on continue car le compte peut exister sous un autre email
            if (!usernameLower.startsWith('admin')) {
              break;
            }
          }
          
          // Si c'est "too-many-requests", on arrête immédiatement
          if (err.code === 'auth/too-many-requests') {
            throw err;
          }
        }
      }
      
      if (!credential) {
        // Aucune connexion n'a réussi
        let msg = 'Identifiants incorrects';
        if (lastError) {
          if (lastError.code === 'auth/user-not-found') {
            msg = 'Ce compte n\'existe pas';
          } else if (lastError.code === 'auth/wrong-password' || lastError.code === 'auth/invalid-credential') {
            msg = 'Mot de passe incorrect';
          } else if (lastError.code === 'auth/too-many-requests') {
            msg = 'Trop de tentatives. Réessayez dans quelques minutes.';
          } else if (lastError.code === 'auth/network-request-failed') {
            msg = 'Problème de connexion internet';
          }
        }
        showLoginError(msg);
        return;
      }
      
      showToast('Connexion réussie !', 'success');
      
    } catch (err) {
      console.error('Erreur login:', err);
      let msg = 'Erreur de connexion';
      
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        msg = 'Mot de passe incorrect';
      } else if (err.code === 'auth/user-not-found') {
        msg = 'Ce compte n\'existe pas';
      } else if (err.code === 'auth/too-many-requests') {
        msg = 'Trop de tentatives. Réessayez dans quelques minutes.';
      } else if (err.code === 'auth/network-request-failed') {
        msg = 'Problème de connexion internet';
      }
      
      showLoginError(msg);
      
    } finally {
      // Réactiver le bouton
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
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
    
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      handleLogin(username, password);
    });
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
    
    // Gestion bottom bar - FIX: Parenthèses correctes
    const bottomBar = document.getElementById('bottom-bar');
    if (bottomBar) {
      if (currentUser && (currentUser.role === 'admin' || pageId === 'page-login')) {
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

  // Alias pour showPage (utilisé dans les onclick)
  function navigateTo(pageId) {
    showPage(pageId);
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

  function showApp(role) {
    currentRole = role;
    
    const app = document.getElementById('app');
    if (app) app.style.display = 'flex';
    
    // Réafficher sidebar et topbar
    document.body.classList.remove('page-login-active');
    
    const loginPage = document.getElementById('page-login');
    if (loginPage) loginPage.classList.add('hidden');
    
    initNavigation(role);
    
    let defaultPage = 'page-worker-dashboard';
    if (role === 'admin') defaultPage = 'page-admin-dashboard';
    else if (role === 'manager') defaultPage = 'page-manager-dashboard';
    
    showPage(defaultPage);
    updateHeaderUser();
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
              preview.innerHTML = `
                <img src="${ev.target.result}" alt="Preview">
                <button class="btn btn-sm btn-outline mt-2" onclick="this.parentElement.innerHTML=''; document.querySelector('${selector} input').value='';">
                  <i class="fas fa-times"></i> Retirer
                </button>
              `;
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

  /* ============================================================
     EXPOSITION GLOBALE (window)
     ============================================================ */

  const globalsToExpose = {
    // Navigation
    navigateTo,
    handleLogout,
    toggleSidebar,
    closeSidebarMobile,
    toggleTheme,
    
    // Modales
    openModal,
    closeModal,
    
    // Notifications
    toggleNotifDropdown,
    markNotifRead,
    markAllRead,
    
    // Upload
    cancelUpload: () => {
      const overlay = document.getElementById('hbw-upload-overlay');
      if (overlay) overlay.classList.add('hidden');
    }
  };

  Object.keys(globalsToExpose).forEach(name => {
    if (typeof globalsToExpose[name] === 'function') {
      window[name] = globalsToExpose[name];
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
      
      console.log('HBW Task initialisé avec succès');
      
    } catch (e) {
      console.error('Erreur initialisation:', e);
    }
  }

  // Expose pour debug
  window.HBWApp = {
    state: {
      currentUser: () => currentUser,
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
