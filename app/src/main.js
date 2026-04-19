// main.js — provider-based orchestration (screen-based UI)
import { loadInitial, persist, persistSettings, persistBranchMessages, persistBranchMetadata, state, currentBranch, currentProject, updateSettings, newBranch } from './state.js';
import { putProject } from './db.js';
import { renderAll, setModelStatus, getSettingsValues, setCurrentModelId, setCallbacks, appendStreamingBubble, updateStreamingContent } from './ui.js';
import { getProvider, listProviders } from './providers/registry.js';
import { SCREENS, navigateTo, onScreenChange, getCurrentScreen } from './router.js';
import { now } from './utils.js';
import { summarizeBranch } from './summarize.js';
import { compactMessages } from './compact.js';

const $ = (id) => document.getElementById(id);

// --- theme ---

function applyTheme() {
  const dark = !!state.settings.darkMode;
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('light', !dark);
}

// --- provider state ---

let activeProvider = null;
let currentModelId = null;
let _cachedModels = [];

// --- injected context (from content script via background) ---

async function getInjectedContext() {
  try {
    const result = await chrome.storage.session.get('branchai_pending');
    if (result.branchai_pending) {
      await chrome.storage.session.remove('branchai_pending');
      const { transcript, anchorIndex, title } = result.branchai_pending;
      if (Array.isArray(transcript) && transcript.length) {
        return { ctx: transcript, anchor: anchorIndex ?? transcript.length - 1, title: title || null };
      }
    }
  } catch { /* not in extension context */ }

  // Fallback: window globals / sessionStorage (dev mode)
  if (Array.isArray(window.__BRANCH_CONTEXT) && window.__BRANCH_CONTEXT.length) {
    return { ctx: window.__BRANCH_CONTEXT, anchor: window.__BRANCH_ANCHOR ?? (window.__BRANCH_CONTEXT.length - 1) };
  }
  try {
    const raw = sessionStorage.getItem('branchai_ctx');
    const ctx = raw ? JSON.parse(raw) : null;
    const a = Number(sessionStorage.getItem('branchai_anchor') ?? (ctx ? ctx.length - 1 : 0));
    if (ctx?.length) return { ctx, anchor: a };
  } catch { /* ignore */ }
  return null;
}

// --- provider/model management ---

function populateProviders() {
  const sel = $('providerSel');
  if (!sel) return;
  sel.innerHTML = '';
  for (const p of listProviders()) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === state.settings.activeProvider) opt.selected = true;
    sel.appendChild(opt);
  }
}

async function activateProvider(providerId) {
  state.settings.activeProvider = providerId;
  const config = state.settings[providerId] || {};
  activeProvider = getProvider(providerId, config);

  setModelStatus(`connecting to ${activeProvider.name}...`);
  const test = await activeProvider.testConnection();
  if (!test.ok) {
    setModelStatus(`${activeProvider.name}: ${test.error}`, 'bad');
    const sel = $('modelSel');
    if (sel) sel.innerHTML = '<option>--</option>';
    return;
  }

  setModelStatus(`${activeProvider.name}: connected`, 'ok');
  await populateModels();
}

async function populateModels(selectModelId) {
  const sel = $('modelSel');
  if (!activeProvider) return;

  try {
    _cachedModels = await activeProvider.listModels();
  } catch (e) {
    _cachedModels = [];
    if (sel) sel.innerHTML = '<option>error loading models</option>';
    setModelStatus(`model list failed: ${e.message}`, 'bad');
    return;
  }

  if (!sel) return;
  sel.innerHTML = '';
  if (!_cachedModels.length) {
    sel.innerHTML = '<option>no models found</option>';
    return;
  }
  for (const m of _cachedModels) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    sel.appendChild(opt);
  }
  // Use explicit model if provided, then branch model, then global default
  const target = selectModelId || state.settings.defaultModel;
  if (target && _cachedModels.some(m => m.id === target)) {
    sel.value = target;
  }
  currentModelId = sel.value;
  setCurrentModelId(currentModelId);
}

function repopulateModelsFromCache() {
  const sel = $('modelSel');
  if (!sel) return;

  // If cache is empty, show appropriate message
  if (!_cachedModels.length) {
    sel.innerHTML = '<option>no models available</option>';
    return;
  }

  sel.innerHTML = '';
  for (const m of _cachedModels) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    sel.appendChild(opt);
  }
  const target = currentModelId || state.settings.defaultModel;
  if (target && _cachedModels.some(m => m.id === target)) {
    sel.value = target;
  }
  currentModelId = sel.value;
  setCurrentModelId(currentModelId);
}

