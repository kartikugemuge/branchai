// content/claude_content.js — Claude.ai branch injector
console.log("[BranchAI] claude content script loaded");

// DOM structure (verified):
// grandparent (conversation container, 50 children)
//   └── DIV (empty class, one per turn)
//       └── DIV.mb-1.mt-6.group  ← human turn
//          or DIV.group           ← assistant turn (no mt-6)
// Human turns also contain [data-testid="user-message"]
// Title: [data-testid="chat-title-button"]

function getConversationContainer() {
  const um = document.querySelector('[data-testid="user-message"]');
  if (!um) return null;
  const bubble = um.closest('.mt-6');
  if (!bubble) return null;
  // bubble → empty-class wrapper → grandparent (conversation container)
  return bubble.parentElement?.parentElement ?? null;
}

function getAllTurnElements() {
  const container = getConversationContainer();
  if (!container) return [];
  const turns = [];
  for (const child of container.children) {
    const el = child.firstElementChild;
    if (el) turns.push(el);
  }
  return turns;
}

function roleOf(el) {
  return el.classList.contains('mt-6') ? 'user' : 'assistant';
}

function textOf(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('button, [role="button"], svg, .branch-chat-btn').forEach(n => n.remove());
  // Prefer the explicit user-message container for cleaner human text
  const userMsg = clone.querySelector('[data-testid="user-message"]');
  return ((userMsg ?? clone).innerText ?? '').trim();
}

function scrapeTitle() {
  const btn = document.querySelector('[data-testid="chat-title-button"]');
  if (btn) {
    const txt = btn.innerText?.trim();
    if (txt && txt.length > 1) return txt;
  }
  return document.title?.replace(/\s*[-|]\s*Claude\s*$/i, '').trim() || null;
}

function scrapeAll() {
  const allNodes = getAllTurnElements();
  const baseTs = Date.now();
  const turns = [];
  const filtered = [];
  for (const el of allNodes) {
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

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const { turns, nodes, title } = scrapeAll();
    const anchorIndex = Math.max(0, nodes.indexOf(el));
    chrome.runtime.sendMessage({ type: 'OPEN_BRANCHAI', transcript: turns, anchorIndex, title });
  });

  el.appendChild(btn);
}

function injectAll() {
  getAllTurnElements().forEach(addPill);
}

// Handle SPA navigation (clicking between conversations)
let lastUrl = location.href;
let tries = 0;

function scheduleRetry() {
  tries = 0;
  (function retry() {
    injectAll();
    if (++tries < 20) setTimeout(retry, 500);
  })();
}

function onNavigation() {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  scheduleRetry();
}

// Throttled MutationObserver
let rafPending = false;
new MutationObserver(() => {
  onNavigation();
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    injectAll();
  });
}).observe(document.documentElement, { childList: true, subtree: true });

scheduleRetry();
