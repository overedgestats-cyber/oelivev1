// api/_firebase.js
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID  = process.env.FB_PROJECT_ID        || process.env.FIREBASE_PROJECT_ID;
const CLIENT_EMAIL= process.env.FB_CLIENT_EMAIL      || process.env.FIREBASE_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.FB_PRIVATE_KEY       || process.env.FIREBASE_PRIVATE_KEY;

if (!PROJECT_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
  console.warn('[firebase-admin] Missing env vars. Expected FB_* or FIREBASE_* set.');
}

export function getDB() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:  PROJECT_ID,
        clientEmail: CLIENT_EMAIL,
        privateKey:  (PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