/**
 * Restore the branch's saved provider/model into the header dropdowns.
 */
async function syncBranchProvider() {
  const b = currentBranch();
  const branchProvider = b?.provider || state.settings.activeProvider;
  const branchModel = b?.model || null;

  if (branchProvider !== activeProvider?.id) {
    const provSel = $('providerSel');
    if (provSel) provSel.value = branchProvider;
    await activateProvider(branchProvider);
  }

  // Try to select the branch's saved model if it exists in the current provider
  if (branchModel) {
    const sel = $('modelSel');
    if (sel) {
      const modelExists = [...sel.options].some(o => o.value === branchModel);
      if (modelExists) {
        sel.value = branchModel;
        currentModelId = branchModel;
        setCurrentModelId(currentModelId);
      } else {
        // Model doesn't exist in this provider - use first available and update branch
        if (sel.options.length > 0 && sel.options[0].value !== 'no models available') {
          currentModelId = sel.value;
          setCurrentModelId(currentModelId);
          if (b) b.model = currentModelId;
        }
      }
    }
  }
}

// --- message building ---

function buildMessages(userText) {
  const b = currentBranch();
  if (!b) return [];

  const msgs = [];
  msgs.push({ role: 'system', content: 'You are a helpful assistant. Continue the conversation naturally.' });

  for (const m of b.messages) {
    msgs.push({ role: m.role, content: m.content });
  }

  if (userText?.trim()) {
    msgs.push({ role: 'user', content: userText.trim() });
  }
  return msgs;
}

// --- send ---

