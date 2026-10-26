// The screen's frame: scales the 1920x1080 stage to the display, moves focus like a D-pad remote, and shows the
// launch screen on OK. Arrow keys are the remote, Enter is OK, Escape or Backspace is Back. A mouse works too.
(() => {
  const stage = document.querySelector('.stage');

  const fit = () => {
    // clientWidth, not innerWidth: Android's WebView can report an innerWidth wider than the screen
    const de = document.documentElement;
    const s = Math.min(de.clientWidth / 1920, de.clientHeight / 1080);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    stage.classList.add('is-fit');
  };
  addEventListener('resize', fit);
  fit();

  const focusables = () => [...stage.querySelectorAll('[data-f]')];
  const center = el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  let cur = null;
  let launched = false;

  function focus(el) {
    if (!el || el === cur) return;
    cur?.classList.remove('is-focus');
    cur = el;
    el.classList.add('is-focus');
    stage.classList.add('has-focus');
    stage.dispatchEvent(new CustomEvent('tv:focus', { detail: el }));
  }

  // Nearest focusable in the pressed direction; sideways distance counts extra so
  // Up/Down stay in the same column and Left/Right stay in the same row.
  function move(dir) {
    if (!cur) return focus(focusables()[0]);
    const override = cur.dataset[dir];
    if (override) return focus(stage.querySelector(override));
    const a = center(cur);
    let best = null, bestScore = Infinity;
    for (const el of focusables()) {
      if (el === cur) continue;
      const b = center(el);
      const dx = b.x - a.x, dy = b.y - a.y;
      const [main, cross] =
        dir === 'left'  ? [-dx, dy] :
        dir === 'right' ? [dx, dy] :
        dir === 'up'    ? [-dy, dx] : [dy, dx];
      if (main <= 4) continue;
      const score = main + Math.abs(cross) * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) focus(best);
  }

  const launchEl = document.createElement('div');
  launchEl.className = 'launch';
  stage.appendChild(launchEl);
  let launchTimer;

  function select() {
    if (!cur) return;
    stage.dispatchEvent(new CustomEvent('tv:select', { detail: cur }));
    if (cur.dataset.app == null) return;
    const app = APPS[+cur.dataset.app];
    launched = true;
    launchEl.style.setProperty('--bg', app.bg);
    launchEl.style.setProperty('--fg', app.fg);
    launchEl.style.setProperty('--glow', app.glow);
    if (window.TV.renderLaunch) window.TV.renderLaunch(launchEl, app);
    else launchEl.innerHTML = `<div class="launch-name">${app.name}</div>`;
    launchEl.classList.add('on');
    clearTimeout(launchTimer);
    launchTimer = setTimeout(back, 1800);
  }

  function back() {
    if (!launched) return;
    launched = false;
    clearTimeout(launchTimer);
    launchEl.classList.remove('on');
    window.TV.onBack?.();
  }

  addEventListener('keydown', e => {
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
    if (dir) { e.preventDefault(); if (!launched) move(dir); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launched ? back() : select(); }
    else if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); back(); }
  });
  stage.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-f]');
    if (el && !launched) focus(el);
  });
  stage.addEventListener('click', e => {
    if (launched) return back();
    const el = e.target.closest('[data-f]');
    if (el) { focus(el); select(); }
  });

  // Clock, date and greeting for any element that asks for them.
  function tick() {
    const d = new Date();
    const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
    stage.querySelectorAll('[data-clock]').forEach(el => {
      el.textContent = el.dataset.clock === '24' ? `${String(h).padStart(2, '0')}:${m}` : `${h % 12 || 12}:${m}`;
    });
    stage.querySelectorAll('[data-ampm]').forEach(el => { el.textContent = h < 12 ? 'am' : 'pm'; });
    stage.querySelectorAll('[data-date]').forEach(el => {
      el.textContent = el.dataset.date === 'short'
        ? d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
        : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    });
    stage.querySelectorAll('[data-greet]').forEach(el => {
      el.textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    });
  }

  window.TV = {
    focus,
    back,
    start() {
      tick();
      setInterval(tick, 10000);
      focus(stage.querySelector('[data-start]') || focusables()[0]);
    },
  };
})();
