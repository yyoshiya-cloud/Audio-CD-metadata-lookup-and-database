import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { settingsStore } from './settingsStore';
import { createLogger } from './logger';

const log = createLogger('firebase');

// Firebase Authentication（Googleアカウントでのログイン）のみに使用する。
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const provider = new GoogleAuthProvider();

// 旧バージョンが localStorage に保存したスプレッドシート用トークン・連携情報を削除する（移行処理）
['google_sheets_access_token_v2', 'google_sheets_token_timestamp_v2', 'cd_catalog_known_spreadsheets_v1', 'cd_catalog_primary_spreadsheet_v1'].forEach(
  (key) => settingsStore.remove(key)
);

/**
 * Initialize auth state listener.
 */
export const initAuth = (
  onAuthSuccess?: (user: User) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (onAuthSuccess) onAuthSuccess(user);
    } else {
      if (onAuthFailure) onAuthFailure();
    }
  });
};

/**
 * Googleアカウントでログイン（ポップアップ）。Sheets / Drive のスコープは要求しない。
 */
export const googleSignIn = async (): Promise<{ user: User } | null> => {
  try {
    const result = await signInWithPopup(auth, provider);
    return { user: result.user };
  } catch (error: any) {
    log.error('Sign in error:', error);
    throw error;
  }
};

/**
 * Sign out
 */
export const logout = async (): Promise<void> => {
  await auth.signOut();
};
