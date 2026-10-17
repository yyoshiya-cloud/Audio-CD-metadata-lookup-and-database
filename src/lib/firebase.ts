import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App instance safely (used strictly for Google OAuth / Sheets API)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Workspace scopes requested for Google Sheets & Google Drive
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/drive.file');

let isSigningIn = false;

// セキュリティ上の理由から、アクセストークンはメモリ上のみで保持する。
// localStorage / sessionStorage に保存するとXSS発生時に盗まれる恐れがあるため使用しない。
// ページを再読み込みするとトークンは失われるが、Googleスプレッドシート操作時に
// 再ログイン(ポップアップ)で取得し直す。
const TOKEN_TTL_MS = 50 * 60 * 1000; // Google OAuthトークンの有効期間(約1時間)より短めに設定

let cachedAccessToken: string | null = null;
let cachedAccessTokenAt = 0;

// 旧バージョンが localStorage に保存したトークンを削除する(移行処理)
const LEGACY_TOKEN_STORAGE_KEY = 'google_sheets_access_token_v2';
const LEGACY_TOKEN_TIME_KEY = 'google_sheets_token_timestamp_v2';
const purgeLegacyStoredToken = () => {
  try {
    localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
    localStorage.removeItem(LEGACY_TOKEN_TIME_KEY);
  } catch (e) {}
};
purgeLegacyStoredToken();

export const saveAccessToken = (token: string) => {
  cachedAccessToken = token;
  cachedAccessTokenAt = Date.now();
};

export const loadStoredAccessToken = (): string | null => {
  if (cachedAccessToken && Date.now() - cachedAccessTokenAt < TOKEN_TTL_MS) {
    return cachedAccessToken;
  }
  cachedAccessToken = null;
  cachedAccessTokenAt = 0;
  return null;
};

export const clearStoredAccessToken = () => {
  cachedAccessToken = null;
  cachedAccessTokenAt = 0;
  purgeLegacyStoredToken();
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
 * Get the in-memory OAuth access token (null if absent or expired)
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
