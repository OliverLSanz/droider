/* Droider website behaviour: DROID code highlighting, copy buttons, navigation,
   the video tour, scroll reveal and the guide's sidebar. No tracking. */
(function () {
  "use strict";

  /* ---------- DROID highlighter (same colours as the extension) ---------- */
  var OUTPUTS = window.DROID_OUTPUTS || {};
  var REGISTER = /^(?:[IONGRX]\d+(?:\.\d+)?|[PBLSER]\d+\.\d+)$/;
  var NUMBER = /^-?\d+(?:\.\d+)?(?:V|%)?$/;

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function cableColor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return hslToHex(h % 360, 70, 62);
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var a = s * Math.min(l, 1 - l);
    function f(n) {
      var k = (n + h / 30) % 12;
      var v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * v).toString(16).padStart(2, "0");
    }
    return "#" + f(0) + f(8) + f(4);
  }
  function span(cls, text) { return '<span class="' + cls + '">' + esc(text) + "</span>"; }

  // Ports of megacircuits used on the page: data-mega="pluck:pitch,gate,env;mix2:out"
  function parseMega(attr) {
    var map = {};
    (attr || "").split(";").forEach(function (part) {
      var bits = part.split(":");
      if (bits[0]) map[bits[0].trim()] = (bits[1] || "").split(",").map(function (s) { return s.trim(); });
    });
    return map;
  }

  function highlightValue(value, ports) {
    var out = "";
    var re = /("[^"]*")|(~~[^~]+~~)|([A-Za-z_][A-Za-z0-9_.]*|-?\d+(?:\.\d+)?(?:V|%)?)|(\s+)|(.)/g;
    var m;
    while ((m = re.exec(value))) {
      if (m[1]) out += span("tk-text", m[1]);
      else if (m[2]) out += '<span class="tk-err">' + highlightValue(m[2].slice(2, -2), ports) + "</span>";
      else if (m[3]) {
        var t = m[3];
        if (t[0] === "_") out += '<span style="color:' + cableColor(t) + '">' + esc(t) + "</span>";
        else if (t === "on" || t === "off") out += span("tk-bool", t);
        else if (REGISTER.test(t)) out += span("tk-register", t);
        else if (NUMBER.test(t)) out += span("tk-num", t);
        else if (ports && ports.indexOf(t) >= 0) out += span("tk-port", t);
        else out += esc(t);
      } else out += esc(m[4] || m[5]);
    }
    return out;
  }

  function highlight(code, mega) {
    var circuit = null;
    var section = null; // "input" / "output" inside a .blueprint
    var ports = [];
    // Blueprint port names, so the body can show them as ports.
    var sec = null;
    code.split("\n").forEach(function (line) {
      var h = /^\s*\[([a-z0-9]+)\]/.exec(line);
      if (h) { sec = h[1]; return; }
      if (sec === "input" || sec === "output") {
        var p = /^\s*([a-z][a-z0-9_]*)/.exec(line);
        if (p && line.trim()[0] !== "#") ports.push(p[1]);
      }
    });

    return code.split("\n").map(function (line) {
      var hash = -1, inQ = false;
      for (var i = 0; i < line.length; i++) {
        if (line[i] === '"') inQ = !inQ;
        if (line[i] === "#" && !inQ) { hash = i; break; }
      }
      var body = hash >= 0 ? line.slice(0, hash) : line;
      var comment = hash >= 0 ? span("tk-comment", line.slice(hash)) : "";

      var hm = /^(\s*)\[([a-z0-9]+)(\]?)(.*)$/.exec(body);
      if (hm) {
        circuit = hm[2];
        section = circuit === "input" || circuit === "output" ? circuit : null;
        var cls = mega[circuit] || section ? "tk-mega" : "tk-header";
        return esc(hm[1]) + span("tk-bracket", "[") + span(cls, hm[2]) + (hm[3] ? span("tk-bracket", "]") : "") + esc(hm[4]) + comment;
      }
      var pm = /^(\s*)([A-Za-z][A-Za-z0-9_]*)(\s*)(=?)(.*)$/.exec(body);
      if (pm && (pm[4] || section)) {
        var name = pm[2];
        var role;
        if (section) role = section === "output" ? "tk-output" : "tk-input";
        else {
          var outs = (mega[circuit] || OUTPUTS[circuit] || []);
          var base = name.replace(/\d+$/, "");
          role = outs.indexOf(name) >= 0 || outs.indexOf(base) >= 0 ? "tk-output" : "tk-input";
        }
        return esc(pm[1]) + span(role, name) + esc(pm[3]) + esc(pm[4]) + highlightValue(pm[5], ports) + comment;
      }
      return highlightValue(body, ports) + comment;
    }).join("\n");
  }

  document.querySelectorAll("pre[data-droid]").forEach(function (pre) {
    var mega = parseMega(pre.getAttribute("data-mega"));
    pre.innerHTML = highlight(pre.textContent.replace(/^\n/, "").replace(/\s+$/, ""), mega);
  });

  /* ---------- Copy buttons ---------- */
  document.querySelectorAll(".code").forEach(function (box) {
    var title = box.querySelector(".code-title");
    var pre = box.querySelector("pre");
    if (!title || !pre || box.hasAttribute("data-nocopy")) return;
    var b = document.createElement("button");
    b.className = "copy";
    b.type = "button";
    b.textContent = "Copy";
    b.addEventListener("click", function () {
      var text = pre.textContent.replace(/~~/g, "");
      var done = function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1400); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
    });
    title.appendChild(b);
  });

  /* ---------- Mobile navigation ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) { if (e.target.tagName === "A") links.classList.remove("open"); });
  }

  /* ---------- Reveal on scroll ---------- */
  var revealed = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    revealed.forEach(function (el) { io.observe(el); });
  } else revealed.forEach(function (el) { el.classList.add("in"); });

  /* ---------- Video tour ---------- */
  document.querySelectorAll("[data-tour]").forEach(function (box) {
    var video = box.querySelector("video");
    var play = box.querySelector(".tour-play");
    if (!video || !play) return;
    video.removeAttribute("controls");
    play.hidden = false;
    play.addEventListener("click", function () {
      play.hidden = true;
      video.setAttribute("controls", "");
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
    });
  });

  /* ---------- OS tabs (pre-select the visitor's platform) ---------- */
  var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
  var os = /win/i.test(platform) ? "windows" : /mac|iphone|ipad/i.test(platform) ? "macos" : /linux|x11/i.test(platform) ? "linux" : "macos";
  document.querySelectorAll(".os-tabs").forEach(function (tabs) {
    var buttons = tabs.querySelectorAll('[role="tab"]');
    var panels = tabs.querySelectorAll('[role="tabpanel"]');
    function select(id) {
      buttons.forEach(function (b) { b.setAttribute("aria-selected", b.dataset.os === id ? "true" : "false"); });
      panels.forEach(function (p) { p.hidden = p.dataset.os !== id; });
    }
    buttons.forEach(function (b) { b.addEventListener("click", function () { select(b.dataset.os); }); });
    select(tabs.querySelector('[data-os="' + os + '"]') ? os : buttons[0].dataset.os);
  });

  /* ---------- Guide: sidebar, scrollspy and filter ---------- */
  var nav = document.querySelector(".docs-nav");
  if (nav) {
    var menuBtn = document.querySelector(".docs-menu-btn");
    if (menuBtn) {
      menuBtn.addEventListener("click", function () { nav.classList.toggle("open"); });
      nav.addEventListener("click", function (e) { if (e.target.tagName === "A") nav.classList.remove("open"); });
    }
    var navLinks = Array.prototype.slice.call(nav.querySelectorAll("a[href^='#']"));
    var targets = navLinks.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
    var current = null;
    function spy() {
      var y = window.scrollY + 120;
      var idx = 0;
      for (var i = 0; i < targets.length; i++) if (targets[i] && targets[i].offsetTop <= y) idx = i;
      if (current !== idx) {
        current = idx;
        navLinks.forEach(function (a, i) { a.classList.toggle("active", i === idx); });
        var active = navLinks[idx];
        if (active && nav.scrollHeight > nav.clientHeight) {
          var r = active.getBoundingClientRect(), nr = nav.getBoundingClientRect();
          if (r.top < nr.top + 40 || r.bottom > nr.bottom - 40) nav.scrollTop += r.top - nr.top - nr.height / 2;
        }
      }
    }
    window.addEventListener("scroll", spy, { passive: true });
    spy();

    var search = nav.querySelector(".docs-search");
    var none = nav.querySelector(".no-results");
    if (search) {
      // Index each section's text once.
      var index = navLinks.map(function (a, i) {
        var t = targets[i];
        return ((a.textContent || "") + " " + (t ? t.textContent : "")).toLowerCase();
      });
      search.addEventListener("input", function () {
        var q = search.value.trim().toLowerCase();
        var any = false;
        navLinks.forEach(function (a, i) {
          var hit = !q || q.split(/\s+/).every(function (w) { return index[i].indexOf(w) >= 0; });
          a.hidden = !hit;
          any = any || hit;
        });
        nav.querySelectorAll(".docs-group").forEach(function (g) {
          g.hidden = !Array.prototype.some.call(g.querySelectorAll("a"), function (a) { return !a.hidden; });
        });
        if (none) none.style.display = any ? "none" : "block";
      });
    }
  }
})();
