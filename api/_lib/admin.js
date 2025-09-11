// api/_lib/admin.js
import admin from 'firebase-admin';

let app;
try {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (raw) {
      const svc = JSON.parse(raw);
      app = admin.initializeApp({ credential: admin.credential.cert(svc) });
    } else {
      const projectId =
        process.env.FIREBASE_PROJECT_ID ||
        process.env.GCLOUD_PROJECT ||
        process.env.GOOGLE_CLOUD_PROJECT;

      app = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        ...(projectId ? { projectId } : {}),
      });
    }
  } else {
    app = admin.app();
  }
} catch (e) {
  console.error('Firebase admin init error:', e.message);
}

export const db = (() => {
  try { return admin.firestore(); } catch { return null; }
})();

export { admin };

