import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App instance safely
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const firestoreDb = initializeFirestore(app, {}, firebaseConfig.firestoreDatabaseId);

const provider = new GoogleAuthProvider();
// Workspace scopes requested for Google Sheets & Google Drive
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/drive.file');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

const TOKEN_STORAGE_KEY = 'google_sheets_access_token_v2';
const TOKEN_TIME_KEY = 'google_sheets_token_timestamp_v2';

export const saveAccessToken = (token: string) => {
  cachedAccessToken = token;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(TOKEN_TIME_KEY, String(Date.now()));
  } catch (e) {
    console.warn('Failed to save access token to localStorage:', e);
  }
};

export const loadStoredAccessToken = (): string | null => {
  if (cachedAccessToken) return cachedAccessToken;
  try {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    const timestamp = localStorage.getItem(TOKEN_TIME_KEY);
    if (token && timestamp) {
      const ageMs = Date.now() - parseInt(timestamp, 10);
      // Valid for up to 50 minutes (3000 seconds)
      if (ageMs < 50 * 60 * 1000) {
        cachedAccessToken = token;
        return token;
      }
    }
  } catch (e) {
    console.warn('Failed to load access token from localStorage:', e);
  }
  return null;
};

export const clearStoredAccessToken = () => {
  cachedAccessToken = null;
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_TIME_KEY);
  } catch (e) {}
};

/**
 * Initialize auth state listener.
 */
export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      const token = loadStoredAccessToken();
      if (onAuthSuccess) onAuthSuccess(user, token);
    } else {
      clearStoredAccessToken();
      if (onAuthFailure) onAuthFailure();
    }
  });
};

/**
 * Perform Google Sign-In with popup to acquire access token with Google Sheets & Drive scopes
 */
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google OAuth Access Tokenを取得できませんでした。');
    }

    saveAccessToken(credential.accessToken);
    return { user: result.user, accessToken: credential.accessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Get cached in-memory or persisted OAuth access token
 */
export const getAccessToken = async (): Promise<string | null> => {
  return loadStoredAccessToken();
};

/**
 * Sign out and clear stored token
 */
export const logout = async (): Promise<void> => {
  await auth.signOut();
  clearStoredAccessToken();
};
