// content/content.js — ChatGPT branch injector
console.log("[BranchAI] content script loaded");

const MSG_SELECTOR = '[data-testid^="conversation-turn-"]';

function roleOf(el) {
  const child = el.querySelector('[data-message-author-role]');
  if (child) {
    const r = child.getAttribute('data-message-author-role');
    return r === 'assistant' ? 'assistant' : 'user';
  }
  // fallback: heuristic from class names
  const cls = (el.className || '').toLowerCase();
  return cls.includes('assistant') ? 'assistant' : 'user';
}

function textOf(el) {
  const md = el.querySelector('.markdown, .whitespace-pre-wrap, .prose, .message-content');
  if (!md) return (el.innerText || '').trim();

  // Clone and strip UI buttons (Copy, Regenerate, etc.)
  const clone = md.cloneNode(true);
  clone.querySelectorAll('button, [role="button"]').forEach(b => b.remove());
  return (clone.innerText || '').trim();
}

function scrapeTitle() {
  // Try sidebar nav for conversation title
  const active = document.querySelector('nav a[class*="bg-"]');
  if (active) {
    const txt = active.innerText?.trim();
    if (txt && txt.length > 1) return txt;
  }
  // Fallback: page <title> minus "ChatGPT" suffix
  const t = document.title?.replace(/\s*[-|]\s*ChatGPT\s*$/i, '').trim();
  return t || null;
}

function scrapeAll() {
  const allNodes = Array.from(document.querySelectorAll(MSG_SELECTOR));
  const baseTs = Date.now();
  const turns = [];
  const filtered = [];

  for (let i = 0; i < allNodes.length; i++) {
    const el = allNodes[i];
    const content = textOf(el);
    if (!content) continue;
    turns.push({ role: roleOf(el), content, ts: baseTs + filtered.length });
    filtered.push(el);
  }
  return { turns, nodes: filtered, title: scrapeTitle() };
}

function addPill(el) {
  if (el.querySelector('.branch-chat-btn')) return;
  el.style.position ||= 'relative';

  const btn = document.createElement('button');
  btn.className = 'branch-chat-btn';
  btn.textContent = 'branch';
  btn.title = 'Branch from here \u2192 BranchAI';
  Object.assign(btn.style, {
    position: 'absolute', right: '8px', top: '8px',
    padding: '4px 8px', border: '1px solid #ddd', borderRadius: '8px',
    background: '#fff', fontSize: '12px', cursor: 'pointer', zIndex: 10,
  });

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const { turns, nodes, title } = scrapeAll();
    const anchorIndex = Math.max(0, nodes.indexOf(el));
    chrome.runtime.sendMessage({ type: 'OPEN_BRANCHAI', transcript: turns, anchorIndex, title });
  });

  el.appendChild(btn);
}

function injectAll() {
  document.querySelectorAll(MSG_SELECTOR).forEach(addPill);
}

// Throttled MutationObserver via requestAnimationFrame
let rafPending = false;
new MutationObserver(() => {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    injectAll();
  });
}).observe(document.documentElement, { childList: true, subtree: true });

let tries = 0;
(function retry() {
  injectAll();
  if (++tries < 10) setTimeout(retry, 500);
})();
