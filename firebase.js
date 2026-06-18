/**
 * HBW Task - Firebase Configuration & Initialization
 * 
 * Responsibilities:
 * - Initialize Firebase app
 * - Export auth and db instances
 * - Provide secure secondary auth for user creation
 * 
 * @module firebase
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ============================================================
// FIREBASE CONFIGURATION
// ============================================================

const firebaseConfig = {
    apiKey: "AIzaSyAbRFgL4jxSbBgc7FhIORKyOEq7N163_AQ",
    authDomain: "hbwtaskpam.firebaseapp.com",
    projectId: "hbwtaskpam",
    storageBucket: "hbwtaskpam.appspot.com",
    messagingSenderId: "142029895340",
    appId: "1:142029895340:web:ce94830569430491ef5109"
};

// ============================================================
// INITIALIZATION
// ============================================================

// Initialize the primary Firebase app
const app = initializeApp(firebaseConfig);

// Export core services for use in other modules
export const auth = getAuth(app);
export const db = getFirestore(app);

// ============================================================
// SECONDARY AUTH FOR USER CREATION
// ============================================================

/**
 * Creates a new Firebase Auth user account using a secondary app instance.
 * This prevents the current user session from being disrupted.
 * 
 * The secondary app is always cleaned up after use (signOut + delete),
 * even if an error occurs during creation.
 * 
 * @param {string} email - The email address for the new account
 * @param {string} password - The password for the new account
 * @returns {Promise<{uid: string, email: string}>} The created user's UID and email
 * @throws {Error} If account creation fails (email already in use, weak password, etc.)
 */
export async function createSecondaryAuthUser(email, password) {
    const appName = `Secondary_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let secondaryApp = null;

    try {
        // Create an isolated Firebase app instance
        secondaryApp = initializeApp(firebaseConfig, appName);
        const secondaryAuth = getAuth(secondaryApp);

        // Create the user account on the secondary auth
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const uid = userCredential.user.uid;

        // Sign out from secondary auth to clean up the session
        await signOut(secondaryAuth);

        console.log(`✅ Secondary auth user created: ${email} (${uid})`);

        return { uid, email };

    } catch (error) {
        console.error(`❌ Secondary auth user creation failed for ${email}:`, error.code, error.message);

        // Re-throw with a clean message for the calling module
        if (error.code === 'auth/email-already-in-use') {
            throw new Error(`L'email ${email} est déjà utilisé par un autre compte.`);
        } else if (error.code === 'auth/weak-password') {
            throw new Error('Le mot de passe est trop faible (minimum 6 caractères).');
        } else if (error.code === 'auth/invalid-email') {
            throw new Error(`L'email ${email} n'est pas valide.`);
        } else if (error.code === 'auth/operation-not-allowed') {
            throw new Error('La création de compte par email/mot de passe n\'est pas activée dans Firebase Console.');
        } else {
            throw new Error(`Erreur lors de la création du compte : ${error.message}`);
        }

    } finally {
        // ALWAYS clean up the secondary app to prevent memory leaks
        if (secondaryApp) {
            try {
                await secondaryApp.delete();
                console.log(`🧹 Secondary app "${appName}" deleted successfully.`);
            } catch (deleteError) {
                console.warn(`⚠️ Failed to delete secondary app "${appName}":`, deleteError.message);
            }
        }
    }
}

/**
 * Authenticates a user with email and password on the primary auth instance.
 * Wrapper around Firebase signInWithEmailAndPassword for consistent error handling.
 * 
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise<object>} Firebase UserCredential
 * @throws {Error} With user-friendly French error message
 */
export async function signInUser(email, password) {
    try {
        const credential = await signInWithEmailAndPassword(auth, email, password);
        return credential;
    } catch (error) {
        // Map Firebase error codes to user-friendly French messages
        const errorMessages = {
            'auth/user-not-found': 'Aucun compte trouvé avec cet identifiant.',
            'auth/wrong-password': 'Mot de passe incorrect.',
            'auth/invalid-credential': 'Identifiants incorrects.',
            'auth/invalid-email': 'Format d\'email invalide.',
            'auth/user-disabled': 'Ce compte a été désactivé.',
            'auth/too-many-requests': 'Trop de tentatives échouées. Veuillez réessayer dans quelques minutes.',
            'auth/network-request-failed': 'Problème de connexion internet. Vérifiez votre réseau.',
            'auth/popup-closed-by-user': 'La fenêtre de connexion a été fermée prématurément.'
        };

        const message = errorMessages[error.code] || `Erreur de connexion : ${error.message}`;
        throw new Error(message);
    }
}

/**
 * Signs out the current user from the primary auth instance.
 * 
 * @returns {Promise<void>}
 */
export async function signOutUser() {
    try {
        await signOut(auth);
        console.log('✅ User signed out successfully.');
    } catch (error) {
        console.error('❌ Sign out failed:', error);
        throw new Error('Erreur lors de la déconnexion.');
    }
    }
