// Home Deck's rainy city screen savers (rain/index.html), the shared parts: the out-of-focus city canvas, rain falling outside, drops on the
// glass, flying traffic, something passing close now and then, the odd police chase, lightning, and the time.
// Each view only draws its own city: RainCity({ ...its scene }). A scene can also set how far out of focus the
// city is (focus: 'far'), how hard it rains (storm: 1 is normal) and how often lightning comes (lightning: [min, max] s).
// The scene gets H.lit (how bright lightning is right now) and H.bolt (the strike's path) to light its own sky with,
// so the towers stand out against it.
//
// Built to run on a TV's slow chip, so nothing that stays put is drawn twice:
// - the city is laid out on a 320x180 grid but drawn at half that (160x90) into `raw`, then shrunk to 80x45 for the
//   screen (#city), which the TV stretches to full size: that stretch is the blur, for free. The city and the glass
//   take turns, frame by frame;
// - every soft glow is a ready-made stamp (sprite) per color, never a gradient worked out per frame;
// - drops already sitting on the glass are painted once onto their own canvas (#drops); a running drop wipes its
//   path off it. Only the drops landing right now and the running ones are drawn each frame (#glass);
// - the rain outside and light glaring on the glass go on a half-size canvas (#air): they're soft anyway. The rain is
//   three strokes, one per depth, not one per streak. The moving drops (#glass) only clear the spots they were in.
(() => {
  window.RainCity = scene => {
    const $ = id => document.getElementById(id);
    HD.fit($('stage'));
    const CW = 320, CH = 180, GW = 960, GH = 540, K = GW / CW;      // glass pixels per city pixel
    const city = $('city'), vc = city.getContext('2d'), gc = $('glass').getContext('2d'), dc = $('drops').getContext('2d'), ac = $('air').getContext('2d');
    const AW = GW / 2;                                       // the air canvas is half size
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
    const Q = .5, [raw, cc] = mk(CW * Q, CH * Q), [tiny, tc] = mk(40, 23);   // scenes draw in 320x180 terms; Q shrinks it
    cc.setTransform(Q, 0, 0, Q, 0, 0);
    let rnd = scene.seed || 23; const R = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
    const col = {};
    const colors = () => Object.assign(col, { chrome: HD.css('--hd-chrome'), act: HD.css('--hd-act'), magenta: '#ff3dd8', amber: '#ffae3a',
                                              cyan: '#3df0ff', white: '#f4f0ff', head: '#fff3dc', tail: '#ff2436', red: '#ff1a2e', blue: '#2d6bff', tv: '#7fa8ff' });
    colors(); addEventListener('hd-mode', colors);

    // ---- stamps: a soft round glow and a beam fading out, one of each per color, made once ----
    const sprites = new Map();
    function sprite(c, kind = 'glow') {
      const key = kind + c; let s = sprites.get(key); if (s) return s;
      const [cv, x] = kind === 'glow' ? mk(64, 64) : mk(64, 8);
      const g = kind === 'glow' ? x.createRadialGradient(32, 32, 0, 32, 32, 32) : x.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, c); if (kind === 'glow') g.addColorStop(.4, c); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, cv.width, cv.height); sprites.set(key, cv); return cv;
    }
    const blob = (x, y, r, c, a) => { cc.globalAlpha = a; cc.drawImage(sprite(c), x - r, y - r, r * 2, r * 2); };
    // A vehicle seen side-on: a dark body, a bright light at the front throwing a short beam, a red light at the back,
    // and a thin underglow. Out of focus it reads as a streak with a white end and a red end, never a plain dot.
    function vehicle(x, y, dir, s, o = {}) {
      const L = 9 * s, Hh = 2.4 * s, head = o.head || col.head;
      cc.globalCompositeOperation = 'source-over'; cc.globalAlpha = .9; cc.fillStyle = '#06050a'; cc.fillRect(x - L / 2, y - Hh / 2, L, Hh);
      cc.globalCompositeOperation = 'lighter';
      cc.globalAlpha = .3; cc.fillStyle = o.under || col.act; cc.fillRect(x - L / 2 + s, y + Hh / 2 - .2 * s, L - 2 * s, .8 * s);
      const fx = x + dir * L / 2;
      if (s >= .9) { cc.save(); cc.translate(fx, y); cc.scale(dir, 1); cc.globalAlpha = .16; cc.drawImage(sprite(head, 'beam'), 0, -3 * s, 22 * s, 6 * s); cc.restore(); }   // far ones: too small to show a beam
      blob(fx, y, 2.2 * s, head, .95);
      blob(x - dir * L / 2, y, 1.4 * s, col.tail, .8);
      if (o.siren) {                                          // police: red and blue taking turns on the roof
        const on = o.siren > 0, a = on ? col.red : col.blue, b = on ? col.blue : col.red;
        blob(x - 1.6 * s, y - Hh / 2 - .6 * s, 1.5 * s, a, 1); blob(x + 1.6 * s, y - Hh / 2 - .6 * s, 1.5 * s, b, .35);
        blob(x, y, 18 * s, a, .22);
      }
    }

    // ---- flying traffic, in lanes the scene sets: { y, s (size), n (how many), depth (which layer it flies in) } ----
    const traffic = [];
    (scene.lanes || []).forEach(l => { for (let i = 0; i < l.n; i++) { const dir = R() < .5 ? -1 : 1;
      traffic.push({ x: R() * CW, y: l.y + (R() - .5) * (l.spread || 6), dir, v: dir * (8 + R() * 16) * l.s, s: l.s * (.8 + R() * .4), depth: l.depth || 0,
                     under: [col.act, col.chrome, col.cyan, col.magenta][(R() * 4) | 0] }); } });
    function drawTraffic(depth, dt) {
      traffic.forEach(v => { if (v.depth !== depth) return;
        v.x += v.v * dt; if (v.x < -20) v.x = CW + 20; if (v.x > CW + 20) v.x = -20;
        vehicle(v.x, v.y, v.dir, v.s, { under: v.under }); });
      cc.globalCompositeOperation = 'source-over'; cc.globalAlpha = 1;
    }

    // ---- now and then something passes close to the window; once in a while, a police chase; lightning ----
    const [lMin, lMax] = scene.lightning || [35, 95], storm = scene.storm || 1;
    let close = null, nextClose = 7, chase = null, nextChase = scene.firstChase || 14, nextFlash = lMin * .7 + Math.random() * 20, siren = 0;
    const glare = [];                                          // bright things near the glass this frame, in glass pixels
    const H = { cc, CW, CH, Q, R, col, blob, sprite, mk, vehicle, traffic: drawTraffic, flash: 0, lit: 0, bolt: null };
    function strike() {                                        // a jagged path from the clouds, with a branch or two
      const pts = [[40 + Math.random() * 240, -4]];
      while (pts[pts.length - 1][1] < 60 + Math.random() * 40) { const [x, y] = pts[pts.length - 1]; pts.push([x + (Math.random() - .5) * 14, y + 4 + Math.random() * 7]); }
      let [fx, fy] = pts[Math.min(pts.length - 1, 3 + ((Math.random() * 4) | 0))];
      const branch = [[fx, fy]]; for (let i = 0; i < 5; i++) { fx += (Math.random() < .5 ? -1 : 1) * (3 + Math.random() * 6); fy += 3 + Math.random() * 5; branch.push([fx, fy]); }
      return [pts, branch];
    }
    function drawEvents(t, dt) {
      glare.length = 0;
      nextClose -= dt;
      if (!close && nextClose < 0) { const dir = Math.random() < .5 ? 1 : -1, [a, b] = scene.closeY || [40, 130];
        close = { x: dir > 0 ? -70 : CW + 70, dir, y: a + Math.random() * (b - a), v: 60 + Math.random() * 30 }; }
      if (close) { close.x += close.dir * close.v * dt; vehicle(close.x, close.y, close.dir, 4.2, { under: col.chrome });
        glare.push([(close.x + close.dir * 19) * K, close.y * K, col.head, .32]);
        if (close.x < -90 || close.x > CW + 90) { close = null; nextClose = 9 + Math.random() * 12; } }
      nextChase -= dt;
      if (!chase && nextChase < 0) { const dir = Math.random() < .5 ? 1 : -1, [a, b] = scene.chaseY || [50, 120], y = a + Math.random() * (b - a), s = scene.chaseS || 1.5;
        chase = { dir, y, s, x: dir > 0 ? -30 : CW + 30, v: 95 * s, cops: [{ gap: 34 * s, wob: 0 }, { gap: 62 * s, wob: 1.7 }] }; }
      if (chase) {
        chase.x += chase.dir * chase.v * dt; siren = Math.sin(t * 22);
        const yy = k => chase.y + Math.sin(t * 3 + k) * 2.2 * chase.s;           // weaving a little
        vehicle(chase.x, yy(0), chase.dir, chase.s, { under: col.magenta, head: '#ffffff' });
        chase.cops.forEach((c, i) => vehicle(chase.x - chase.dir * c.gap, yy(c.wob), chase.dir, chase.s, { under: col.blue, siren: i ? -siren : siren }));
        cc.globalCompositeOperation = 'lighter'; cc.globalAlpha = .035; cc.fillStyle = siren > 0 ? col.red : col.blue; cc.fillRect(0, 0, CW, CH);   // the whole street catches it
        glare.push([(chase.x - chase.dir * 34 * chase.s) * K, chase.y * K, siren > 0 ? col.red : col.blue, .22]);
        const last = chase.x - chase.dir * 70 * chase.s;
        if ((chase.dir > 0 && last > CW + 40) || (chase.dir < 0 && last < -40)) { chase = null; nextChase = 45 + Math.random() * 50; }
      }
      // lightning: a strike, a flicker, a second smaller flash, then dark again
      nextFlash -= dt;
      if (nextFlash < 0) { H.flash = 1; H.bolt = strike(); nextFlash = lMin + Math.random() * (lMax - lMin); }
      if (H.flash > 0) {
        const f = H.flash; H.lit = f * (f > .8 || (f > .45 && f < .6) ? 1 : .25);   // two bright moments, a dimmer flicker between
        H.flash = Math.max(0, f - dt * 1.3); if (!H.flash) H.bolt = null;
      } else H.lit = 0;
      cc.globalCompositeOperation = 'source-over'; cc.globalAlpha = 1;
    }

    function soften() {                                        // the city, out of focus: shrunk to 80x45, and a wider glow on top
      vc.globalCompositeOperation = 'source-over'; vc.globalAlpha = 1; vc.drawImage(raw, 0, 0, 80, 45);
      tc.clearRect(0, 0, 40, 23); tc.drawImage(city, 0, 0, 40, 23);
      if (scene.focus === 'far') vc.drawImage(tiny, 0, 0, 80, 45);                                         // 'far': even more out of focus
      vc.globalCompositeOperation = 'lighter'; vc.globalAlpha = .38; vc.drawImage(tiny, 0, 0, 80, 45);    // a wide glow around everything bright
      vc.globalCompositeOperation = 'source-over'; vc.globalAlpha = 1;
    }

    // ---- the wind: a steady slant that wanders, with a gust every so often ----
    const baseWind = scene.wind ?? .12;
    let gust = 0, nextGust = 8 + Math.random() * 10;
    function wind(t, dt) {
      nextGust -= dt; if (nextGust < 0) { gust = 1; nextGust = 10 + Math.random() * 18; }
      gust = Math.max(0, gust - dt * .35);
      return baseWind + .04 * Math.sin(t * .23) + .12 * Math.sin(gust * Math.PI) * storm;
    }

    // ---- rain outside the window, at three depths: fine and slow far off, long and soft close by ----
    const depths = [{ a: .13, w: 1, l: 12, v: 450 }, { a: .1, w: 1, l: 26, v: 720 }, { a: .08, w: 2, l: 48, v: 1050 }];
    depths.forEach((d, i) => d.s = Array.from({ length: Math.round([200, 120, 50][i] * storm) }, () => ({ x: Math.random() * GW, y: Math.random() * GH, v: d.v * (.85 + Math.random() * .3) })));
    function drawAir(w, dt) {
      ac.setTransform(1, 0, 0, 1, 0, 0); ac.clearRect(0, 0, AW, GH / 2); ac.setTransform(.5, 0, 0, .5, 0, 0);   // drawn in glass pixels, at half size
      glare.forEach(([x, y, c, a]) => { ac.globalAlpha = a; ac.drawImage(sprite(c), x - 290, y - 90, 580, 180); });   // light smearing across the wet pane
      ac.strokeStyle = '#b8c6ff'; ac.lineCap = 'round';
      depths.forEach(d => {
        ac.globalAlpha = d.a; ac.lineWidth = d.w; ac.beginPath();
        d.s.forEach(s => { s.y += s.v * dt; s.x += s.v * w * dt; if (s.y > GH + 60) { s.y = -60 - Math.random() * 80; s.x = Math.random() * (GW + 200) - 200; }
                           ac.moveTo(s.x, s.y); ac.lineTo(s.x - d.l * w, s.y - d.l); });
        ac.stroke();
      });
      ac.globalAlpha = 1;
    }

    // ---- the glass ----
    // A drop: a lens holding a wider patch of the city upside down (bigger drops), or a faint bead (small ones), and a glint.
    function drop(x, y, r, sx, sy, g = gc) {
      if (r > 2) {
        const px = x / K * Q, py = y / K * Q, R2 = r * 1.2 * Q;
        g.save(); g.beginPath(); g.ellipse(x, y, r * sx, r * sy, 0, 0, 6.29); g.clip();
        g.translate(x, y); g.scale(1, -1); g.globalAlpha = 1;
        g.drawImage(raw, px - R2, py - R2, R2 * 2, R2 * 2, -r * sx, -r * sy, r * 2 * sx, r * 2 * sy);
        g.restore();
      } else { g.globalAlpha = 1; g.fillStyle = 'rgba(200,215,255,.12)'; g.beginPath(); g.ellipse(x, y, r * sx, r * sy, 0, 0, 6.29); g.fill(); }
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(x - r * .3, y - r * .4 * sy, Math.max(.6, r * .18), 0, 6.29); g.fill();
    }
    const newDrop = (x = Math.random() * GW, y = Math.random() * GH, r = 1.2 + Math.random() * 3.6) =>
      ({ x, y, r, g: 0, sx: .92 + Math.random() * .16, sy: 1.02 + Math.random() * (r > 3 ? .3 : .12) });
    const landing = [];                                        // drops landing right now: they spread, then settle onto #drops
    let landRate = 0, seeded = false, nextDry = 1;
    const runners = [];
    const runner = (y = -20 - Math.random() * 120) => runners.push({ x: Math.random() * GW, y, r: 4 + Math.random() * 4.5, v: 0, lean: 0 });
    for (let i = 0; i < 10; i++) runner(Math.random() * GH);
    const dirty = [];                                          // where the moving drops were drawn last frame
    let still = 0;                                             // time gathered for the still drops, which change every other frame
    function drawGlass(w, dt, settle) {
      if (!seeded) { seeded = true; for (let i = 0; i < 480; i++) { const d = newDrop(); drop(d.x, d.y, d.r, d.sx, d.sy, dc); } }   // the glass starts wet
      // drops that have sat a while slowly dry off
      nextDry -= dt; if (nextDry < 0) { nextDry = 1; dc.globalCompositeOperation = 'destination-out'; dc.globalAlpha = .08; dc.fillStyle = "#000"; dc.fillRect(0, 0, GW, GH);
                                        dc.globalCompositeOperation = 'source-over'; dc.globalAlpha = 1; }
      // new drops land: they spread as they hit, then settle onto the still glass
      landRate += 42 * storm * landScale * dt; while (landRate > 1) { landRate--; landing.push(newDrop()); }
      dirty.forEach(([x, y, r]) => gc.clearRect(x - r - 3, y - r - 3, r * 2 + 6, r * 2.6 + 6)); dirty.length = 0;   // only where drops were
      drawAir(w, dt);
      gc.globalAlpha = 1;
      for (let i = landing.length - 1; i >= 0; i--) { const d = landing[i]; d.g = Math.min(1, d.g + dt * 6);
        if (d.g >= 1 && settle) { drop(d.x, d.y, d.r, d.sx, d.sy, dc); landing.splice(i, 1); } else { drop(d.x, d.y, d.r * d.g, d.sx, d.sy); dirty.push([d.x, d.y, d.r * 1.2]); } }
      // streams running down: each wipes its path clear, leaves a wet line and the odd small drop behind
      if (runners.length < runnerCap && Math.random() < .03 * storm) runner();
      dc.lineCap = 'round';
      for (let i = runners.length - 1; i >= 0; i--) {
        const d = runners[i];
        d.v = Math.min(160, Math.max(10, d.v + (Math.random() < .1 ? 60 : -8) * dt * 10));   // stop and go
        if (Math.random() < .02) d.lean = (Math.random() - .5) * 1.4;                       // now and then it changes course a little
        if (d.px === undefined) { d.px = d.x; d.py = d.y; }
        d.y += d.v * dt; d.x += (Math.random() - .5) * .9 + d.lean * d.v * dt * .2 + w * 6 * dt; d.r = Math.min(10, d.r + d.v * dt * .002);
        if (settle) {                                          // its path since the last time: wiped clear, a wet line left behind
          dc.globalCompositeOperation = 'destination-out'; dc.strokeStyle = '#000'; dc.lineWidth = d.r * 2.2; dc.beginPath(); dc.moveTo(d.px, d.py); dc.lineTo(d.x, d.y); dc.stroke();
          dc.globalCompositeOperation = 'source-over'; dc.strokeStyle = 'rgba(200, 220, 255, .07)'; dc.lineWidth = d.r * .9; dc.beginPath(); dc.moveTo(d.px, d.py); dc.lineTo(d.x, d.y); dc.stroke();
          if (Math.random() < .1) { const b = newDrop(d.x + (Math.random() - .5) * 3, d.y - d.r * 2.2, 1 + Math.random() * 1.4); drop(b.x, b.y, b.r, b.sx, b.sy, dc); }
          d.px = d.x; d.py = d.y;
        }
        if (d.y > GH + 20) runners.splice(i, 1); else { drop(d.x, d.y, d.r, 1, 1.25); dirty.push([d.x, d.y, d.r * 1.3]); }
      }
    }

    // ---- a slower TV: if it can't keep up after the first few seconds, the rain gets lighter (and stays lighter on
    //      this TV from then on); if even that is too much, the page around it is told to show the clock instead ----
    let landScale = 1, runnerCap = 12 * storm, light = false;
    function lighten() {
      light = true; landScale = .5; runnerCap = Math.round(7 * storm);
      depths.forEach(d => d.s.length = Math.round(d.s.length * .5));
      try { localStorage.setItem('homedeck-rain-light', 'true'); } catch {}
    }
    try { if (localStorage.getItem('homedeck-rain-light') === 'true' || /[?&]light\b/.test(location.search)) lighten(); } catch {}
    let paceT = -5, paceN = 0, paceSum = 0;                     // the first 5 seconds don't count: things are still loading
    function pace(dt) {
      if (paceN < 0) return;
      paceT += dt; if (paceT < 0) return;
      paceN++; paceSum += dt;
      if (paceN < 120) return;
      const avg = paceSum / paceN; paceN = 0; paceSum = 0; paceT = -2;
      if (avg > 1 / 22 && !light) lighten();                    // under 22 frames a second: lighter rain, then look again
      else if (avg > 1 / 16) { paceN = -1; try { parent.postMessage({ rain: 'too-slow' }, '*'); } catch {} }
      else paceN = -1;                                          // it keeps up: stop checking
    }

    // ---- run it ----
    scene.init && scene.init(H);
    let prev = performance.now(), cityDt = 0, glassDt = 0, odd = false;
    function frame(now) {
      const t = now / 1000, dt = Math.max(0, Math.min(.1, (now - prev) / 1000)); prev = now;   // a frame can be stamped before the page started: never step back
      cc.globalCompositeOperation = 'source-over'; cc.globalAlpha = 1;
      cityDt += dt; glassDt += dt; odd = !odd;                 // the city on one frame, the rain and glass on the next: each 30 times a second
      if (odd) { scene.draw(H, t, cityDt); drawEvents(t, cityDt); soften(); cityDt = 0; }
      else { const w = wind(t, glassDt); drawGlass(w, glassDt, true); glassDt = 0; }
      pace(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // the time hangs in the city like a sign, drifting slowly to a new spot every 50 seconds
    const time = $('time'), [x0, x1, y0, y1] = scene.timeBox || [120, 1170, 70, 490];
    const go = () => time.style.transform = `translate(${x0 + Math.random() * (x1 - x0)}px, ${y0 + Math.random() * (y1 - y0)}px)`;
    time.style.transition = 'none'; go(); void time.offsetWidth; time.style.transition = '';
    setInterval(go, 50000); setTimeout(go, 50);
    function tick() { const t = HD.time();
      document.querySelectorAll('[data-hm]').forEach(e => e.textContent = t.hm);
      document.querySelectorAll('[data-ap]').forEach(e => e.textContent = t.ap);
      document.querySelectorAll('[data-date]').forEach(e => e.textContent = t.date); }
    tick(); setInterval(tick, 1000);
  };
})();
