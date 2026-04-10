// ─────────────────────────────────────────────────────────
// Replace every value below with your Firebase project's
// credentials:  Firebase Console → Project Settings → General
// ─────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAg69q21B6uQI2nTxF2ZO15CDFGUyRRQus",
  authDomain: "club-site-f1a0a.firebaseapp.com",
  projectId: "club-site-f1a0a",
  storageBucket: "club-site-f1a0a.firebasestorage.app",
  messagingSenderId: "373626867640",
  appId: "1:373626867640:web:f37d7e3d362f06433a894d",
  measurementId: "G-48X1T3PDF5"
};

firebase.initializeApp(firebaseConfig);
window.db = firebase.firestore();
