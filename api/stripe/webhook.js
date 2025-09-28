// /api/_firebase.js  (ESM)
// Initializes firebase-admin once and exports a named Firestore instance: `db`

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Support either FB_* (preferred) or FIREBASE_* env names
const PROJECT_ID   = process.env.FB_PROJECT_ID        || process.env.FIREBASE_PROJECT_ID        || "";
const CLIENT_EMAIL = process.env.FB_CLIENT_EMAIL      || process.env.FIREBASE_CLIENT_EMAIL      || "";
const PRIVATE_KEY  = (process.env.FB_PRIVATE_KEY      || process.env.FIREBASE_PRIVATE_KEY       || "")
  .replace(/\\n/g, "\n"); // handle escaped newlines from env

if (!PROJECT_ID || !CLIENT_EMAIL || !PRIVATE_KEY) {
  console.warn("[firebase-admin] Missing env vars. Set FB_* (preferred) or FIREBASE_*");
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:  PROJECT_ID,
      clientEmail: CLIENT_EMAIL,
      privateKey:  PRIVATE_KEY,
    }),
  });
}

export const db = getFirestore();
export default db; // optional
