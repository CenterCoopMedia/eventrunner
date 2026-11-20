// No Firebase app starts in the fixture. Modules that import the SDK helpers
// statically still load; nothing here can reach a project.
export { GoogleAuthProvider, onAuthStateChanged, signInWithCustomToken, signInWithPopup, signOut } from 'firebase/auth';
export { collection, doc, getDoc, getDocFromServer, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, updateDoc, where } from 'firebase/firestore';
export const app = null;
export const auth = null;
export const db = null;
export async function appCheckHeaders() { return {}; }
