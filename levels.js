/* ============ PLAYER LEVELS (1–10) — shared by index.html and admin.html ============
 * Members used to have levels 1–5. Accounts that still carry the old scale
 * (no `levelScale: 10` on the user doc) are read through npLv10() until the
 * admin panel migrates them once (1→1, 2→3, 3→5, 4→7, 5→9).
 */
window.NP_LEVELS = [
  { icon: '🌱', el: 'Πρώτη επαφή',        en: 'First steps',        de: 'Erste Schritte',
    d_el: 'δεν έχω παίξει ποτέ ή μόνο 1–2 φορές', d_en: 'never played, or only once or twice', d_de: 'noch nie oder nur 1–2 Mal gespielt' },
  { icon: '🔰', el: 'Αρχάριος',           en: 'Beginner',           de: 'Anfänger',
    d_el: 'μαθαίνω τα βασικά χτυπήματα', d_en: 'learning the basic shots', d_de: 'lerne die Grundschläge' },
  { icon: '🎾', el: 'Αρχάριος+',          en: 'Advanced beginner',  de: 'Fortgeschr. Anfänger',
    d_el: 'κρατάω το μπαλάκι στο παιχνίδι', d_en: 'I can keep a rally going', d_de: 'kann den Ball im Spiel halten' },
  { icon: '🙂', el: 'Ερασιτέχνης',        en: 'Casual',             de: 'Gelegenheitsspieler',
    d_el: 'παίζω πού και πού για πλάκα', d_en: 'I play now and then for fun', d_de: 'spiele ab und zu zum Spaß' },
  { icon: '💪', el: 'Μέτριος',            en: 'Intermediate',       de: 'Mittelstufe',
    d_el: 'παίζω σταθερά, βγάζω τοίχους', d_en: 'I play regularly and use the walls', d_de: 'spiele regelmäßig, nutze die Wände' },
  { icon: '🔥', el: 'Μέτριος+',           en: 'Upper intermediate', de: 'Obere Mittelstufe',
    d_el: 'βολέ, λομπ, κοντρόλ στο παιχνίδι', d_en: 'volleys, lobs, good control', d_de: 'Volleys, Lobs, gute Kontrolle' },
  { icon: '🥉', el: 'Καλός',              en: 'Good',               de: 'Gut',
    d_el: 'παίζω με τακτική και θέσεις', d_en: 'I play with tactics and positioning', d_de: 'spiele taktisch und positionsbewusst' },
  { icon: '🥈', el: 'Προχωρημένος',       en: 'Advanced',           de: 'Fortgeschritten',
    d_el: 'bandeja / víbora, τοπικά τουρνουά', d_en: 'bandeja / víbora, local tournaments', d_de: 'Bandeja / Víbora, lokale Turniere' },
  { icon: '🥇', el: 'Πολύ προχωρημένος',  en: 'Expert',             de: 'Experte',
    d_el: 'αγωνιστικός παίχτης, κατάταξη', d_en: 'competitive, ranked player', d_de: 'Wettkampfspieler mit Ranking' },
  { icon: '🏆', el: 'Pro',                en: 'Pro',                de: 'Profi',
    d_el: 'επαγγελματικό / ομοσπονδιακό επίπεδο', d_en: 'professional / federation level', d_de: 'Profi- / Verbandsniveau' },
];
window.NP_LEVEL_OLD_MAP = { 1: 1, 2: 3, 3: 5, 4: 7, 5: 9 };
/** A member's level on the 1–10 scale (old 1–5 accounts are converted on the fly). */
window.npLv10 = function(u){
  const n = +(u && u.level) || 1;
  if (u && u.levelScale === 10) return Math.max(1, Math.min(10, n));
  return window.NP_LEVEL_OLD_MAP[Math.max(1, Math.min(5, n))] || 1;
};
/** "🔥 6 · Μέτριος+" */
window.npLvLabel = function(n, lang){
  const l = window.NP_LEVELS[Math.max(1, Math.min(10, +n || 1)) - 1];
  return l.icon + ' ' + n + ' · ' + (l[lang || 'el'] || l.el);
};
