/* Home Deck interface kit: builders and helpers (HD.init, HD.glitch, HD.toast, HD.setMeter and more). */
(function() {
  "use strict";
  var doc = document;
  var html = doc.documentElement;
  var reduceQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function hashSeed(seed) {
    var s = String(seed == null || seed === "" ? "hd" : seed);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function rng(seed) {
    var a = hashSeed(seed);
    return function() {
      a = a + 1831565813 >>> 0;
      var t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function int(r, n) {
    return Math.floor(r() * n);
  }
  function pick(r, chars) {
    return chars.charAt(int(r, chars.length));
  }
  var HEX = "0123456789ABCDEF";
  var LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  var DIGITS = "0123456789";
  function num(el, name, fallback) {
    var v = parseFloat(el.getAttribute(name) || "");
    return isFinite(v) ? v : fallback;
  }
  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }
  function make(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function emit(el, type, detail) {
    el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
  }
  function all(root, sel) {
    var list = (
      /** @type {HTMLElement[]} */
      Array.prototype.slice.call(root.querySelectorAll(sel))
    );
    if (root instanceof HTMLElement && root.matches(sel)) list.unshift(root);
    return list.filter(function(e) {
      return e !== html && e !== doc.body;
    });
  }
  function claim(el, key) {
    var done = (el.getAttribute("data-hd-built") || "").split(" ");
    if (done.indexOf(key) !== -1) return false;
    done.push(key);
    el.setAttribute("data-hd-built", done.join(" ").trim());
    return true;
  }
  function fixed(v, d) {
    return d > 0 ? v.toFixed(d) : String(Math.round(v));
  }
  var strings = {
    /** space-separated hex pairs */
    hex: function(r, n) {
      var out = [];
      for (var i = 0; i < n; i++) out.push(pick(r, HEX) + pick(r, HEX));
      return out.join(" ");
    },
    /** 4-bit binary groups */
    nibble: function(r) {
      return pick(r, "01") + pick(r, "01") + pick(r, "01") + pick(r, "01");
    },
    /** mask: A = letter, 0 = digit, X = hex, anything else kept */
    serial: function(r, mask) {
      var out = "";
      for (var i = 0; i < mask.length; i++) {
        var c = mask.charAt(i);
        out += c === "A" ? pick(r, LETTERS) : c === "0" ? pick(r, DIGITS) : c === "X" ? pick(r, HEX) : c;
      }
      return out;
    },
    snake: function(r, prefix) {
      var words = ["NODE", "LINK", "RELAY", "CACHE", "FRAME", "SYNC", "GATE", "TRACE", "CELL", "BAND", "PROBE", "SHELL"];
      return (prefix || words[int(r, words.length)]) + "_" + words[int(r, words.length)] + "_" + strings.serial(r, "0000");
    },
    port: function(r) {
      return "LN." + strings.serial(r, "000") + "//" + strings.serial(r, "0000000");
    },
    coords: function(r) {
      function c(whole) {
        return (r() < 0.5 ? "-" : "") + (r() * whole).toFixed(3);
      }
      return c(4e3) + " / " + c(4e3) + " / " + c(90);
    },
    id: function(r) {
      return "0x" + strings.serial(r, "XXXX-XXX");
    },
    version: function(r) {
      return "REV " + int(r, 9) + "." + strings.serial(r, "00") + " / BLD " + strings.serial(r, "000.0");
    },
    float: function(r) {
      return (r() * 10).toFixed(4);
    }
  };
  function buildCode(el) {
    if (!claim(el, "code")) return;
    var kind = el.getAttribute("data-kind") || "hex";
    var r = rng(el.getAttribute("data-seed") || kind);
    var rows = num(el, "data-rows", 1);
    var grid = kind === "hex" || kind === "binary" || kind === "rain";
    var cols = num(el, "data-cols", grid ? 6 : 1);
    var lines = [];
    var i, j;
    el.setAttribute("aria-hidden", "true");
    el.classList.add(kind === "barcode" ? "hd-barcode" : "hd-code");
    if (kind === "barcode") {
      var stops = [];
      var x = 0;
      while (x < 100) {
        var w = 0.6 + r() * 2.6;
        var gap = 0.6 + r() * 2.2;
        stops.push("currentColor " + x.toFixed(2) + "% " + Math.min(100, x + w).toFixed(2) + "%");
        stops.push("transparent " + Math.min(100, x + w).toFixed(2) + "% " + Math.min(100, x + w + gap).toFixed(2) + "%");
        x += w + gap;
      }
      el.style.backgroundImage = "linear-gradient(90deg," + stops.join(",") + ")";
      if (!el.style.color) el.style.color = "var(--hd-chrome)";
      return;
    }
    if (kind === "log") {
      var steps = (el.getAttribute("data-steps") || "Link,Verify,Sync").split(",");
      el.classList.remove("hd-code");
      el.classList.add("hd-log");
      for (i = 0; i < steps.length; i++) {
        var line = make("div", "hd-log__line");
        line.appendChild(make("span", "", "//" + steps[i].trim().toUpperCase().replace(/\s+/g, "_")));
        line.appendChild(make("span", "", el.getAttribute("data-done") || "DONE"));
        el.appendChild(line);
      }
      return;
    }
    for (i = 0; i < rows; i++) {
      var row = [];
      for (j = 0; j < cols; j++) {
        if (kind === "hex") row.push(strings.hex(r, 1));
        else if (kind === "binary") row.push(strings.nibble(r));
        else if (kind === "rain") row.push(strings.float(r));
        else if (kind === "id") row.push(strings.id(r));
        else if (kind === "serial") row.push(strings.serial(r, el.getAttribute("data-mask") || "AAAA-0000-AAAA"));
        else if (kind === "snake") row.push(strings.snake(r, el.getAttribute("data-prefix") || ""));
        else if (kind === "port") row.push(strings.port(r));
        else if (kind === "coords") row.push(strings.coords(r));
        else if (kind === "version") row.push(strings.version(r));
      }
      lines.push(row.join(kind === "binary" || kind === "rain" ? "  " : " "));
    }
    el.textContent = lines.join("\n");
  }
  function buildTicks(el) {
    if (!claim(el, "ticks")) return;
    var count = Math.max(2, num(el, "data-count", 24));
    var major = Math.max(1, num(el, "data-major", 4));
    var labels = el.getAttribute("data-labels") === "true";
    var start = num(el, "data-start", 0);
    var step = num(el, "data-step", 1);
    el.setAttribute("aria-hidden", "true");
    el.classList.add("hd-ruler");
    if (el.getAttribute("data-orient") === "y") el.classList.add("hd-ruler--y");
    if (labels) el.classList.add("hd-ruler--labelled");
    for (var i = 0; i <= count; i++) {
      var isMajor = i % major === 0;
      var t = make("i", "hd-ruler__tick" + (isMajor ? " hd-ruler__tick--major" : ""));
      if (isMajor && labels) t.appendChild(make("span", "hd-ruler__num", String(start + i * step)));
      el.appendChild(t);
    }
  }
  var TIER_NAMES = ["Standard", "Tuned", "Superior", "Elite", "Apex"];
  function buildTier(el) {
    if (!claim(el, "tier")) return;
    var t = clamp(Math.round(num(el, "data-hd-tier", 1)), 1, 5);
    var names = (el.getAttribute("data-names") || "").split(",").filter(Boolean);
    var name = el.getAttribute("data-name") || names[t - 1] || TIER_NAMES[t - 1];
    el.classList.add("hd-tier");
    el.setAttribute("data-hd-tier", String(t));
    var bars = make("span", "hd-tier__bars");
    bars.setAttribute("aria-hidden", "true");
    for (var i = 1; i <= 5; i++) bars.appendChild(make("i", i <= t ? "is-on" : ""));
    var label = make("span", "hd-tier__name", name);
    label.appendChild(make("span", "hd-sr-only", ", tier " + t + " of 5"));
    el.textContent = "";
    el.appendChild(bars);
    el.appendChild(label);
  }
  function buildMeter(el) {
    if (!claim(el, "meter")) return;
    el.classList.add("hd-meter");
    var label = el.getAttribute("data-label") || "";
    var show = el.getAttribute("data-show") || (label ? "value" : "none");
    if (label || show !== "none") {
      var head = make("div", "hd-meter__head");
      if (label) head.appendChild(make("span", "hd-meter__label", label));
      if (show !== "none") {
        var v = make("span", "hd-meter__value");
        v.setAttribute("aria-hidden", "true");
        head.appendChild(v);
      }
      el.appendChild(head);
    }
    var track = make("div", "hd-meter__track");
    track.setAttribute("aria-hidden", "true");
    var segs = Math.max(0, Math.round(num(el, "data-segments", 0)));
    if (segs > 0) {
      for (var i = 0; i < segs; i++) track.appendChild(make("i", "hd-meter__seg"));
    } else {
      var bar = make("div", "hd-meter__bar");
      bar.appendChild(make("div", "hd-meter__fill"));
      track.appendChild(bar);
    }
    el.appendChild(track);
    el.setAttribute("role", "meter");
    if (label && !el.hasAttribute("aria-label")) el.setAttribute("aria-label", label);
    setMeter(el, num(el, "data-value", 0));
  }
  function setMeter(el, value) {
    var max = num(el, "data-max", 100);
    var v = clamp(value, 0, max);
    var p = max > 0 ? v / max : 0;
    var d = num(el, "data-decimals", 0);
    var unit = el.getAttribute("data-unit") || "";
    var show = el.getAttribute("data-show") || (el.getAttribute("data-label") ? "value" : "none");
    el.setAttribute("data-value", String(v));
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", String(max));
    el.setAttribute("aria-valuenow", String(v));
    var text = show === "percent" ? Math.round(p * 100) + "%" : fixed(v, d) + (unit ? " " + unit : "") + " / " + fixed(max, d);
    el.setAttribute("aria-valuetext", show === "percent" ? text : fixed(v, d) + (unit ? " " + unit : "") + " of " + fixed(max, d));
    var out = el.querySelector(".hd-meter__value");
    if (out) out.textContent = show === "percent" ? text : fixed(v, d) + (unit ? " " + unit : "");
    var segs = el.querySelectorAll(".hd-meter__seg");
    if (segs.length) {
      var filled = p * segs.length;
      for (var i = 0; i < segs.length; i++) {
        var s = (
          /** @type {HTMLElement} */
          segs[i]
        );
        s.classList.toggle("is-on", i + 1 <= filled + 1e-9);
        var part = filled - i;
        s.classList.toggle("is-part", part > 0 && part < 1);
        s.style.setProperty("--part", Math.round(part * 100) + "%");
      }
    }
    var fill = (
      /** @type {HTMLElement|null} */
      el.querySelector(".hd-meter__fill")
    );
    if (fill) fill.style.setProperty("--p", String(p));
  }
  function buildToggle(el) {
    if (!claim(el, "toggle")) return;
    var isButton = el.tagName === "BUTTON";
    el.classList.add("hd-toggle");
    el.setAttribute("role", "switch");
    if (isButton) el.setAttribute("type", "button");
    else el.tabIndex = 0;
    if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby") && el.getAttribute("data-label")) {
      el.setAttribute("aria-label", el.getAttribute("data-label") || "");
    }
    el.textContent = "";
    var off = make("span", "hd-toggle__half hd-toggle__half--off", el.getAttribute("data-off-text") || "Off");
    var on = make("span", "hd-toggle__half hd-toggle__half--on", el.getAttribute("data-on-text") || "On");
    off.setAttribute("aria-hidden", "true");
    on.setAttribute("aria-hidden", "true");
    el.appendChild(off);
    el.appendChild(on);
    function set(v) {
      el.setAttribute("aria-checked", v ? "true" : "false");
      el.setAttribute("data-on", v ? "true" : "false");
    }
    set(el.getAttribute("data-on") === "true");
    function flip() {
      if (el.getAttribute("aria-disabled") === "true") return;
      var v = el.getAttribute("aria-checked") !== "true";
      set(v);
      emit(el, "hd-change", { checked: v });
    }
    el.addEventListener("click", flip);
    if (!isButton) {
      el.addEventListener("keydown", function(e) {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          flip();
        }
      });
    }
  }
  var ARROW_SVG = '<svg viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M10 2 3 7l7 5z"/></svg>';
  function buildPicker(el) {
    if (!claim(el, "picker")) return;
    var opts = (el.getAttribute("data-options") || "Off,On").split(",").map(function(s) {
      return s.trim();
    });
    var idx = clamp(Math.round(num(el, "data-index", 0)), 0, opts.length - 1);
    el.classList.add("hd-picker");
    el.setAttribute("role", "spinbutton");
    el.tabIndex = el.getAttribute("aria-disabled") === "true" ? -1 : 0;
    if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) el.setAttribute("aria-label", el.getAttribute("data-label") || "Option");
    el.setAttribute("aria-valuemin", "0");
    el.setAttribute("aria-valuemax", String(opts.length - 1));
    el.textContent = "";
    var prev = make("span", "hd-picker__arrow hd-picker__arrow--prev");
    prev.innerHTML = ARROW_SVG;
    var next = make("span", "hd-picker__arrow hd-picker__arrow--next");
    next.innerHTML = ARROW_SVG;
    var svg = next.querySelector("svg");
    if (svg) svg.style.transform = "scaleX(-1)";
    var mid = make("span", "hd-picker__mid");
    var value = make("span", "hd-picker__value");
    var dashes = make("span", "hd-picker__dashes");
    mid.setAttribute("aria-hidden", "true");
    for (var i = 0; i < opts.length; i++) dashes.appendChild(make("i"));
    mid.appendChild(value);
    mid.appendChild(dashes);
    el.appendChild(prev);
    el.appendChild(mid);
    el.appendChild(next);
    function set(n, fire) {
      if (el.getAttribute("aria-disabled") === "true") return;
      var wrap = el.getAttribute("data-wrap") !== "false";
      if (wrap) n = (n + opts.length) % opts.length;
      else n = clamp(n, 0, opts.length - 1);
      idx = n;
      el.setAttribute("data-index", String(n));
      el.setAttribute("aria-valuenow", String(n));
      el.setAttribute("aria-valuetext", opts[n]);
      value.textContent = opts[n];
      for (var k = 0; k < dashes.children.length; k++) dashes.children[k].classList.toggle("is-on", k === n);
      if (fire) emit(el, "hd-change", { index: n, value: opts[n] });
    }
    set(idx, false);
    if (el.getAttribute("aria-disabled") === "true") {
      value.textContent = opts[idx];
      for (var d = 0; d < dashes.children.length; d++) dashes.children[d].classList.toggle("is-on", d === idx);
    }
    prev.addEventListener("click", function() {
      set(idx - 1, true);
      el.focus();
    });
    next.addEventListener("click", function() {
      set(idx + 1, true);
      el.focus();
    });
    el.addEventListener("keydown", function(e) {
      var k = e.key;
      if (k === "ArrowLeft" || k === "ArrowDown") {
        e.preventDefault();
        set(idx - 1, true);
      } else if (k === "ArrowRight" || k === "ArrowUp") {
        e.preventDefault();
        set(idx + 1, true);
      } else if (k === "Home") {
        e.preventDefault();
        set(0, true);
      } else if (k === "End") {
        e.preventDefault();
        set(opts.length - 1, true);
      }
    });
  }
  function buildSlider(el) {
    if (!claim(el, "slider")) return;
    var min = num(el, "data-min", 0);
    var max = num(el, "data-max", 100);
    var step = num(el, "data-step", 1);
    var dec = num(el, "data-decimals", step < 1 ? String(step).split(".")[1].length : 0);
    var unit = el.getAttribute("data-unit") || "";
    var val = num(el, "data-value", min);
    el.classList.add("hd-slider");
    el.setAttribute("role", "slider");
    el.tabIndex = 0;
    if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) el.setAttribute("aria-label", el.getAttribute("data-label") || "Value");
    el.setAttribute("aria-valuemin", String(min));
    el.setAttribute("aria-valuemax", String(max));
    el.textContent = "";
    var trail = make("span", "hd-slider__trail");
    var handle = make("span", "hd-slider__handle");
    var out = make("span", "hd-slider__value");
    trail.setAttribute("aria-hidden", "true");
    handle.setAttribute("aria-hidden", "true");
    out.setAttribute("aria-hidden", "true");
    el.appendChild(trail);
    el.appendChild(handle);
    el.appendChild(out);
    function set(v, fire) {
      v = clamp(Math.round((v - min) / step) * step + min, min, max);
      v = parseFloat(v.toFixed(Math.max(dec, 0)));
      var changed = v !== val;
      val = v;
      var p = max > min ? (v - min) / (max - min) : 0;
      el.style.setProperty("--p", String(p));
      el.setAttribute("aria-valuenow", String(v));
      el.setAttribute("aria-valuetext", fixed(v, dec) + (unit ? " " + unit : ""));
      el.setAttribute("data-value", String(v));
      out.textContent = fixed(v, dec) + (unit ? unit : "");
      if (fire && changed) emit(el, "hd-change", { value: v });
    }
    set(val, false);
    el.addEventListener("keydown", function(e) {
      var k = e.key;
      var big = step * 10;
      if (k === "ArrowLeft" || k === "ArrowDown") {
        e.preventDefault();
        set(val - step, true);
      } else if (k === "ArrowRight" || k === "ArrowUp") {
        e.preventDefault();
        set(val + step, true);
      } else if (k === "PageDown") {
        e.preventDefault();
        set(val - big, true);
      } else if (k === "PageUp") {
        e.preventDefault();
        set(val + big, true);
      } else if (k === "Home") {
        e.preventDefault();
        set(min, true);
      } else if (k === "End") {
        e.preventDefault();
        set(max, true);
      }
    });
    var dragging = false;
    function fromPointer(e) {
      var box = el.getBoundingClientRect();
      var hw = handle.getBoundingClientRect().width || 30;
      var p = clamp((e.clientX - box.left - hw / 2) / Math.max(1, box.width - hw), 0, 1);
      set(min + p * (max - min), true);
    }
    el.addEventListener("pointerdown", function(e) {
      dragging = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch (err) {
      }
      fromPointer(e);
      el.focus();
    });
    el.addEventListener("pointermove", function(e) {
      if (dragging) fromPointer(e);
    });
    el.addEventListener("pointerup", function() {
      dragging = false;
    });
    el.addEventListener("pointercancel", function() {
      dragging = false;
    });
  }
  function buildTabs(el) {
    if (!claim(el, "tabs")) return;
    el.setAttribute("role", "tablist");
    var tabs = all(el, '[role="tab"]');
    if (!tabs.length) return;
    function select(tab, focus) {
      tabs.forEach(function(t) {
        var on = t === tab;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        var id = t.getAttribute("aria-controls");
        var panel = id ? doc.getElementById(id) : null;
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
    }
    var current = tabs.filter(function(t) {
      return t.getAttribute("aria-selected") === "true";
    })[0] || tabs[0];
    select(current, false);
    tabs.forEach(function(t, i) {
      if (t.tagName === "BUTTON") t.setAttribute("type", "button");
      t.addEventListener("click", function() {
        select(t, false);
        emit(el, "hd-change", { tab: t });
      });
      t.addEventListener("keydown", function(e) {
        var n = -1;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") n = 0;
        else if (e.key === "End") n = tabs.length - 1;
        if (n > -1) {
          e.preventDefault();
          select(tabs[n], true);
          emit(el, "hd-change", { tab: tabs[n] });
        }
      });
    });
  }
  function buildSelect(el) {
    if (!claim(el, "select")) return;
    el.setAttribute("role", "listbox");
    var opts = all(el, '[role="option"]');
    if (!opts.length) return;
    var follow = el.getAttribute("data-follow") !== "false";
    function focusOpt(o, sel) {
      opts.forEach(function(x) {
        x.tabIndex = x === o ? 0 : -1;
      });
      if (sel) {
        opts.forEach(function(x) {
          x.setAttribute("aria-selected", x === o ? "true" : "false");
        });
        emit(el, "hd-change", { option: o });
      }
      o.focus();
    }
    var start = opts.filter(function(o) {
      return o.getAttribute("aria-selected") === "true";
    })[0] || opts[0];
    opts.forEach(function(o, i) {
      o.tabIndex = o === start ? 0 : -1;
      if (!o.hasAttribute("aria-selected")) o.setAttribute("aria-selected", "false");
      o.addEventListener("click", function() {
        if (o.getAttribute("aria-disabled") === "true") return;
        focusOpt(o, true);
        emit(el, "hd-pick", { option: o });
      });
      o.addEventListener("keydown", function(e) {
        var n = -1;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") n = Math.min(opts.length - 1, i + 1);
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") n = Math.max(0, i - 1);
        else if (e.key === "Home") n = 0;
        else if (e.key === "End") n = opts.length - 1;
        else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (o.getAttribute("aria-disabled") !== "true") {
            focusOpt(o, true);
            emit(el, "hd-pick", { option: o });
          }
          return;
        }
        if (n > -1) {
          e.preventDefault();
          focusOpt(opts[n], follow);
        }
      });
    });
  }
  function buildGlitch(el) {
    if (!claim(el, "glitch")) return;
    var text = el.getAttribute("data-text") || el.textContent || "";
    text = text.trim();
    el.setAttribute("data-text", text);
    el.classList.add("hd-glitch");
    var layers = clamp(Math.round(num(el, "data-layers", 2)), 0, 3);
    el.textContent = "";
    var main = make("span", "hd-glitch__main", text);
    el.appendChild(main);
    for (var i = 0; i < layers; i++) {
      var echo = make("span", "hd-glitch__echo", text);
      echo.setAttribute("aria-hidden", "true");
      el.appendChild(echo);
    }
    var on = (el.getAttribute("data-glitch-on") || "").split(/\s+/);
    if (on.indexOf("view") !== -1 && "IntersectionObserver" in window) {
      var io = new IntersectionObserver(function(entries) {
        entries.forEach(function(en) {
          if (en.isIntersecting) {
            glitch(el);
            io.disconnect();
          }
        });
      }, { threshold: 0.6 });
      io.observe(el);
    }
    if (on.indexOf("focus") !== -1) {
      el.addEventListener("mouseenter", function() {
        glitch(el);
      });
      el.addEventListener("focusin", function() {
        glitch(el);
      });
    }
    if (on.indexOf("click") !== -1) el.addEventListener("click", function() {
      glitch(el);
    });
  }
  function glitch(target) {
    if (!glitchAllowed()) return;
    var list = target.classList.contains("hd-glitch") ? [target] : Array.prototype.slice.call(target.querySelectorAll(".hd-glitch"));
    list.forEach(function(el) {
      var last = Number(el.getAttribute("data-hd-last") || 0);
      var now = Date.now();
      if (now - last < 1e3) return;
      el.setAttribute("data-hd-last", String(now));
      el.classList.remove("is-glitching");
      void el.offsetWidth;
      el.classList.add("is-glitching");
      window.setTimeout(function() {
        el.classList.remove("is-glitching");
      }, 320);
    });
  }
  function buildOpen(el) {
    if (!claim(el, "open")) return;
    el.addEventListener("click", function() {
      var id = el.getAttribute("data-hd-open") || "";
      var d = (
        /** @type {HTMLDialogElement|null} */
        doc.getElementById(id)
      );
      if (!d || typeof d.showModal !== "function") return;
      d.showModal();
      glitch(d);
    });
  }
  function buildClose(el) {
    if (!claim(el, "close")) return;
    el.addEventListener("click", function() {
      var d = (
        /** @type {HTMLDialogElement|null} */
        el.closest("dialog")
      );
      if (d) d.close(el.getAttribute("data-hd-close") || "");
    });
  }
  function toastRegion() {
    var reg = (
      /** @type {HTMLElement|null} */
      doc.querySelector(".hd-toasts")
    );
    if (!reg) {
      reg = make("div", "hd-toasts");
      doc.body.appendChild(reg);
    }
    reg.setAttribute("role", "status");
    reg.setAttribute("aria-live", "polite");
    return reg;
  }
  function toast(o) {
    o = o || {};
    var reg = toastRegion();
    var t = make("div", "hd-toast");
    t.setAttribute("data-kind", o.kind || "job");
    var icon = make("span", "hd-toast__icon");
    icon.setAttribute("aria-hidden", "true");
    t.appendChild(icon);
    t.appendChild(make("span", "hd-toast__kind", o.label || "Update"));
    t.appendChild(make("span", "hd-toast__title", o.title || "Notice"));
    if (o.text) t.appendChild(make("span", "hd-toast__text", o.text));
    var id = make("span", "hd-toast__id", "LINK " + strings.serial(rng(o.seed || o.title || "toast"), "000.00.00"));
    id.setAttribute("aria-hidden", "true");
    t.appendChild(id);
    while (reg.children.length >= 3) reg.removeChild(reg.children[0]);
    reg.appendChild(t);
    var life = o.timeout || 5e3;
    window.setTimeout(function() {
      t.classList.add("is-leaving");
      window.setTimeout(function() {
        if (t.parentNode) t.parentNode.removeChild(t);
      }, 300);
    }, life);
    return t;
  }
  function buildToastTrigger(el) {
    if (!claim(el, "toast")) return;
    el.addEventListener("click", function() {
      toast({
        kind: el.getAttribute("data-kind") || "job",
        label: el.getAttribute("data-label") || void 0,
        title: el.getAttribute("data-title") || void 0,
        text: el.getAttribute("data-text") || void 0,
        seed: el.getAttribute("data-seed") || void 0
      });
    });
  }
  var MODES = ["normal", "alert", "lime", "violet"];
  function setMode(mode, target) {
    if (MODES.indexOf(mode) === -1) mode = "normal";
    var el = target || html;
    el.setAttribute("data-hd-mode", mode);
    all(doc, '[data-glitch-on~="mode"]').forEach(function(g) {
      if (el === html || el.contains(g)) glitch(g);
    });
    all(doc, "[data-hd-mode-input]").forEach(function(inp) {
      var i = (
        /** @type {HTMLInputElement} */
        inp
      );
      var tgt = i.getAttribute("data-hd-target");
      var tEl = tgt ? doc.querySelector(tgt) : html;
      if (tEl === el) i.checked = i.value === mode;
    });
    emit(el, "hd-modechange", { mode });
  }
  function setFlag(name, on) {
    html.setAttribute("data-hd-" + name, on ? "on" : "off");
    all(doc, '[data-hd-flag="' + name + '"]').forEach(function(b) {
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    emit(html, "hd-flagchange", { flag: name, on });
  }
  function flagOn(name) {
    return html.getAttribute("data-hd-" + name) === "on";
  }
  function glitchAllowed() {
    var g = html.getAttribute("data-hd-glitch");
    if (g === "off") return false;
    if (g === "on") return true;
    return !(reduceQuery && reduceQuery.matches);
  }
  function defaultFlags() {
    var reduce = !!(reduceQuery && reduceQuery.matches);
    if (!html.hasAttribute("data-hd-motion")) html.setAttribute("data-hd-motion", reduce ? "off" : "on");
    if (!html.hasAttribute("data-hd-glitch")) html.setAttribute("data-hd-glitch", reduce ? "off" : "on");
    if (!html.hasAttribute("data-hd-crt")) html.setAttribute("data-hd-crt", reduce ? "off" : "on");
    if (!html.hasAttribute("data-hd-tilt")) html.setAttribute("data-hd-tilt", reduce ? "off" : "on");
  }
  function buildFlag(el) {
    if (!claim(el, "flag")) return;
    var name = el.getAttribute("data-hd-flag") || "";
    if (el.tagName === "BUTTON") el.setAttribute("type", "button");
    el.setAttribute("aria-pressed", flagOn(name) ? "true" : "false");
    el.addEventListener("click", function() {
      setFlag(name, !flagOn(name));
    });
  }
  function buildModeInput(el) {
    if (!claim(el, "mode")) return;
    var i = (
      /** @type {HTMLInputElement} */
      el
    );
    var tgt = i.getAttribute("data-hd-target");
    var tEl = tgt ? doc.querySelector(tgt) : html;
    var cur = tEl && tEl.getAttribute("data-hd-mode") || "normal";
    i.checked = i.value === cur;
    i.addEventListener("change", function() {
      if (i.checked) setMode(i.value, tEl || html);
    });
  }
  function parseColor(c) {
    c = String(c).trim();
    var m;
    if (c.charAt(0) === "#") {
      var h = c.slice(1);
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    m = c.match(/rgba?\(([^)]+)\)/);
    if (m) return m[1].split(/[\s,\/]+/).filter(Boolean).slice(0, 3).map(function(v) {
      return parseFloat(v);
    });
    return [0, 0, 0];
  }
  function lum(c) {
    var rgb = parseColor(c).map(function(v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }
  function contrast(a, b) {
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function init(root) {
    var r = root || doc;
    defaultFlags();
    all(r, "[data-hd-code]").forEach(buildCode);
    all(r, "[data-hd-ticks]").forEach(buildTicks);
    all(r, "[data-hd-tier]").forEach(buildTier);
    all(r, "[data-hd-meter]").forEach(buildMeter);
    all(r, "[data-hd-toggle]").forEach(buildToggle);
    all(r, "[data-hd-picker]").forEach(buildPicker);
    all(r, "[data-hd-slider]").forEach(buildSlider);
    all(r, "[data-hd-tabs]").forEach(buildTabs);
    all(r, "[data-hd-select]").forEach(buildSelect);
    all(r, "[data-hd-glitch-text]").forEach(buildGlitch);
    all(r, "[data-hd-open]").forEach(buildOpen);
    all(r, "[data-hd-close]").forEach(buildClose);
    all(r, "[data-hd-toast]").forEach(buildToastTrigger);
    all(r, "[data-hd-flag]").forEach(buildFlag);
    all(r, "[data-hd-mode-input]").forEach(buildModeInput);
    return api;
  }
  var api = {
    version: "1.0.0",
    init,
    setMode,
    getMode: function(el) {
      return (el || html).getAttribute("data-hd-mode") || "normal";
    },
    setMotion: function(on) {
      setFlag("motion", on);
    },
    setCRT: function(on) {
      setFlag("crt", on);
    },
    setGlitch: function(on) {
      setFlag("glitch", on);
    },
    setTilt: function(on) {
      setFlag("tilt", on);
    },
    flags: function() {
      return { motion: flagOn("motion"), crt: flagOn("crt"), glitch: flagOn("glitch"), tilt: flagOn("tilt") };
    },
    glitch,
    toast,
    setMeter,
    rng,
    strings,
    contrast,
    build: {
      code: buildCode,
      ticks: buildTicks,
      tier: buildTier,
      meter: buildMeter,
      toggle: buildToggle,
      picker: buildPicker,
      slider: buildSlider,
      tabs: buildTabs,
      select: buildSelect,
      glitch: buildGlitch
    }
  };
  window.HD = api;
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", function() {
    init(doc);
  });
  else init(doc);
})();
