/* ==========================================================================
   Board & Brew — slideshow engine
   ========================================================================== */
(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var slides = Array.prototype.slice.call(stage.querySelectorAll(".slide"));
  var total = slides.length;
  var prevBtn = document.getElementById("prevBtn");
  var nextBtn = document.getElementById("nextBtn");
  var fsBtn = document.getElementById("fsBtn");
  var currentEl = document.getElementById("current");
  var totalEl = document.getElementById("total");
  var progressBar = document.getElementById("progressBar");
  var hint = document.getElementById("hint");

  var TRANSITION_MS = 600;
  var IDLE_MS = 3000;
  var WHEEL_COOLDOWN_MS = 900;
  var SWIPE_MIN_PX = 50;

  var index = -1;
  var hasNavigated = false;
  var leaveTimers = [];

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function clamp(n) { return Math.max(0, Math.min(total - 1, n)); }

  function indexFromHash() {
    var n = parseInt(window.location.hash.replace("#", ""), 10);
    return isNaN(n) ? 0 : clamp(n - 1);
  }

  /* ---------- Core navigation ---------- */
  function goTo(target, opts) {
    opts = opts || {};
    target = clamp(target);
    if (target === index) return;

    var prev = index;
    var forward = target > prev;
    index = target;

    stage.classList.toggle("is-back", !forward && prev !== -1);

    // Clear any in-flight leave states so rapid presses stay clean
    leaveTimers.forEach(clearTimeout);
    leaveTimers = [];
    slides.forEach(function (s) { s.classList.remove("is-leaving", "to-left", "to-right"); });

    if (prev !== -1 && !opts.instant) {
      var out = slides[prev];
      out.classList.add("is-leaving", forward ? "to-left" : "to-right");
      leaveTimers.push(setTimeout(function () {
        out.classList.remove("is-leaving", "to-left", "to-right");
      }, TRANSITION_MS));
    }

    slides.forEach(function (s, i) {
      var active = i === index;
      s.classList.toggle("is-active", active);
      s.setAttribute("aria-hidden", active ? "false" : "true");
    });

    stage.dataset.theme = slides[index].dataset.theme || "light";
    currentEl.textContent = pad(index + 1);
    progressBar.style.width = ((index + 1) / total) * 100 + "%";
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === total - 1;

    var hash = "#" + (index + 1);
    if (window.location.hash !== hash) {
      history.replaceState(null, "", hash);
    }

    if (prev !== -1 && !hasNavigated) {
      hasNavigated = true;
      if (hint) hint.classList.add("is-dismissed");
    }

    slides[index].scrollTop = 0;
    if (prev !== -1) slides[prev].dispatchEvent(new CustomEvent("slide:leave"));
    slides[index].dispatchEvent(new CustomEvent("slide:enter"));
  }

  function next() { goTo(index + 1); }
  function prev() { goTo(index - 1); }

  /* ---------- Keyboard ---------- */
  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    // While the full-screen menu is open, keys scroll it or close it; they never change slides
    if (stage.classList.contains("is-menu-open")) {
      if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
      return;
    }

    // Let a keyboard-focused button handle its own Enter/Space
    var onButton = e.target.closest && e.target.closest("button, a");
    if (onButton && (e.key === "Enter" || e.key === " ")) return;

    switch (e.key) {
      case " ":
      case "Spacebar":
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case "Enter":
        e.preventDefault();
        next();
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
      case "Backspace":
        e.preventDefault();
        prev();
        break;
      case "Home":
        e.preventDefault();
        goTo(0);
        break;
      case "End":
        e.preventDefault();
        goTo(total - 1);
        break;
      case "m":
      case "M":
        e.preventDefault();
        toggleMusic();
        break;
      case "f":
      case "F":
        e.preventDefault();
        toggleFullscreen();
        break;
      case "Escape":
        if (fullscreenElement()) exitFullscreen();
        break;
    }
  });

  /* ---------- Mouse click ---------- */
  stage.addEventListener("click", function (e) {
    if (e.button !== 0 || stage.classList.contains("is-dragging")) return;
    if (e.target.closest("button, a, input, select, textarea, .controls, [data-no-advance]")) return;
    next();
  });

  // Keep focus off buttons after mouse clicks so Space/Enter always advance
  Array.prototype.forEach.call(stage.querySelectorAll(".ctrl"), function (b) {
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
  });

  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);
  fsBtn.addEventListener("click", toggleFullscreen);

  /* ---------- Mouse wheel: one slide per gesture ---------- */
  var wheelLocked = false;
  var lastWheelAt = 0;
  var lastNavAt = 0;
  var lastInnerScrollAt = 0;

  function tryUnlockWheel() {
    var now = Date.now();
    // Stay locked until the cooldown has passed AND trackpad inertia has settled
    if (now - lastNavAt >= WHEEL_COOLDOWN_MS && now - lastWheelAt >= 180) {
      wheelLocked = false;
    } else {
      setTimeout(tryUnlockWheel, 60);
    }
  }

  function canScroll(el, dy) {
    if (!el || el.scrollHeight <= el.clientHeight + 1) return false;
    return dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0;
  }

  window.addEventListener("wheel", function (e) {
    // The open menu overlay scrolls natively
    if (stage.classList.contains("is-menu-open")) return;
    // A slide that scrolls internally (stacked portrait layouts) scrolls first
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && canScroll(slides[index], e.deltaY) &&
        Date.now() - lastNavAt > WHEEL_COOLDOWN_MS) {
      lastInnerScrollAt = Date.now();
      return;
    }
    // Reaching the end of an inner scroll doesn't flip the slide on the same
    // gesture; momentum has to settle and a fresh scroll moves on
    if (Date.now() - lastInnerScrollAt < 450) {
      e.preventDefault();
      lastInnerScrollAt = Date.now();
      return;
    }
    // Sideways scrolling inside a horizontal row (e.g. mobile texture strip)
    var row = e.target.closest && e.target.closest("[data-no-swipe]");
    if (row && Math.abs(e.deltaX) > Math.abs(e.deltaY) && row.scrollWidth > row.clientWidth + 1) {
      return;
    }
    e.preventDefault();
    lastWheelAt = Date.now();
    if (wheelLocked || stage.classList.contains("is-dragging")) return;

    var delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(delta) < 8) return;

    wheelLocked = true;
    lastNavAt = Date.now();
    if (delta > 0) next(); else prev();
    setTimeout(tryUnlockWheel, WHEEL_COOLDOWN_MS);
  }, { passive: false });

  /* ---------- Touch swipe ---------- */
  var touchX = 0, touchY = 0, touchT = 0, touching = false;

  stage.addEventListener("touchstart", function (e) {
    // Horizontal scroll rows handle their own sideways drags; the menu overlay is modal
    if (e.touches.length !== 1 || stage.classList.contains("is-menu-open") || (e.target.closest && e.target.closest("[data-no-swipe]"))) {
      touching = false;
      return;
    }
    touching = true;
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
    touchT = Date.now();
    wake();
  }, { passive: true });

  stage.addEventListener("touchend", function (e) {
    if (!touching) return;
    touching = false;
    var t = e.changedTouches[0];
    var dx = t.clientX - touchX;
    var dy = t.clientY - touchY;
    if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.2 && Date.now() - touchT < 800) {
      if (dx < 0) next(); else prev();
    }
  }, { passive: true });

  /* ---------- Fullscreen ---------- */
  var root = document.documentElement;
  var fsSupported = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  if (!fsSupported) fsBtn.hidden = true;

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function exitFullscreen() {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  }

  function toggleFullscreen() {
    if (!fsSupported) return;
    if (fullscreenElement()) {
      exitFullscreen();
    } else if (root.requestFullscreen) {
      root.requestFullscreen().catch(function () {});
    } else {
      root.webkitRequestFullscreen();
    }
  }

  function onFsChange() {
    var on = !!fullscreenElement();
    stage.classList.toggle("is-fullscreen", on);
    fsBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Enter fullscreen");
  }
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);

  /* ---------- Presenter chrome auto-hide ---------- */
  var idleTimer = null;

  function wake() {
    stage.classList.remove("is-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      stage.classList.add("is-idle");
    }, IDLE_MS);
  }

  document.addEventListener("mousemove", wake, { passive: true });
  document.addEventListener("mousedown", wake, { passive: true });

  /* ---------- URL hash ---------- */
  window.addEventListener("hashchange", function () {
    goTo(indexFromHash());
    // Out-of-range links (e.g. #12) settle on the nearest slide; show its real number
    var hash = "#" + (index + 1);
    if (window.location.hash !== hash) history.replaceState(null, "", hash);
  });

  /* ---------- Before / after comparison (any .ba card) ----------
     data-intro-delay (ms) sets when the one-off divider sweep starts after
     the slide appears. */
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var initBeforeAfter = function (ba) {
    var introDelay = parseInt(ba.getAttribute("data-intro-delay"), 10) || 1350;
    var baHandle = ba.querySelector(".ba__handle");
    var baSlide = ba.closest(".slide");
    var baPos = 50;
    var baDragging = false;
    var baIntro = null;

    var setPos = function (p) {
      baPos = Math.max(0, Math.min(100, p));
      ba.style.setProperty("--pos", baPos + "%");
      baHandle.setAttribute("aria-valuenow", String(Math.round(baPos)));
    };

    var stopIntro = function () {
      if (baIntro) { baIntro.cancelled = true; baIntro = null; }
    };

    var posFromEvent = function (e) {
      var r = ba.getBoundingClientRect();
      return ((e.clientX - r.left) / r.width) * 100;
    };

    var endDrag = function () {
      if (!baDragging) return;
      baDragging = false;
      ba.classList.remove("is-dragging");
      // Released after the click event fires, so no slide change slips through
      setTimeout(function () { stage.classList.remove("is-dragging"); }, 0);
    };

    ba.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      stopIntro();
      baDragging = true;
      ba.classList.add("is-dragging");
      stage.classList.add("is-dragging");
      try { ba.setPointerCapture(e.pointerId); } catch (err) {}
      setPos(posFromEvent(e));
    });
    ba.addEventListener("pointermove", function (e) {
      if (baDragging) setPos(posFromEvent(e));
    });
    ba.addEventListener("pointerup", endDrag);
    ba.addEventListener("pointercancel", endDrag);
    ba.addEventListener("lostpointercapture", endDrag);

    // Keep drags on the card away from the deck's swipe and focus handling
    ba.addEventListener("mousedown", function (e) { e.preventDefault(); });
    ["touchstart", "touchmove", "touchend"].forEach(function (t) {
      ba.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true });
    });

    baHandle.addEventListener("keydown", function (e) {
      var step = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5 }[e.key];
      if (step === undefined && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      e.stopPropagation();
      stopIntro();
      if (e.key === "Home") setPos(0);
      else if (e.key === "End") setPos(100);
      else setPos(baPos + step);
    });

    var tween = function (job, from, to, ms, ease, done) {
      var t0 = null;
      var frame = function (now) {
        if (job.cancelled) return;
        if (t0 === null) t0 = now;
        var k = Math.min(1, (now - t0) / ms);
        setPos(from + (to - from) * ease(k));
        if (k < 1) requestAnimationFrame(frame); else if (done) done();
      };
      requestAnimationFrame(frame);
    };
    var easeInOut = function (k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
    var easeOut = function (k) { return 1 - Math.pow(1 - k, 3); };

    // Play once per visit: far left, sweep to far right, settle in the middle
    baSlide.addEventListener("slide:enter", function () {
      stopIntro();
      // data-no-intro: sliders in hidden tabs just sit at the middle
      if (reduceMotion || ba.hasAttribute("data-no-intro")) { setPos(50); return; }
      setPos(0);
      var job = { cancelled: false };
      baIntro = job;
      setTimeout(function () {
        if (job.cancelled) return;
        tween(job, 0, 100, 1100, easeInOut, function () {
          tween(job, 100, 50, 800, easeOut, function () { if (baIntro === job) baIntro = null; });
        });
      }, introDelay);
    });

    baSlide.addEventListener("slide:leave", function () {
      stopIntro();
      endDrag();
    });
  };

  Array.prototype.forEach.call(document.querySelectorAll(".ba"), initBeforeAfter);

  /* ---------- Day / night toggle for a comparison card (slide 5) ---------- */
  Array.prototype.forEach.call(document.querySelectorAll(".daynight"), function (group) {
    var target = document.getElementById(group.getAttribute("data-target"));
    var buttons = group.querySelectorAll(".daynight__btn");
    if (!target) return;

    var setMode = function (mode) {
      target.classList.toggle("is-night", mode === "night");
      Array.prototype.forEach.call(buttons, function (b) {
        var on = b.getAttribute("data-mode") === mode;
        b.classList.toggle("is-selected", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    };

    Array.prototype.forEach.call(buttons, function (b) {
      b.addEventListener("click", function () { setMode(b.getAttribute("data-mode")); });
      // Mouse clicks shouldn't leave focus here, so Space keeps advancing slides
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
    });
    ["touchstart", "touchend"].forEach(function (t) {
      group.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true });
    });

    // Each visit opens on the daytime render
    group.closest(".slide").addEventListener("slide:leave", function () {
      setTimeout(function () { setMode("day"); }, TRANSITION_MS);
    });
  });

  /* ---------- Menu concept (slide 6): page toggle + full-screen overlay ---------- */
  var menuOverlay = document.getElementById("menuOverlay");
  var menuOpenBtn = document.getElementById("menuOpen");
  var menuSpread = document.getElementById("menuSpread");

  function openMenu() {
    if (!menuOverlay) return;
    var holder = menuOverlay.querySelector(".menu-overlay__pages");
    if (!holder.children.length) {
      Array.prototype.forEach.call(menuSpread.querySelectorAll(".menu-page"), function (pg) {
        var copy = pg.cloneNode(true);
        copy.removeAttribute("style");
        holder.appendChild(copy);
      });
    }
    menuOverlay.querySelector(".menu-overlay__scroll").scrollTop = 0;
    menuOverlay.classList.add("is-open");
    menuOverlay.setAttribute("aria-hidden", "false");
    stage.classList.add("is-menu-open");
    // Focus the scroller (not Close) so Space and arrow keys scroll the menu
    menuOverlay.querySelector(".menu-overlay__scroll").focus({ preventScroll: true });
  }

  function closeMenu() {
    if (!menuOverlay || !menuOverlay.classList.contains("is-open")) return;
    menuOverlay.classList.remove("is-open");
    menuOverlay.setAttribute("aria-hidden", "true");
    stage.classList.remove("is-menu-open");
    // Hand focus back to the page so Space and arrows drive the deck again
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  if (menuOverlay && menuOpenBtn && menuSpread) {
    menuOpenBtn.addEventListener("click", openMenu);
    menuOpenBtn.addEventListener("mousedown", function (e) { e.preventDefault(); });
    menuOverlay.querySelector(".menu-overlay__close").addEventListener("click", closeMenu);
    // Clicking the sand around the pages also closes it
    menuOverlay.addEventListener("click", function (e) {
      if (!e.target.closest(".menu-page") && !e.target.closest(".menu-overlay__close")) closeMenu();
    });
    menuSpread.closest(".slide").addEventListener("slide:leave", closeMenu);

    // Mobile: show one page at a time
    var menuToggle = menuSpread.closest(".slide").querySelector(".mc__toggle");
    if (menuToggle) {
      Array.prototype.forEach.call(menuToggle.querySelectorAll(".mc__toggle-btn"), function (b) {
        b.addEventListener("mousedown", function (e) { e.preventDefault(); });
        b.addEventListener("click", function () {
          var pageName = b.getAttribute("data-page");
          menuSpread.setAttribute("data-page", pageName);
          Array.prototype.forEach.call(menuToggle.querySelectorAll(".mc__toggle-btn"), function (o) {
            var on = o === b;
            o.classList.toggle("is-selected", on);
            o.setAttribute("aria-pressed", on ? "true" : "false");
          });
        });
      });
      ["touchstart", "touchend"].forEach(function (t) {
        menuToggle.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true });
      });
    }
  }

  /* ---------- The layout (slide 7): plan zones <-> zone cards ---------- */
  var layoutSlide = document.querySelector(".slide--layout");
  if (layoutSlide) {
    var zoneEls = layoutSlide.querySelectorAll("[data-zone]");
    var setHot = function (zone) {
      Array.prototype.forEach.call(zoneEls, function (el) {
        el.classList.toggle("is-hot", !!zone && el.getAttribute("data-zone") === zone);
      });
    };
    Array.prototype.forEach.call(zoneEls, function (el) {
      var zone = el.getAttribute("data-zone");
      el.addEventListener("pointerenter", function (e) { if (e.pointerType !== "touch") setHot(zone); });
      el.addEventListener("pointerleave", function (e) { if (e.pointerType !== "touch") setHot(null); });
      el.addEventListener("focus", function () { setHot(zone); });
      el.addEventListener("blur", function () { setHot(null); });
      // Taps highlight a zone on touch screens (the containers are data-no-advance)
      el.addEventListener("click", function () { setHot(zone); });
    });
    layoutSlide.addEventListener("slide:leave", function () { setHot(null); });
  }

  /* ---------- Tabbed gallery (slide 8) ---------- */
  var restSlide = document.querySelector(".slide--rest");
  if (restSlide) {
    var restTabs = restSlide.querySelectorAll(".rs-tab");
    var restPanels = restSlide.querySelectorAll(".rs-panel");

    var showPanel = function (key) {
      Array.prototype.forEach.call(restTabs, function (t) {
        var on = t.getAttribute("data-panel") === key;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.setAttribute("tabindex", on ? "0" : "-1");
        if (on && t.scrollIntoView && restSlide.scrollHeight > restSlide.clientHeight) {
          // keep the active tab visible in the sideways-scrolling row on phones
          t.parentNode.scrollTo({ left: t.offsetLeft - t.parentNode.clientWidth / 2 + t.clientWidth / 2, behavior: "smooth" });
        }
      });
      Array.prototype.forEach.call(restPanels, function (pnl) {
        var on = pnl.id === "rs-panel-" + key;
        pnl.classList.toggle("is-active", on);
        pnl.setAttribute("aria-hidden", on ? "false" : "true");
      });
    };

    Array.prototype.forEach.call(restTabs, function (t) {
      t.addEventListener("click", function () { showPanel(t.getAttribute("data-panel")); });
      // Mouse clicks don't keep focus, so Space and arrows still drive the deck
      t.addEventListener("mousedown", function (e) { e.preventDefault(); });
    });

    // Each visit opens on the first tab
    restSlide.addEventListener("slide:leave", function () {
      setTimeout(function () { showPanel(restTabs[0].getAttribute("data-panel")); }, TRANSITION_MS);
    });
  }

  /* ---------- Background music ----------
     Browsers block sound until the viewer interacts, so the track fades in
     on the presenter's first key, click or tap. The speaker button and the
     M key toggle it. If the audio file is missing, the button is hidden. */
  var music = document.getElementById("bgMusic");
  var musicBtn = document.getElementById("musicBtn");
  var MUSIC_VOLUME = 0.32;
  var musicWanted = true;
  var musicFade = null;

  function fadeMusic(to, ms, done) {
    clearInterval(musicFade);
    var from = music.volume;
    var t0 = Date.now();
    musicFade = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / ms);
      music.volume = Math.max(0, Math.min(1, from + (to - from) * k));
      if (k >= 1) { clearInterval(musicFade); if (done) done(); }
    }, 40);
  }

  function setMusicUi(on) {
    stage.classList.toggle("is-music-on", on);
    if (musicBtn) {
      musicBtn.setAttribute("aria-pressed", on ? "true" : "false");
      musicBtn.setAttribute("aria-label", on ? "Pause background music" : "Play background music");
    }
  }

  function playMusic() {
    if (!music || musicBtn.hidden) return;
    if (!music.paused) return;
    music.volume = 0;
    var p = music.play();
    if (p && p.then) {
      p.then(function () { setMusicUi(true); fadeMusic(MUSIC_VOLUME, 2500); }).catch(function () {});
    }
  }

  function pauseMusic() {
    if (!music || music.paused) return;
    setMusicUi(false);
    fadeMusic(0, 700, function () { music.pause(); });
  }

  function toggleMusic() {
    if (!music || musicBtn.hidden) return;
    musicWanted = music.paused;
    if (musicWanted) playMusic(); else pauseMusic();
  }

  if (music && musicBtn) {
    music.addEventListener("error", function () { musicBtn.hidden = true; });
    if (music.error) musicBtn.hidden = true;
    musicBtn.addEventListener("click", toggleMusic);
    musicBtn.addEventListener("mousedown", function (e) { e.preventDefault(); });
    // First interaction anywhere starts the track (unless it was switched off)
    var firstGesture = function (e) {
      if (e.target && e.target.closest && e.target.closest("#musicBtn")) return;
      if (musicWanted) playMusic();
      ["keydown", "pointerdown", "touchstart"].forEach(function (t) {
        document.removeEventListener(t, firstGesture, true);
      });
    };
    ["keydown", "pointerdown", "touchstart"].forEach(function (t) {
      document.addEventListener(t, firstGesture, true);
    });
  }

  /* ---------- Init ---------- */
  totalEl.textContent = pad(total);
  goTo(indexFromHash(), { instant: true });
  if (index !== 0) {
    hasNavigated = true;
    if (hint) hint.classList.add("is-dismissed");
  }
  wake();
})();
