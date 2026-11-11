/* North Padel — push notifications in the background (Firebase Cloud Messaging).
 * Messages are sent by /api/push with a `webpush.notification` payload, which
 * the SDK shows automatically; a click opens the game on the site. */
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAnn6RtsAqfJxeWesN3WF1jVv_egCDb21k",
  authDomain: "north-padel-18763.firebaseapp.com",
  projectId: "north-padel-18763",
  storageBucket: "north-padel-18763.firebasestorage.app",
  messagingSenderId: "955194973640",
  appId: "1:955194973640:web:b37f431ccaf6aabafb74fd",
});
firebase.messaging();

self.addEventListener('notificationclick', (event) => {
  const link = (event.notification.data && event.notification.data.FCM_MSG && event.notification.data.FCM_MSG.notification && event.notification.data.FCM_MSG.notification.click_action)
    || (event.notification.data && event.notification.data.link) || '/';
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list){ if ('focus' in c){ c.navigate && c.navigate(link); return c.focus(); } }
    return clients.openWindow(link);
  }));
});
