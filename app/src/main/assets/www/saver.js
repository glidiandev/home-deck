// What the away screen shows, for both the home screen's away screen (index.html) and the TV's screen saver (away.html):
// the dim clock, or one of the rainy city views, or Shuffle, which moves between them every few minutes.
// With the screen saver clock switched off there's no time anywhere: the rain shows no clock, and the Clock scene is
// a plain dark screen (Shuffle then only uses the rain).
window.AwayScenes = (() => {
  const SCENES = ['clock', 'window', 'downpour'];          // the order of Jump To > Screen saver; Shuffle comes after them
  const SHUFFLE = 3;
  const EVERY = 10 * 60000;                                // Shuffle's time on each scene

  // o: { host, clockEl, frameClass, saver, clockOn, light, reduce }
  function start(o) {
    let frame = null, timer = null, slow = false, at = 0;
    // which scenes this run can use: rain needs motion, and Shuffle in Lite mode keeps to the clock
    const list = () => {
      if (o.saver !== SHUFFLE) return [SCENES[o.saver] || 'clock'];
      if (o.reduce || o.light || slow) return ['clock'];
      return o.clockOn ? SCENES : SCENES.slice(1);
    };
    function show(scene) {
      if (frame) { frame.remove(); frame = null; }
      const rain = scene !== 'clock' && !o.reduce && !slow;
      o.clockEl.hidden = rain || !o.clockOn;
      if (!rain) return;
      frame = document.createElement('iframe'); frame.className = o.frameClass; frame.setAttribute('aria-hidden', 'true');
      frame.src = `rain/index.html?view=${scene}${o.light ? '&light' : ''}${o.clockOn ? '' : '&noclock'}`;
      o.host.appendChild(frame);
    }
    // the rain says when this TV can't keep it smooth even when lighter: the clock (or the dark screen) for this time
    const onMessage = e => {
      if (!(e.data && e.data.rain === 'too-slow' && frame && e.source === frame.contentWindow)) return;
      slow = true; clearInterval(timer); show('clock');
    };
    addEventListener('message', onMessage);
    const first = list();
    at = Math.floor(Math.random() * first.length);         // Shuffle starts somewhere new each time
    show(first[at]);
    if (first.length > 1) timer = setInterval(() => { const l = list(); at = (at + 1) % l.length; show(l[at]); }, EVERY);
    return {
      stop() { clearInterval(timer); removeEventListener('message', onMessage); if (frame) frame.remove(); frame = null; o.clockEl.hidden = false; },
    };
  }
  return { start, SHUFFLE };
})();
