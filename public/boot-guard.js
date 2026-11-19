// The server puts a plain-text copy of public pages in #root (.seo-pre, scripts/prerender.mjs) for crawlers that do
// not run JavaScript. Visitors never see that bare text: while the app downloads (slow mobile data can
// take a while) index.html shows a loading screen (#boot), and main.tsx removes it once the app starts.
// If an app file fails to download (a deploy switching over, a flaky connection), reload once; only if
// that also fails show a message with a Reload button above the page text. After 15 s with nothing, the
// loading screen offers a Reload button too. Runs before the app and outside the bundle, so it works even
// when the bundle is missing; separate file because the CSP forbids inline scripts.
(function () {
  var d = document.documentElement;
  d.classList.add("js");
  function failed() {
    if (window.__appMounted) return;
    var k = "dash-boot-retry", last = 0, canStore = true;
    try { last = Number(sessionStorage.getItem(k) || 0); } catch (e) { canStore = false; }
    if (canStore && Date.now() - last > 60000) {
      try { sessionStorage.setItem(k, String(Date.now())); } catch (e) {}
      setTimeout(function () { location.reload(); }, 1500);
      return;
    }
    d.classList.add("boot-failed");
  }
  window.__bootFailed = failed;
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && (t.tagName === "SCRIPT" || t.tagName === "LINK") && /\/assets\//.test(t.src || t.href || "")) failed();
  }, true);
  document.addEventListener("click", function (e) {
    if (e.target && e.target.closest && e.target.closest("[data-boot-reload]")) location.reload();
  });
  setTimeout(function () { if (!window.__appMounted) d.classList.add("boot-slow"); }, 15000);
})();

// A shop's own address: the server writes the shop's name and icon into the
// page (meta jmsurf-brand). The offline copy kept by the service worker is the
// plain JMSURF page, so remember the shop here and re-apply it from memory,
// before the app starts, so the shop never flashes as JMSURF POS.
(function () {
  try {
    var host = location.hostname;
    if (host === "jmsurfpos.co.ke" || host === "www.jmsurfpos.co.ke" || host === "localhost") return;
    var key = "jmsurf_brand:" + host;
    var meta = document.querySelector('meta[name="jmsurf-brand"]');
    if (meta) { localStorage.setItem(key, meta.content); return; }
    var b = JSON.parse(localStorage.getItem(key) || "null");
    if (!b || !b.slug) return;
    var head = document.head;
    var add = function (tag, attrs) { var el = document.createElement(tag); for (var k in attrs) el.setAttribute(k, attrs[k]); head.appendChild(el); return el; };
    // Custom domains need the shop's slug before the app starts.
    if (!/\.jmsurfpos\.co\.ke$/.test(host)) add("meta", { name: "jmsurf-shop", content: b.slug });
    add("meta", { name: "jmsurf-brand", content: JSON.stringify(b) });
    var apply = function () {
      document.title = b.title || b.name;
      var links = head.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"],link[rel="manifest"]');
      for (var i = 0; i < links.length; i++) links[i].parentNode.removeChild(links[i]);
      add("link", { rel: "icon", type: "image/png", href: "/shop-brand/icon-64.png?v=" + b.v + "-s3" });
      add("link", { rel: "apple-touch-icon", href: "/shop-brand/icon-192.png?v=" + b.v + "-s3" });
      add("link", { rel: "manifest", href: "/shop-brand/manifest.webmanifest?v=" + b.v });
      var tc = head.querySelector('meta[name="theme-color"]');
      if (tc && b.color) tc.setAttribute("content", b.color);
      // Loading screen (index.html #boot): the shop's own logo and colour.
      var bl = document.getElementById("boot-logo");
      if (bl) { bl.setAttribute("src", "/shop-brand/icon-192.png?v=" + b.v + "-s3"); bl.setAttribute("alt", b.name); }
      var bt = document.getElementById("boot");
      if (bt && b.color) bt.style.setProperty("--boot-c", b.color);
    };
    // The rest of <head> is still being read; apply once it is, before the app runs.
    if (document.readyState === "loading") document.addEventListener("readystatechange", function once() {
      if (document.readyState !== "loading") { document.removeEventListener("readystatechange", once); apply(); }
    });
    else apply();
  } catch (_) { /* storage blocked: the app sets the name a moment later */ }
})();
