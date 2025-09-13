// Vercel Serverless Function — public (non-secret) config for the web app
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    firebase: {
      apiKey: process.env.FIREBASE_API_KEY || "",
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
      projectId: process.env.FIREBASE_PROJECT_ID || "",
      appId: process.env.FIREBASE_APP_ID || "",
      // optional but nice to have if you use them later:
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || ""
    },
    stripe: {
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null
    }
  });
};