async function sendMessage() {
  const b = currentBranch();
  if (!b) return alert('Create/select a branch first.');
  if (!activeProvider) return alert('No provider connected. Check settings.');

  const input = $('chatInput');
  const userText = input?.value || '';
  if (input) input.value = '';
  autoResizeTextarea(input);

  if (userText?.trim()) {
    b.messages.push({ role: 'user', content: userText.trim(), ts: now() });
    await persistBranchMessages(b.id);
    renderAll();
  }

  // Use branch provider/model if set, falling back to current UI selection
  const providerId = b.provider || activeProvider.id;
  let provider = activeProvider;
  if (providerId !== activeProvider.id) {
    const config = state.settings[providerId] || {};
    provider = getProvider(providerId, config);
  }

  // Get model - prefer branch model if it exists in the current provider's models
  let model = $('modelSel')?.value; // Start with UI selection
  if (b.model && _cachedModels.some(m => m.id === b.model)) {
    // Branch model exists in current provider, use it
    model = b.model;
  } else if (b.model) {
    // Branch has a model that doesn't exist in current provider - use UI selection
    // and update branch to prevent future mismatches
    b.model = model;
  }

  if (!model || model === '--' || model === 'no models found' || model === 'loading...') {
    return alert('No model selected. Please select a model from the dropdown.');
  }

  setModelStatus(`${provider.name}: generating...`);
  const sendBtn = $('sendBtn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    appendStreamingBubble();
    const messages = buildMessages(null);
    const output = await provider.chatStream(messages, {
      model,
      max_tokens: 2048,
      onToken: (txt) => { updateStreamingContent(txt); },
    });

    const streamEl = $('streaming-content');
    const assistantText = streamEl?.textContent || output || '(no content)';
    b.messages.push({ role: 'assistant', content: assistantText, ts: now() });
    b.model = model;
    b.provider = providerId;
    b.updatedAt = now();
    const p = currentProject();
    if (p) p.updatedAt = now();
    await persistBranchMessages(b.id);
    if (p) putProject({ id: p.id, name: p.name, description: p.description, emoji: p.emoji, createdAt: p.createdAt, updatedAt: p.updatedAt });
    renderAll();
    setModelStatus(`${provider.name}: connected`, 'ok');

    // Fire-and-forget branch summary update
    if (b.messages.length !== b.summaryMsgCount) {
      const _p = currentProject();
      summarizeBranch(provider, model, b).then(summary => {
        if (summary) {
          b.summary = summary;
          b.summaryMsgCount = b.messages.length;
          if (_p) persistBranchMetadata(b, _p.id);
        }
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[BranchAI] run error', e);
    updateStreamingContent('Error: ' + (e?.message || e));
    setModelStatus(`${provider.name}: error`, 'bad');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

// --- lazy branch summarization ---

const _summaryFailed = new Map(); // branchId → msgCount at failure

function lazySummarizeBranches() {
  if (!activeProvider) return;
  const p = currentProject();
  if (!p) return;
  const model = currentModelId || state.settings.defaultModel;
  if (!model) return;

  for (const b of p.branches) {
    if (b.messages.length === 0) continue;
    // Skip branches that already have a summary — the per-message
    // summarize call in sendMessage() keeps them up-to-date.
    if (b.summary) continue;
    // Don't retry if we already failed at this message count
    if (_summaryFailed.get(b.id) === b.messages.length) continue;

    summarizeBranch(activeProvider, model, b).then(summary => {
      if (summary) {
        b.summary = summary;
        b.summaryMsgCount = b.messages.length;
        _summaryFailed.delete(b.id);
        persistBranchMetadata(b, p.id);
        renderAll();
      }
    }).catch(() => {
      // Mark as failed at this message count — will retry only when new messages arrive
      _summaryFailed.set(b.id, b.messages.length);
    });
  }
}

// --- chat input wiring ---

function wireChatInput() {
  const input = $('chatInput');
  const sendBtn = $('sendBtn');
  if (!input) return;

  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  input.oninput = () => autoResizeTextarea(input);

  if (sendBtn) sendBtn.onclick = sendMessage;
}

function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}

// --- settings ---

function handleSettingsSave() {
  const vals = getSettingsValues();
  updateSettings(vals);
  const modal = $('settingsModal');
  if (modal) modal.style.display = 'none';
  activateProvider(state.settings.activeProvider);
}

// --- callbacks for ui.js ---

setCallbacks({
  onProviderChange: async (e) => {
    const id = e.target.value;
    await activateProvider(id);
    const b = currentBranch();
    if (b) {
      b.provider = id;
      // Always use the newly selected model from dropdown after provider switch
      // This ensures we don't use an old model name from a different provider
      const newModel = $('modelSel')?.value;
      if (newModel && newModel !== '--' && newModel !== 'loading...' && newModel !== 'no models found') {
        b.model = newModel;
      } else {
        b.model = null; // Clear invalid model
      }
      const p = currentProject();
      if (p) persistBranchMetadata(b, p.id);
      persistSettings();
    }
  },
  onModelChange: (e) => {
    currentModelId = e.target.value;
    setCurrentModelId(currentModelId);
    state.settings.defaultModel = currentModelId;
    const b = currentBranch();
    if (b) {
      b.model = currentModelId;
      const p = currentProject();
      if (p) persistBranchMetadata(b, p.id);
      persistSettings();
    }
  },
  onChatRender: () => {
    repopulateModelsFromCache();
    populateProviders();
  },
  onGenerateSummary: async (seedMessages, anchorIdx) => {
    if (!activeProvider) throw new Error('No provider connected');
    const model = currentModelId || state.settings.defaultModel;
    if (!model) throw new Error('No model selected');
    return await summarizeBranch(activeProvider, model, {
      messages: seedMessages,
      branchedFromMsg: anchorIdx,
    });
  },
  onCompactChat: async () => {
    const b = currentBranch();
    const p = currentProject();
    if (!b || !p) throw new Error('No branch selected');
    if (!activeProvider) throw new Error('No provider connected');
    const model = $('modelSel')?.value || currentModelId;
    if (!model || ['--', 'loading...', 'no models found', 'no models available'].includes(model)) {
      throw new Error('No model selected');
    }
    const TAIL = 4;
    const msgs = b.messages;
    if (msgs.length < TAIL + 2) throw new Error('Not enough messages to compact');

    const toCompact = msgs.slice(0, msgs.length - TAIL);
    const tail = msgs.slice(msgs.length - TAIL);
    const summary = await compactMessages(activeProvider, model, toCompact);

    const seedMsgs = [
      {
        role: 'user',
        content: `[Previous conversation recap — use this as context; continue naturally from the tail below.]\n\n${summary}`,
        ts: now(),
      },
      { role: 'assistant', content: 'Understood. I have the recap.', ts: now() },
      ...tail.map(m => ({ ...m })),
    ];

    const newBr = newBranch(
      `Compacted \u00B7 ${b.title}`,
      seedMsgs,
      null,
      { description: `Compacted from "${b.title}" (${msgs.length} messages condensed)` },
    );
    if (newBr) {
      newBr.provider = b.provider || activeProvider.id;
      newBr.model = b.model || model;
      await persistBranchMetadata(newBr, p.id);
      renderAll();
      await syncBranchProvider();
      wireChatInput();
    }
  },
  onSaveApiKey: (provider, config) => {
    if (state.settings[provider]) {
      Object.assign(state.settings[provider], config);
      persistSettings();
    }
  },
  onSettingsSave: handleSettingsSave,
  onDarkModeChange: async (isDark) => {
    state.settings.darkMode = isDark;
    updateSettings({ darkMode: isDark });
    applyTheme();
    renderAll();
    if (getCurrentScreen() === SCREENS.CHAT) {
      populateProviders();
      if (!_cachedModels.length && activeProvider) {
        await populateModels();
      } else {
        repopulateModelsFromCache();
      }
      await syncBranchProvider();
      wireChatInput();
    }
  },
  onExport: async () => {
    const mod = await import('./export_import.js');
    mod.exportCurrentProject();
  },
  onImport: null, // handled via fileInput below
});

// File input handler (for import)
const fileInput = $('fileInput');
if (fileInput) {
  fileInput.onchange = async (e) => {
    const mod = await import('./export_import.js');
    try {
      await mod.importFromFile(e.target.files?.[0]);
      renderAll();
    } catch (err) {
      alert('Import error: ' + (err?.message || err));
    }
    e.target.value = '';
  };
}

// --- screen change listener ---

onScreenChange(async (screen) => {
  // Set sidebar collapse state based on screen
  if (screen === SCREENS.PROJECT) {
    state.sidebarCollapsed = false;
  } else if (screen === SCREENS.CHAT) {
    state.sidebarCollapsed = true;
  }

  renderAll();
  if (screen === SCREENS.CHAT) {
    // Re-populate provider/model selects on chat entry
    populateProviders();

    // If cache is empty (provider wasn't activated or failed), fetch models now
    if (!_cachedModels.length && activeProvider) {
      await populateModels();
    } else {
      repopulateModelsFromCache();
    }

    await syncBranchProvider();
    wireChatInput();
  } else if (screen === SCREENS.PROJECT) {
    // Lazy-fill missing branch summaries
    lazySummarizeBranches();
  }
});

// --- boot ---

(async function boot() {
  // 0) Run one-time migration from legacy blob to IndexedDB
  try {
    const { migrateIfNeeded } = await import('./migration.js');
    await migrateIfNeeded();
  } catch (e) {
    console.error('[BranchAI] migration import failed', e);
  }

  // 1) Load state + any injected context
  const inj = await getInjectedContext();
  await loadInitial(inj?.ctx, inj?.anchor, inj?.title);
  applyTheme();

  // 2) Eagerly activate provider (cached internally)
  await activateProvider(state.settings.activeProvider);

  // 3) Navigate to the right screen
  if (inj?.ctx?.length) {
    // navigateTo fires onScreenChange → renderAll + chat wiring
    navigateTo(SCREENS.CHAT);
  } else {
    // HOME is the default _current, so navigateTo won't fire the callback.
    // Render manually for the initial paint.
    renderAll();
  }

  // 4) Listen for late context injection
  window.addEventListener('branchai:ctx-ready', async () => {
    const late = await getInjectedContext();
    if (late?.ctx?.length) {
      await loadInitial(late.ctx, late.anchor, late.title);
      if (getCurrentScreen() === SCREENS.CHAT) {
        // Already on chat — navigateTo would be a no-op, refresh manually
        renderAll();
        populateProviders();
        if (!_cachedModels.length && activeProvider) {
          await populateModels();
        } else {
          repopulateModelsFromCache();
        }
        await syncBranchProvider();
        wireChatInput();
      } else {
        navigateTo(SCREENS.CHAT);
      }
    }
  });

  // 5) Listen for CTX_READY message from background (tab reuse path)
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'CTX_READY') {
        window.dispatchEvent(new Event('branchai:ctx-ready'));
      }
    });
  } catch { /* not in extension context */ }
})();
