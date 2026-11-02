// The towers scene the rainy city views are built on: looking straight across at three depths of towers,
// haze between them, windows lit floor by floor, the odd flickering TV, red lights blinking on the tallest roofs,
// neon signs built from stacked segments so they read like lettering, a big screen with moving bands of color, a
// searchlight, low fog drifting through, traffic flying between the towers, and the towers standing out black
// against the sky when lightning flashes behind them. Each view passes its own settings:
//   winSize, winChance  how big the windows' lights are, and how many windows are lit (1 is normal)
//   signs, signScale    how many signs, and how big
//   neon                the colors the signs take, in turn
//   haze                [color, strength] pairs for the glow rising from the streets
//   screen, searchlight, fog   whether to draw them
//
// For the TV, everything that stays put is drawn once into its own canvas (at the core's reduced size, H.Q): the sky
// with the farthest towers and their haze already on it, the two nearer layers of towers with their windows, and the
// haze over the middle one. Each frame only stacks those up and adds what moves. A window switching on or off is
// painted straight into its layer.
(() => {
  RainCity.towers = (o = {}) => {
    const set = { winSize: 1.4, winChance: 1, signs: 11, signScale: 1, neon: ['chrome', 'act', 'magenta', 'cyan', 'amber', 'chrome', 'act'],
                  haze: [['chrome', .28], ['act', .1]], screen: true, searchlight: true, fog: true, ...o };
    // three kinds of tower: offices lit floor by floor in cool light, homes in scattered warm light, and some dark
    const KINDS = { office: { colors: ['white', 'cyan', 'cyan'], floor: .55, win: .7 }, home: { colors: ['amber', 'amber', 'magenta'], floor: 0, win: .5 },
                    dark: { colors: ['amber'], floor: 0, win: .12 } };
    let layers, signs, screen, fogs, beacons, tvs, back, beam, W;
    function paint(H) {                                        // (re)draw the parts that stay put; again when the theme changes
      const { CW, CH, Q, col, mk } = H;
      const make = () => { const [c, x] = mk(CW * Q, CH * Q); x.setTransform(Q, 0, 0, Q, 0, 0); return c; };
      back = back || make(); const s = back.getContext('2d'); s.clearRect(0, 0, CW, CH);
      s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1; s.fillStyle = '#030307'; s.fillRect(0, 0, CW, CH);
      set.haze.forEach(([c, a], i) => { const g = s.createLinearGradient(0, 30 + i * 30, 0, CH); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, col[c]);
                                        s.globalAlpha = a; s.fillStyle = g; s.fillRect(0, 0, CW, CH); });
      layers.forEach(L => {
        L.canvas = L.canvas || make(); const x = L.canvas.getContext('2d'); x.clearRect(0, 0, CW, CH);
        x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.fillStyle = L.shade;
        L.towers.forEach(tw => { x.fillRect(tw.x, CH - tw.h, tw.w, tw.h); if (tw.spire) x.fillRect(tw.x + tw.w / 2 - .5, CH - tw.h - 12, 1, 12); });
        L.wins.forEach(w => w.on && !w.tv && win(L, w, col));
        if (L.haze) {                                          // the farther the layer, the more the rain and haze swallow it
          L.veil = L.veil || make(); const v = L.veil.getContext('2d'); v.clearRect(0, 0, CW, CH); v.globalCompositeOperation = 'source-over';
          v.globalAlpha = L.haze * .35; v.fillStyle = '#100c18'; v.fillRect(0, 0, CW, CH);
          const g = v.createLinearGradient(0, 40, 0, CH); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, col.chrome);
          v.globalCompositeOperation = 'lighter'; v.globalAlpha = L.haze * .25; v.fillStyle = g; v.fillRect(0, 0, CW, CH);
        }
      });
      const far = layers[0];                                   // the farthest towers never change: merge them into the sky
      s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1; s.drawImage(far.canvas, 0, 0, CW, CH); s.drawImage(far.veil, 0, 0, CW, CH);
      [beam] = mk(64, 220); const b = beam.getContext('2d'), bg = b.createLinearGradient(0, 220, 0, 0);
      bg.addColorStop(0, col.white); bg.addColorStop(1, 'rgba(0,0,0,0)'); b.fillStyle = bg;
      b.beginPath(); b.moveTo(29, 220); b.lineTo(35, 220); b.lineTo(54, 20); b.lineTo(10, 20); b.fill();
    }
    function win(L, w, col) {                                  // one window, lit or dark, painted straight into its layer
      const x = L.canvas.getContext('2d');
      if (w.on) { x.globalCompositeOperation = 'lighter'; x.globalAlpha = L.wa * w.b; x.fillStyle = col[w.c]; }
      else { x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; x.fillStyle = L.shade; }
      x.fillRect(w.x, w.y, W, W * 1.15);
    }
    return {
      flashInScene: true,
      init(H) {
        const { R, CW, CH } = H;
        W = set.winSize;
        layers = [{ n: 14, hMin: 70, hMax: 150, wMin: 14, wMax: 30, shade: '#120f1c', win: .2, wa: .3, haze: .3 },
                  { n: 11, hMin: 50, hMax: 140, wMin: 20, wMax: 40, shade: '#0b0912', win: .26, wa: .45, haze: .14 },
                  { n: 7,  hMin: 30, hMax: 120, wMin: 30, wMax: 60, shade: '#060509', win: .3,  wa: .62, haze: 0 }];
        const step = W * 2.5;
        beacons = []; tvs = [];
        layers.forEach((L, li) => {
          L.towers = Array.from({ length: L.n }, () => ({ x: R() * (CW + 40) - 20, w: L.wMin + R() * (L.wMax - L.wMin), h: L.hMin + R() * (L.hMax - L.hMin),
                                                           spire: R() < .3, kind: R() < .35 ? 'office' : R() < .8 ? 'home' : 'dark' }));
          L.wins = [];
          L.towers.forEach(t => {
            const k = KINDS[t.kind];
            for (let y = CH - t.h + 4; y < CH - 2; y += step * 1.15) {
              const floorLit = R() < k.floor;                      // an office floor with the lights on, end to end
              for (let x = t.x + 2; x < t.x + t.w - 2; x += step)
                if (floorLit || R() < L.win * k.win * set.winChance) {
                  const w = { x, y, c: k.colors[(R() * k.colors.length) | 0], b: .45 + R() * .55, tv: !floorLit && R() < .03, on: R() < .9 };
                  L.wins.push(w); if (w.tv) tvs.push({ L, w });
                }
            }
            if (t.h > 120 || t.spire) beacons.push({ x: t.x + t.w / 2, y: CH - t.h - (t.spire ? 12 : 0), layer: li, p: R() * 6.28 });
          });
          L.flip = L.wins.filter(w => !w.tv);                  // the windows that switch on and off now and then
        });
        signs = Array.from({ length: set.signs }, (_, i) => { const tall = R() < .6, k = set.signScale;
          return { x: 10 + R() * (CW - 20), y: 40 + R() * 90, tall, w: (tall ? 3.5 + R() * 1.5 : 16 + R() * 22) * k, h: (tall ? 16 + R() * 26 : 4 + R() * 3) * k,
                   c: set.neon[i % set.neon.length], flick: R() < .35, p: R() * 6.28, out: 0, dead: -1, seg: 3 + ((R() * 4) | 0) }; });
        screen = { x: 196, y: 52, w: 44, h: 26, t: 0 };
        fogs = Array.from({ length: 3 }, () => ({ x: R() * CW, y: 132 + R() * 42, r: 50 + R() * 50, v: 2 + R() * 4 }));
        paint(H); addEventListener('hd-mode', () => paint(H));
      },
      draw(H, t, dt) {
        const { cc, CW, CH, col, blob, traffic } = H;
        cc.globalCompositeOperation = 'source-over'; cc.globalAlpha = 1; cc.drawImage(back, 0, 0, CW, CH);   // sky and the farthest towers
        if (H.lit) {                                              // lightning behind the towers: the sky lights up, the bolt in it
          cc.globalCompositeOperation = 'lighter'; cc.globalAlpha = .45 * H.lit; cc.fillStyle = '#b9c6ff'; cc.fillRect(0, 0, CW, CH);
          if (H.bolt) { cc.strokeStyle = '#ffffff'; cc.lineJoin = 'round';
            H.bolt.forEach((path, k) => { cc.globalAlpha = (k ? .5 : .95) * H.lit; cc.lineWidth = k ? .6 : 1.2; cc.beginPath();
              path.forEach(([x, y], n) => n ? cc.lineTo(x, y) : cc.moveTo(x, y)); cc.stroke(); }); }
        }
        if (set.searchlight) {                                    // a searchlight, slowly sweeping
          cc.globalCompositeOperation = 'lighter'; cc.globalAlpha = .07;
          cc.save(); cc.translate(70, CH); cc.rotate(Math.sin(t * .13) * .5); cc.drawImage(beam, -32, -220); cc.restore();
        }
        if (Math.random() < .5) { const L = layers[1 + ((Math.random() * 2) | 0)], w = L.flip[(Math.random() * L.flip.length) | 0]; if (w) { w.on = !w.on; win(L, w, col); } }
        traffic(0, dt);                                          // traffic beyond the middle towers
        layers.forEach((L, li) => {
          if (!li) return;                                         // the farthest layer is already in the sky
          cc.globalCompositeOperation = 'source-over'; cc.globalAlpha = 1; cc.drawImage(L.canvas, 0, 0, CW, CH);
          cc.globalCompositeOperation = 'lighter';
          tvs.forEach(({ L: tl, w }) => { if (tl === L) { cc.globalAlpha = L.wa * w.b * (.5 + Math.random() * .5); cc.fillStyle = col.tv; cc.fillRect(w.x, w.y, W, W * 1.15); } });
          beacons.forEach(b => { if (b.layer === li && Math.sin(t * 2 + b.p) > .75) blob(b.x, b.y - 1, 2.2, col.red, .85); });   // red lights on the roofs
          if (L.veil) { cc.globalCompositeOperation = 'source-over'; cc.globalAlpha = 1; cc.drawImage(L.veil, 0, 0, CW, CH); }
          if (li === 1) traffic(1, dt);                            // traffic between the middle and the nearest towers
        });
        cc.globalCompositeOperation = 'lighter';
        signs.forEach(s => {
          if (s.flick && Math.random() < .006) s.out = .25 + Math.random() * .6;
          if (Math.random() < .0015) s.dead = s.dead < 0 ? (Math.random() * s.seg) | 0 : -1;  // a segment goes out for a while, then comes back
          s.out = Math.max(0, s.out - dt);
          if (s.out > 0 && Math.sin(t * 50 + s.p) > -.2) return;
          const pulse = .75 + .25 * Math.sin(t * 1.3 + s.p);
          cc.globalAlpha = .75 * pulse; cc.fillStyle = col[s.c];
          if (s.tall) {                                            // a vertical sign: a stack of glyph blocks, read top to bottom
            const gh = s.h / s.seg;
            for (let k = 0; k < s.seg; k++) if (k !== s.dead) cc.fillRect(s.x, s.y + k * gh + gh * .12, s.w, gh * .76);
          } else {                                                 // a wide sign: two lines of lettering in a frame
            cc.fillRect(s.x, s.y, s.w, s.h * .38); cc.globalAlpha *= .7; cc.fillRect(s.x + s.w * .08, s.y + s.h * .55, s.w * (s.dead >= 0 ? .5 : .84), s.h * .3);
          }
          blob(s.x + s.w / 2, s.y + s.h / 2, Math.max(s.w, s.h) * 1.3, col[s.c], .25 * pulse);
        });
        if (set.screen) {                                          // the big screen: bands of color rolling up it, the odd glitchy jump
          screen.t += dt; const jump = Math.random() < .01 ? 1.6 : 1;
          for (let k = 0; k < 6; k++) { const y = screen.y + ((k * screen.h / 6 - screen.t * 6) % screen.h + screen.h) % screen.h;
            cc.globalAlpha = .2 * jump; cc.fillStyle = col[k % 3 ? 'magenta' : 'cyan']; cc.fillRect(screen.x, y, screen.w, screen.h / 6 * .8); }
          blob(screen.x + screen.w / 2, screen.y + screen.h / 2, 46, col.magenta, .14);
        }
        if (set.fog) fogs.forEach(f => { f.x += f.v * dt; if (f.x - f.r > CW) f.x = -f.r; blob(f.x, f.y, f.r, col.chrome, .07); });   // low fog drifting through
        if (H.lit) { cc.globalAlpha = .08 * H.lit; cc.fillStyle = '#b9c6ff'; cc.fillRect(0, 0, CW, CH); }   // a little of the flash on the towers too
        cc.globalCompositeOperation = 'source-over'; cc.globalAlpha = 1;
      },
    };
  };
})();
