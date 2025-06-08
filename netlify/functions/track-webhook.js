import admin from 'firebase-admin';

// Инициализация Firebase Admin
if (!admin.apps.length) {
  try {
    const serviceAccount = {
      projectId: "pulse-fm-84a48",
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (error) {
    console.error('Firebase initialization error:', error);
  }
}
