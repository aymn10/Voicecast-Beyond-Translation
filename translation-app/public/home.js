/* VoiceCast home: progressive enhancement using the shared language catalog. */
(function () {
  'use strict';
  const languages = window.VC.list;
  document.querySelectorAll('[data-language-count]').forEach(el => el.textContent = languages.length);
  document.querySelectorAll('[data-language-label]').forEach(el => el.textContent = languages.length + ' languages');
  const strip = document.querySelector('.langs-in');
  if (strip) {
    strip.querySelectorAll('[lang]').forEach(el => el.remove());
    languages.forEach(l => { const span = document.createElement('span'); span.lang = l.c; span.dir = l.rtl ? 'rtl' : 'ltr'; span.textContent = l.x; strip.appendChild(span); });
  }
  const root = document.getElementById('view-home');
  if (!root) return;
  const go = tab => { const nav = document.querySelector('.nav-item[data-tab="' + tab + '"]'); if (nav) nav.click(); };
  // Animate positions on an ellipse so the cards orbit without rotating their text.
  const art = root.querySelector('.connection-art');
  const visual = art.parentElement;
  const cards = Array.from(art.querySelectorAll('.hello'));
  const pause = root.querySelector('.art-motion-toggle');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = false, frameId = null, lastTime = null, elapsed = 0;
  const reduceMotion = () => motionPreference.matches || document.documentElement.dataset.motion === 'reduced';
  const canAnimate = () => !userPaused && !reduceMotion() && !document.hidden && root.classList.contains('active') && visual.clientWidth > 0;
  function positionCards() {
    const width = art.clientWidth, height = art.clientHeight;
    if (!width || !height) return;
    const radiusX = Math.max(70, (width - 146) / 2);
    const radiusY = Math.max(60, (height - 112) / 2);
    cards.forEach((card, i) => {
      const angle = elapsed / 28000 * Math.PI * 2 + [-2.35, -.78, 2.35, .78][i];
      const depth = Math.sin(angle);
      card.style.left = (width / 2 + Math.cos(angle) * radiusX) + 'px';
      card.style.top = (height / 2 - 12 + depth * radiusY) + 'px';
      card.style.transform = 'translate(-50%, -50%) scale(' + (0.90 + (depth + 1) * .06) + ')';
      card.style.zIndex = depth > .1 ? '3' : '1';
    });
  }
  function animate(time) {
    if (!canAnimate()) { syncMotion(); return; }
    if (lastTime !== null) elapsed += Math.min(time - lastTime, 64);
    lastTime = time; positionCards(); frameId = requestAnimationFrame(animate);
  }
  function syncMotion() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null; lastTime = null;
    const moving = canAnimate();
    art.classList.toggle('art-moving', moving);
    pause.disabled = reduceMotion();
    pause.textContent = userPaused ? '▷' : 'Ⅱ';
    pause.setAttribute('aria-label', reduceMotion() ? 'Animation disabled for reduced motion' : userPaused ? 'Play logo animation' : 'Pause logo animation');
    pause.setAttribute('aria-pressed', String(userPaused));
    positionCards();
    if (moving) frameId = requestAnimationFrame(animate);
  }
  pause.addEventListener('click', () => { userPaused = !userPaused; syncMotion(); });
  document.addEventListener('visibilitychange', syncMotion);
  motionPreference.addEventListener('change', syncMotion);
  new MutationObserver(syncMotion).observe(document.documentElement, {attributes:true, attributeFilter:['data-motion']});
  new MutationObserver(syncMotion).observe(root, {attributes:true, attributeFilter:['class']});
  new ResizeObserver(syncMotion).observe(visual);
  syncMotion();
  root.querySelectorAll('.feature-item').forEach(el => { el.tabIndex = 0; el.setAttribute('role','button'); el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } }); });
  function renderLanguages(query) {
    const found = languages.filter(l => (l.n + ' ' + l.x + ' ' + l.c).toLowerCase().includes(query.toLowerCase().trim()));
    const grid = document.getElementById('homeLanguages'); grid.replaceChildren();
    found.forEach(l => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'lang-world-item'; button.setAttribute('aria-label', 'Translate to ' + l.n);
      const code = document.createElement('span'); code.className = 'language-code'; code.textContent = l.c.toUpperCase();
      const name = document.createElement('span'); name.textContent = l.n;
      const native = document.createElement('small'); native.lang = l.c; native.dir = l.rtl ? 'rtl' : 'ltr'; native.textContent = l.x;
      name.appendChild(native); button.append(code,name);
      button.onclick = () => { go('texttranslate'); const select = document.getElementById('ttTarget'); select.value = l.c; select.dispatchEvent(new Event('change', {bubbles:true})); document.getElementById('ttInput').focus(); };
      grid.appendChild(button);
    });
    document.getElementById('homeLanguageResults').textContent = found.length ? found.length + ' languages available' : 'No matching languages. Try another name.';
  }
  document.getElementById('homeLanguageSearch').addEventListener('input', e => renderLanguages(e.target.value)); renderLanguages('');
  root.addEventListener('click', e => { const button = e.target.closest('[data-home-go]'); if (button) go(button.dataset.homeGo); });
  const history = root.querySelector('a[data-goto="history"]'); if (history) { history.href = '#/history'; history.setAttribute('aria-label','View all recent translations'); }
})();

