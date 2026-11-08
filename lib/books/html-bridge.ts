/**
 * The reader bridge injected into every self-contained HTML book.
 *
 * The book runs in a sandboxed iframe with an opaque origin (no allow-same-origin), so the reader
 * cannot touch its DOM and the book cannot touch the app. Everything the reader needs -- the table
 * of contents, where the learner is, what they selected, applying themes and highlights -- goes
 * through postMessage, and this script is the book-side half of that conversation.
 *
 * Book -> reader (posted to window.parent, tagged source: 'book-html'):
 *   { type: 'ready', headings: [{ id, title, level }] }
 *   { type: 'position', anchor, scroll }               scroll is 0..1 of the page height
 *   { type: 'selection', text, start, end, anchor }    start/end are body text offsets
 * Reader -> book (tagged source: 'book-reader'; accepted only from window.parent):
 *   { type: 'goto', anchor } | { type: 'scrollTo', scroll }
 *   { type: 'theme', theme: 'light' | 'sepia' | 'dark', fontScale }
 *   { type: 'highlights', items: [{ id, start, end, color }] }
 *
 * The reader side checks event.source === iframe.contentWindow (the origin is "null", so origin
 * checks are meaningless). Chapters are <section data-chapter id> elements, falling back to h1/h2
 * with ids -- the admin editor must pre-fill chapters by the same rule.
 *
 * Kept as dependency-free ES2017 in a string: it is served inside the book, not bundled.
 */
export const HTML_BRIDGE_SCRIPT = String.raw`
(function () {
  if (window.__bookBridge) return;
  window.__bookBridge = true;
  var parentWin = window.parent;
  function post(msg) { msg.source = 'book-html'; try { parentWin.postMessage(msg, '*'); } catch (e) {} }

  function chapterEls() {
    var s = document.querySelectorAll('section[data-chapter][id]');
    if (s.length) return Array.prototype.slice.call(s);
    return Array.prototype.slice.call(document.querySelectorAll('h1[id], h2[id]'));
  }
  function headings() {
    return chapterEls().map(function (el) {
      var h = el.matches('section') ? el.querySelector('h1, h2, h3') : el;
      var title = (el.getAttribute('data-chapter') || (h && h.textContent) || el.id || '').trim();
      var level = h && /^H[1-6]$/.test(h.tagName) ? Number(h.tagName.slice(1)) : 1;
      return { id: el.id, title: title.slice(0, 200), level: level };
    });
  }
  function currentAnchor() {
    var els = chapterEls(), best = null;
    for (var i = 0; i < els.length; i++) {
      if (els[i].getBoundingClientRect().top <= window.innerHeight * 0.3) best = els[i].id; else break;
    }
    return best;
  }
  function scrollFraction() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  }

  // Text offsets over document.body, so a highlight survives a re-render of the same file.
  function walker() { return document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null); }
  // Text offset of a boundary point, whether it sits in a text node or on an element (a selection
  // made by triple-click or ending at a block edge does the latter). A range from the start of the
  // body to the point stringifies to exactly the text nodes before it, in tree order: the same
  // count pointAt() walks back over.
  function offsetOf(node, offset) {
    if (!node || !document.body.contains(node)) return -1;
    try {
      var r = document.createRange();
      r.setStart(document.body, 0);
      r.setEnd(node, offset);
      return r.toString().length;
    } catch (e) {
      return -1;
    }
  }
  function pointAt(target) {
    var w = walker(), total = 0, n;
    while ((n = w.nextNode())) {
      var len = n.nodeValue.length;
      if (total + len >= target) return { node: n, offset: target - total };
      total += len;
    }
    return null;
  }

  var marks = [];
  function clearMarks() {
    marks.forEach(function (m) {
      var p = m.parentNode; if (!p) return;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m); p.normalize();
    });
    marks = [];
  }
  var COLORS = { yellow: 'rgba(255,214,0,0.35)', green: 'rgba(0,200,120,0.3)', blue: 'rgba(0,140,255,0.25)', pink: 'rgba(255,80,160,0.25)' };
  function applyHighlights(items) {
    clearMarks();
    (items || []).forEach(function (h) {
      if (typeof h.start !== 'number' || typeof h.end !== 'number' || h.end <= h.start) return;
      var a = pointAt(h.start), b = pointAt(h.end);
      if (!a || !b) return;
      // Wrap text node by text node so a highlight may cross element boundaries.
      var w = walker(), n, inRange = false, nodes = [];
      while ((n = w.nextNode())) {
        if (n === a.node) inRange = true;
        if (inRange) nodes.push(n);
        if (n === b.node) break;
      }
      nodes.forEach(function (node) {
        var s = node === a.node ? a.offset : 0;
        var e = node === b.node ? b.offset : node.nodeValue.length;
        if (e <= s) return;
        var r = document.createRange();
        r.setStart(node, s); r.setEnd(node, e);
        var m = document.createElement('mark');
        m.setAttribute('data-book-highlight', String(h.id || ''));
        m.style.background = COLORS[h.color] || COLORS.yellow;
        m.style.color = 'inherit';
        try { r.surroundContents(m); marks.push(m); } catch (err) {}
      });
    });
  }

  var style = document.createElement('style');
  style.textContent =
    ':where(html[data-reader-theme="sepia"]) { background: #f4ecd8; color: #3b2f1e; }' +
    ':where(html[data-reader-theme="dark"]) { background: #121212; color: #e6e6e6; }';
  (document.head || document.documentElement).appendChild(style);

  window.addEventListener('message', function (event) {
    if (event.source !== parentWin) return;
    var d = event.data;
    if (!d || d.source !== 'book-reader') return;
    if (d.type === 'goto' && typeof d.anchor === 'string') {
      var el = document.getElementById(d.anchor);
      if (el) el.scrollIntoView();
    } else if (d.type === 'scrollTo' && typeof d.scroll === 'number') {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.max(0, max * d.scroll));
    } else if (d.type === 'theme') {
      document.documentElement.setAttribute('data-reader-theme', d.theme === 'dark' || d.theme === 'sepia' ? d.theme : 'light');
      var scale = typeof d.fontScale === 'number' && d.fontScale >= 0.75 && d.fontScale <= 2 ? d.fontScale : 1;
      document.documentElement.style.fontSize = (scale * 100) + '%';
    } else if (d.type === 'highlights') {
      applyHighlights(d.items);
    }
  });

  var timer = null;
  window.addEventListener('scroll', function () {
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      post({ type: 'position', anchor: currentAnchor(), scroll: scrollFraction() });
    }, 400);
  }, { passive: true });

  document.addEventListener('mouseup', reportSelection);
  document.addEventListener('touchend', reportSelection);
  function reportSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    var r = sel.getRangeAt(0);
    var start = offsetOf(r.startContainer, r.startOffset);
    var end = offsetOf(r.endContainer, r.endOffset);
    if (start < 0 || end <= start) return;
    post({ type: 'selection', text: sel.toString().slice(0, 5000), start: start, end: end, anchor: currentAnchor() });
  }

  function ready() { post({ type: 'ready', headings: headings() }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
`;

/**
 * Put the bridge into a book's HTML. Placed at the end of <body> when there is one, so the
 * book's own markup exists when it runs; otherwise appended.
 */
export function injectHtmlBridge(html: string): string {
  const tag = `<script data-book-bridge>${HTML_BRIDGE_SCRIPT}</script>`;
  const idx = html.toLowerCase().lastIndexOf('</body>');
  return idx >= 0 ? html.slice(0, idx) + tag + html.slice(idx) : html + tag;
}
