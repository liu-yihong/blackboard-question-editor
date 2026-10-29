/* Applies the saved Style and Day / Night choice before the page paints, so there is no flash.
   Also marks the page as loading: css/app.css hides the editor until js/app.js has drawn it,
   so nothing visible jumps while the questions appear (no layout shift). */
(function () {
  document.documentElement.classList.add('bqe-loading');
  var t = null, s = null;
  try { t = localStorage.getItem('bbqe:theme'); s = localStorage.getItem('bbqe:skin'); } catch (e) { /* storage blocked */ }
  var skins = ['studio', 'system', 'win98', 'xp', 'win7', 'pico', 'mvp', 'new', 'sakura'];
  var lightOnly = ['system', 'win98', 'xp', 'win7'];
  if (skins.indexOf(s) < 0) s = 'studio';
  document.documentElement.setAttribute('data-skin', s);
  if (lightOnly.indexOf(s) >= 0) t = 'light';
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
