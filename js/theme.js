/* Applies the saved Style and Day / Night choice before the page paints, so there is no flash. */
(function () {
  var t = null, s = null;
  try { t = localStorage.getItem('bbqe:theme'); s = localStorage.getItem('bbqe:skin'); } catch (e) { /* storage blocked */ }
  var skins = ['studio', 'system', 'win98', 'xp', 'win7', 'pico', 'mvp', 'new', 'sakura'];
  var lightOnly = ['system', 'win98', 'xp', 'win7'];
  if (skins.indexOf(s) < 0) s = 'studio';
  document.documentElement.setAttribute('data-skin', s);
  if (lightOnly.indexOf(s) >= 0) t = 'light';
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
