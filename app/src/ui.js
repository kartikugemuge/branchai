// ui.js — screen-based rendering + event wiring (XSS-safe)
import { state, currentProject, currentBranch, persist, newProject, newBranch, deleteBranch, deleteProject } from './state.js';
import { escapeHtml, estimateTokens, getTokenLimit, now, timeAgo } from './utils.js';
import { getProvider } from './providers/registry.js';
import { SCREENS, navigateTo, getCurrentScreen } from './router.js';
import { ICONS } from './icons.js';

const $ = (id) => document.getElementById(id);

// --- callbacks set by main.js ---
let _callbacks = {};
let _currentModelId = null;

// --- cached model status (survives header re-renders) ---
let _lastStatus = { text: 'starting...', level: '' };

export function setCurrentModelId(modelId) {
  _currentModelId = modelId;
}

export function setCallbacks(cbs) {
  _callbacks = cbs;
}

// --- status ---

export function setModelStatus(text, level = '') {
  _lastStatus = { text, level };
  const el = $('modelStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'status-pill ' + (level === 'ok' ? 'status-ok' : level === 'bad' ? 'status-bad' : 'status-connecting');
}

export function replayModelStatus() {
  setModelStatus(_lastStatus.text, _lastStatus.level);
}

// --- header rendering ---

function themeIcon() {
  return state.settings.darkMode ? ICONS.sun : ICONS.moon;
}

function renderHeader() {
  const header = $('appHeader');
  if (!header) return;
  const screen = getCurrentScreen();

  if (screen === SCREENS.HOME) {
    header.innerHTML = `
      <div class="header-left">
        <span class="header-logo" id="headerLogo">BranchAI</span>
      </div>
      <div class="header-right">
        <div class="view-toggle">
          <button id="viewGridBtn" class="${state.viewMode === 'grid' ? 'active' : ''}" title="Grid view">${ICONS.grid}</button>
          <button id="viewListBtn" class="${state.viewMode === 'list' ? 'active' : ''}" title="List view">${ICONS.list}</button>
        </div>
        <button class="icon-btn" id="themeToggle" title="Toggle theme">${themeIcon()}</button>
        <button class="icon-btn" id="settingsBtn" title="Settings">${ICONS.gear}</button>
        <button class="btn-primary" id="newProjectBtn">${ICONS.plus} New Project</button>
      </div>`;
  } else if (screen === SCREENS.PROJECT) {
    const p = currentProject();
    header.innerHTML = `
      <div class="header-left">
        <button class="back-btn" id="navBack" title="Back to projects">${ICONS.backArrow}</button>
        <div class="breadcrumb">
          <a id="navHome">Projects</a>
          <span class="sep">${ICONS.chevronRight}</span>
          <span class="current">${p ? escapeHtml(p.name) : 'Project'}</span>
        </div>
      </div>
      <div class="header-right">
        <div class="view-toggle">
          <button id="viewGridBtn" class="${state.viewMode === 'grid' ? 'active' : ''}" title="Grid view">${ICONS.grid}</button>
          <button id="viewListBtn" class="${state.viewMode === 'list' ? 'active' : ''}" title="List view">${ICONS.list}</button>
        </div>
        <button class="icon-btn" id="themeToggle" title="Toggle theme">${themeIcon()}</button>
        <button class="icon-btn" id="settingsBtn" title="Settings">${ICONS.gear}</button>
        <button class="btn-primary" id="newBranchBtn">${ICONS.plus} New Branch</button>
      </div>`;
  } else if (screen === SCREENS.CHAT) {
    const p = currentProject();
    const b = currentBranch();
    const msgCount = Array.isArray(b?.messages) ? b.messages.length : 0;
    const compactBtn = msgCount >= 6
      ? `<button class="btn-compact" id="compactBtn" title="Summarize this chat into a new compacted branch">${ICONS.compress} Compact</button>`
      : '';
    header.innerHTML = `
      <div class="header-left">
        <button class="back-btn" id="navBack" title="Back to branches">${ICONS.backArrow}</button>
        <div class="breadcrumb">
          <a id="navHome">Projects</a>
          <span class="sep">${ICONS.chevronRight}</span>
          <a id="navProject">${p ? escapeHtml(p.name) : 'Project'}</a>
          <span class="sep">${ICONS.chevronRight}</span>
          <span class="current">${b ? escapeHtml(b.title) : 'Branch'}</span>
        </div>
      </div>
      <div class="header-right">
        <div class="header-select">
          <select id="providerSel"></select>
        </div>
        <div class="header-select">
          <select id="modelSel"><option>loading...</option></select>
        </div>
        <span id="modelStatus" class="status-pill status-connecting">starting...</span>
        <span id="tokenInfo" class="token-badge"></span>
        ${compactBtn}
        <button class="icon-btn" id="themeToggle" title="Toggle theme">${themeIcon()}</button>
        <button class="icon-btn" id="settingsBtn" title="Settings">${ICONS.gear}</button>
      </div>`;
  }

  wireHeaderEvents();
}

function wireHeaderEvents() {
  const screen = getCurrentScreen();

  // Logo click → home
  const logo = $('headerLogo');
  if (logo) logo.onclick = () => navigateTo(SCREENS.HOME);

  // Back button — goes one level up
  const navBack = $('navBack');
  if (navBack) {
    if (screen === SCREENS.PROJECT) navBack.onclick = () => navigateTo(SCREENS.HOME);
    else if (screen === SCREENS.CHAT) navBack.onclick = () => navigateTo(SCREENS.PROJECT);
  }

  // Breadcrumb links
  const navHome = $('navHome');
  if (navHome) navHome.onclick = () => navigateTo(SCREENS.HOME);
  const navProject = $('navProject');
  if (navProject) navProject.onclick = () => navigateTo(SCREENS.PROJECT);

  // View toggle
  const gridBtn = $('viewGridBtn');
  const listBtn = $('viewListBtn');
  if (gridBtn) gridBtn.onclick = () => { state.viewMode = 'grid'; persist(); renderAll(); };
  if (listBtn) listBtn.onclick = () => { state.viewMode = 'list'; persist(); renderAll(); };

  // Theme toggle (sun/moon)
  const themeToggle = $('themeToggle');
  if (themeToggle) themeToggle.onclick = () => _callbacks.onDarkModeChange?.(!state.settings.darkMode);

  // Settings
  const settingsBtn = $('settingsBtn');
  if (settingsBtn) settingsBtn.onclick = () => {
    openSettingsModal();
    const saveBtn = $('settSaveBtn');
    if (saveBtn) saveBtn.onclick = () => _callbacks.onSettingsSave?.();
  };

  // New project
  const newProjBtn = $('newProjectBtn');
  if (newProjBtn) newProjBtn.onclick = () => openNewProjectModal((name, desc, emoji) => {
    newProject(name, null, 'Main', { description: desc, emoji });
    navigateTo(SCREENS.PROJECT);
  });

  // New branch
  const newBrBtn = $('newBranchBtn');
  if (newBrBtn) newBrBtn.onclick = () => openNewBranchModal((name, desc, emoji) => {
    newBranch(name, [], null, { description: desc, emoji });
    navigateTo(SCREENS.CHAT);
  });

  // Provider/model selects (chat screen)
  if (screen === SCREENS.CHAT) {
    const provSel = $('providerSel');
    const modSel = $('modelSel');
    if (provSel) provSel.onchange = (e) => _callbacks.onProviderChange?.(e);
    if (modSel) modSel.onchange = (e) => _callbacks.onModelChange?.(e);

    const compactBtn = $('compactBtn');
    if (compactBtn) compactBtn.onclick = async () => {
      if (!confirm('Compact this chat? A new branch will be created with an AI-generated summary of the earlier messages plus the last 4 messages verbatim. The current branch stays untouched.')) return;
      const orig = compactBtn.innerHTML;
      compactBtn.disabled = true;
      compactBtn.innerHTML = `${ICONS.compress} Compacting...`;
      try {
        await _callbacks.onCompactChat?.();
      } catch (e) {
        alert('Compaction failed: ' + (e?.message || e));
      } finally {
        compactBtn.disabled = false;
        compactBtn.innerHTML = orig;
      }
    };
  }
}

// --- screen renderers ---

function renderProjectsScreen() {
  const el = $('home-content');
  if (!el) return;

  const projects = Array.isArray(state.projects) ? state.projects : [];

  let html = `<h1 class="page-title">Your Projects</h1>
    <p class="page-subtitle">Organize your AI conversations into projects</p>`;

  if (!projects.length) {
    html += `<div class="empty-state"><p>No projects yet. Create one to get started.</p></div>`;
  } else if (state.viewMode === 'grid') {
    html += '<div class="cards-grid">';
    for (const p of projects) {
      const branchCount = (p.branches || []).length;
      html += `
        <div class="project-card" data-project="${escapeHtml(p.id)}">
          <button class="card-delete" data-del-project="${escapeHtml(p.id)}" title="Delete project">&times;</button>
          ${p.emoji ? `<div class="card-emoji">${escapeHtml(p.emoji)}</div>` : ''}
          <div class="card-name">${escapeHtml(p.name)}</div>
          <div class="card-desc">${escapeHtml(p.description || '')}</div>
          <div class="card-meta">
            <span>${ICONS.gitBranch} ${branchCount} branch${branchCount !== 1 ? 'es' : ''}</span>
            <span>${ICONS.clock} ${timeAgo(p.updatedAt)}</span>
          </div>
        </div>`;
    }
    html += '</div>';
  } else {
    html += `<div class="data-table projects-table">
      <div class="table-header">
        <span class="col-name">Project</span>
        <span class="col-desc">Description</span>
        <span class="col-count">Branches</span>
        <span class="col-updated">Updated</span>
      </div>`;
    for (const p of projects) {
      const branchCount = (p.branches || []).length;
      html += `
      <div class="table-row" data-project="${escapeHtml(p.id)}">
        <span class="col-name">${p.emoji ? `<span class="row-emoji">${escapeHtml(p.emoji)}</span> ` : ''}${escapeHtml(p.name)}</span>
        <span class="col-desc">${escapeHtml(p.description || '')}</span>
        <span class="col-count">${ICONS.gitBranch} ${branchCount}</span>
        <span class="col-updated">${ICONS.clock} ${timeAgo(p.updatedAt)}</span>
        <button class="row-delete" data-del-project="${escapeHtml(p.id)}" title="Delete">&times;</button>
      </div>`;
    }
    html += '</div>';
  }

  // Privacy section
  html += `
    <div class="privacy-section">
      <div class="privacy-badge">${ICONS.shield} Privacy-First &amp; Open Source</div>
      <h2 class="privacy-title">Your Data, Your Control</h2>
      <p class="privacy-subtitle">BranchAI is built with privacy as a core principle. Your conversations, API keys, and data never leave your browser.</p>
      <div class="privacy-cards">
        <div class="privacy-card">
          <div class="privacy-card-icon">${ICONS.userX}</div>
          <div class="privacy-card-title">No User Accounts</div>
          <div class="privacy-card-desc">Use immediately without signing up or logging in</div>
        </div>
        <div class="privacy-card">
          <div class="privacy-card-icon">${ICONS.database}</div>
          <div class="privacy-card-title">Local Storage Only</div>
          <div class="privacy-card-desc">All data stays in your browser \u2014 nothing stored in the cloud</div>
        </div>
        <div class="privacy-card">
          <div class="privacy-card-icon">${ICONS.shieldCheck}</div>
          <div class="privacy-card-title">Privacy First</div>
          <div class="privacy-card-desc">Your conversations and API keys never touch our servers</div>
        </div>
        <div class="privacy-card">
          <div class="privacy-card-icon">${ICONS.code}</div>
          <div class="privacy-card-title">Fully Open Source</div>
          <div class="privacy-card-desc">Inspect the code, contribute, or self-host</div>
        </div>
      </div>
      <p class="privacy-verify">Want to verify? Check out our <a href="https://github.com/kartikuge/branchai" target="_blank" rel="noopener">source code on GitHub</a>.</p>
      <p class="privacy-collect">What data do we collect? Nothing.</p>
    </div>`;

  el.innerHTML = html;

  // Wire clicks
  el.querySelectorAll('[data-project]').forEach(node => {
    if (node.classList.contains('row-delete') || node.classList.contains('card-delete')) return;
    node.addEventListener('click', (e) => {
      if (e.target.closest('.row-delete') || e.target.closest('.card-delete')) return;
      state.activeProjectId = node.dataset.project;
      const proj = state.projects.find(x => x.id === state.activeProjectId);
      if (proj?.branches?.[0]) state.activeBranchId = proj.branches[0].id;
      persist();
      navigateTo(SCREENS.PROJECT);
    });
  });

  el.querySelectorAll('[data-del-project]').forEach(btn => {
    if (!btn.classList.contains('row-delete') && !btn.classList.contains('card-delete')) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete this project and all its branches?')) return;
      deleteProject(btn.dataset.delProject);
      renderAll();
    });
  });
}

function renderBranchesInto(el) {
  if (!el) return;

  const p = currentProject();
  if (!p) {
    el.innerHTML = '<div class="empty-state"><p>No project selected.</p></div>';
    return;
  }

  const branches = Array.isArray(p.branches) ? p.branches : [];

  let html = `<h1 class="page-title">Branches</h1>
    <p class="page-subtitle">${escapeHtml(p.description || p.name)}</p>`;

  if (!branches.length) {
    html += '<div class="empty-state"><p>No branches yet. Create one to start a conversation.</p></div>';
    el.innerHTML = html;
    return;
  }

  if (state.viewMode === 'grid') {
    html += '<div class="cards-grid">';
    for (const b of branches) {
      const msgCount = (b.messages || []).length;
      const isActive = b.id === state.activeBranchId;
      const branchedMeta = b.branchedFromMsg != null ? `<span>${ICONS.gitFork} msg ${b.branchedFromMsg + 1}</span>` : '';
      html += `
        <div class="branch-card" data-branch="${escapeHtml(b.id)}">
          ${isActive ? '<div class="active-dot"></div>' : ''}
          <button class="card-delete" data-del-branch="${escapeHtml(b.id)}" title="Delete branch">&times;</button>
          ${b.emoji ? `<div class="card-emoji">${escapeHtml(b.emoji)}</div>` : ''}
          <div class="card-name">${escapeHtml(b.title)}</div>
          <div class="card-desc">${escapeHtml(b.summary || b.description || '')}</div>
          <div class="card-meta">
            <span>${ICONS.message} ${msgCount} msg${msgCount !== 1 ? 's' : ''}</span>
            <span>${ICONS.clock} ${timeAgo(b.updatedAt)}</span>
            ${branchedMeta}
          </div>
        </div>`;
    }
    html += '</div>';
  } else {
    html += `<div class="data-table branches-table">
      <div class="table-header">
        <span class="col-name">Branch</span>
        <span class="col-desc">Summary</span>
        <span class="col-count">Messages</span>
        <span class="col-origin">Origin</span>
        <span class="col-updated">Updated</span>
      </div>`;
    for (const b of branches) {
      const msgCount = (b.messages || []).length;
      const isActive = b.id === state.activeBranchId;
      const summaryText = b.summary || b.description || '';
      const origin = b.branchedFromMsg != null
        ? `${ICONS.gitFork} from msg ${b.branchedFromMsg + 1}`
        : '<span class="muted">root</span>';
      const expandBtn = summaryText
        ? `<span class="expand-toggle" data-expand="${escapeHtml(b.id)}">${ICONS.chevronRight}</span>`
        : '';
      html += `
      <div class="table-row${isActive ? ' row-active' : ''}" data-branch="${escapeHtml(b.id)}">
        <span class="col-name">${b.emoji ? `<span class="row-emoji">${escapeHtml(b.emoji)}</span> ` : ''}${escapeHtml(b.title)}</span>
        <span class="col-desc">${expandBtn}<span class="desc-text">${escapeHtml(summaryText)}</span></span>
        <span class="col-count">${ICONS.message} ${msgCount}</span>
        <span class="col-origin">${origin}</span>
        <span class="col-updated">${timeAgo(b.updatedAt)}</span>
        <button class="row-delete" data-del-branch="${escapeHtml(b.id)}" title="Delete">&times;</button>
      </div>`;
    }
    html += '</div>';
  }

  el.innerHTML = html;

  // Wire expand toggles
  el.querySelectorAll('[data-expand]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = btn.closest('.table-row');
      if (row) row.classList.toggle('expanded');
    });
  });

  // Wire clicks
  el.querySelectorAll('[data-branch]').forEach(node => {
    if (node.classList.contains('row-delete') || node.classList.contains('card-delete')) return;
    node.addEventListener('click', (e) => {
      if (e.target.closest('.row-delete') || e.target.closest('.card-delete') || e.target.closest('.expand-toggle')) return;
      state.activeBranchId = node.dataset.branch;
      persist();
      navigateTo(SCREENS.CHAT);
    });
  });

  el.querySelectorAll('[data-del-branch]').forEach(btn => {
    if (!btn.classList.contains('row-delete') && !btn.classList.contains('card-delete')) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete this branch?')) return;
      deleteBranch(btn.dataset.delBranch);
      renderAll();
    });
  });
}

function renderChatInto(container) {
  if (!container) return;

  const b = currentBranch();
  const messages = Array.isArray(b?.messages) ? b.messages : [];

  // Build the chat container HTML
  let subtitleText = '';
  if (b) {
    const parts = [];
    if (b.branchedFromMsg != null) parts.push(`Branched from msg ${b.branchedFromMsg + 1}`);
    parts.push(`${messages.length} message${messages.length !== 1 ? 's' : ''}`);
    subtitleText = parts.join(' \u00B7 ');
  }

  container.innerHTML = `
    <div class="chat-container">
      <div class="chat-subtitle" id="chatSubtitle">${escapeHtml(subtitleText)}</div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-input-bar">
        <textarea id="chatInput" placeholder="Type to continue this branch..." rows="1"></textarea>
        <button class="send-btn" id="sendBtn" title="Send message"></button>
      </div>
    </div>
  `;

  const chatEl = $('chatMessages');
  if (!chatEl) return;

  if (!messages.length) {
    chatEl.innerHTML = '<div class="empty-state"><p>Start the conversation by typing a message below.</p></div>';
  } else {
    chatEl.innerHTML = messages.map((m, idx) => {
      const isUser = m.role === 'user';
      const avatar = isUser ? 'You' : 'AI';
      const copyBtn = !isUser ? `<button class="msg-action-btn" data-copy="${idx}" title="Copy">${ICONS.copy}</button>` : '';
      return `
        <div class="msg-row ${escapeHtml(m.role)}">
          <div class="msg-avatar">${avatar}</div>
          <div class="msg-bubble">${escapeHtml(m.content)}</div>
          <div class="msg-actions">
            <button class="msg-action-btn" data-branch-idx="${idx}" title="Branch from here">${ICONS.gitFork}</button>
            ${copyBtn}
          </div>
        </div>`;
    }).join('');

    // Wire branch-here buttons
    chatEl.querySelectorAll('[data-branch-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.branchIdx);
        const seed = messages.slice(0, i + 1);
        _openCreateModal(
          'Branch from here',
          'Branch name',
          (name, desc) => {
            newBranch(name, seed, i, { description: desc });
            navigateTo(SCREENS.CHAT);
          },
          {
            defaultName: `Branch @ msg ${i + 1}`,
            aiGenerate: _callbacks.onGenerateSummary
              ? () => _callbacks.onGenerateSummary(seed, i)
              : null,
          }
        );
      });
    });

    // Wire copy buttons
    chatEl.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const i = Number(btn.dataset.copy);
        const text = messages[i]?.content || '';
        if (text) await navigator.clipboard.writeText(text);
      });
    });

    // Auto-scroll
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  // Update token info
  updateTokenInfo();

  // Send button icon
  const sendBtn = $('sendBtn');
  if (sendBtn) sendBtn.innerHTML = ICONS.arrowUp;
}

// --- streaming support ---

export function appendStreamingBubble() {
  const chatEl = $('chatMessages');
  if (!chatEl) return;
  const row = document.createElement('div');
  row.className = 'msg-row assistant';
  row.innerHTML = `
    <div class="msg-avatar">AI</div>
    <div class="msg-bubble streaming-cursor" id="streaming-content"></div>`;
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}

export function updateStreamingContent(text) {
  const el = $('streaming-content');
  if (el) {
    el.textContent = text;
    const chatEl = $('chatMessages');
    if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
  }
}

// --- token info ---

function updateTokenInfo() {
  const b = currentBranch();
  const el = $('tokenInfo');
  if (!el) return;
  const tokens = estimateTokens(b?.messages);
  const limit = getTokenLimit(_currentModelId);
  const ratio = tokens / limit;
  el.textContent = `~${tokens} / ${limit} tokens`;
  el.classList.remove('token-ok', 'token-warn', 'token-danger');
  if (ratio > 0.8) {
    el.classList.add('token-danger');
  } else if (ratio >= 0.5) {
    el.classList.add('token-warn');
  } else {
    el.classList.add('token-ok');
  }
}

// --- screen activation ---

function activateScreen(screen) {
  const homeEl = $('screen-home');
  const workspace = $('workspace');

  if (screen === SCREENS.HOME) {
    if (homeEl) homeEl.classList.add('active');
    if (homeEl) homeEl.style.display = '';
    if (workspace) workspace.style.display = 'none';
  } else {
    if (homeEl) homeEl.classList.remove('active');
    if (homeEl) homeEl.style.display = 'none';
    if (workspace) workspace.style.display = 'flex';
  }
}

// --- sidebar rendering ---

function renderSidebar() {
  const sidebarEl = $('sidebar');
  const sidebarContent = $('sidebar-content');
  if (!sidebarEl || !sidebarContent) return;

  sidebarEl.classList.remove('collapsed');
  const projects = Array.isArray(state.projects) ? state.projects : [];
  const screen = getCurrentScreen();

  let html = '<div class="sidebar-back-btn" id="sidebarBackHome">' + ICONS.chevronLeft + ' Projects</div>';
  for (const p of projects) {
    const isActive = p.id === state.activeProjectId;
    const branchCount = (p.branches || []).length;
    const isExpanded = isActive && state._sidebarExpanded !== false;
    html += `
      <div class="sidebar-project-group${isActive ? ' active' : ''}">
        <div class="sidebar-item" data-sidebar-project="${escapeHtml(p.id)}">
          <span class="sidebar-item-chevron${isExpanded ? ' expanded' : ''}">${ICONS.chevronRight}</span>
          <div class="sidebar-item-body">
            <div class="sidebar-item-name">${escapeHtml(p.name)}</div>
            <div class="sidebar-item-meta">${branchCount} branch${branchCount !== 1 ? 'es' : ''}</div>
          </div>
        </div>
        <div class="sidebar-branches${isExpanded ? ' open' : ''}">`;
    if (isExpanded) {
      for (const b of (p.branches || [])) {
        const isBranchActive = b.id === state.activeBranchId;
        const msgCount = (b.messages || []).length;
        html += `
          <div class="sidebar-branch${isBranchActive ? ' active' : ''}" data-sidebar-branch="${escapeHtml(b.id)}" data-sidebar-branch-project="${escapeHtml(p.id)}">
            <div class="sidebar-branch-name">${escapeHtml(b.title)}</div>
            <div class="sidebar-branch-meta">${msgCount} msg${msgCount !== 1 ? 's' : ''}</div>
          </div>`;
      }
    }
    html += `</div></div>`;
  }
  sidebarContent.innerHTML = html;

  // Wire back button
  const backBtn = $('sidebarBackHome');
  if (backBtn) backBtn.onclick = () => navigateTo(SCREENS.HOME);

  // Wire project clicks — expand/collapse + set active
  sidebarContent.querySelectorAll('[data-sidebar-project]').forEach(node => {
    node.addEventListener('click', () => {
      const pid = node.dataset.sidebarProject;
      if (state.activeProjectId === pid) {
        // Toggle expand/collapse
        state._sidebarExpanded = !state._sidebarExpanded;
      } else {
        state.activeProjectId = pid;
        state._sidebarExpanded = true;
        const proj = state.projects.find(x => x.id === pid);
        if (proj?.branches?.[0]) state.activeBranchId = proj.branches[0].id;
      }
      persist();
      renderAll();
    });
  });

  // Wire branch clicks — navigate to chat
  sidebarContent.querySelectorAll('[data-sidebar-branch]').forEach(node => {
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      const bid = node.dataset.sidebarBranch;
      const pid = node.dataset.sidebarBranchProject;
      state.activeProjectId = pid;
      state.activeBranchId = bid;
      persist();
      navigateTo(SCREENS.CHAT);
    });
  });
}

// --- main render ---

export function renderAll() {
  const screen = getCurrentScreen();
  activateScreen(screen);
  renderHeader();

  if (screen === SCREENS.HOME) {
    renderProjectsScreen();
  } else if (screen === SCREENS.PROJECT) {
    state.sidebarCollapsed = false;
    renderSidebar();
    const workspaceContent = $('workspace-content');
    if (workspaceContent) {
      workspaceContent.className = '';
      renderBranchesInto(workspaceContent);
    }
  } else if (screen === SCREENS.CHAT) {
    state.sidebarCollapsed = true;
    renderSidebar();
    const workspaceContent = $('workspace-content');
    if (workspaceContent) {
      workspaceContent.className = 'chat-mode';
      renderChatInto(workspaceContent);
    }
    replayModelStatus();
    _callbacks.onChatRender?.();
  }
}

// --- settings modal ---

export function openSettingsModal() {
  let modal = $('settingsModal');
  if (modal) {
    // Update dark mode checkbox to current state
    const cb = $('settDarkMode');
    if (cb) cb.checked = state.settings.darkMode;
    modal.style.display = 'flex';
    return;
  }

  modal = document.createElement('div');
  modal.id = 'settingsModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Settings</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="settings-section-header">Cloud Providers</div>

        <label>OpenAI API Key</label>
        <div class="setting-row">
          <input type="password" id="settOpenaiKey" value="${escapeHtml(state.settings.openai.apiKey)}" placeholder="sk-..." />
          <button class="btn-sm btn-save-key" id="saveOpenaiKey">Save</button>
          <button class="btn-sm" id="testOpenai">Test</button>
          ${state.settings.openai.apiKey ? '<button class="btn-delete-key" id="deleteOpenaiKey" title="Remove API key">Delete</button>' : ''}
          <span class="test-result" id="testOpenaiResult"></span>
        </div>

        <label>Anthropic API Key</label>
        <div class="setting-row">
          <input type="password" id="settAnthropicKey" value="${escapeHtml(state.settings.anthropic.apiKey)}" placeholder="sk-ant-..." />
          <button class="btn-sm btn-save-key" id="saveAnthropicKey">Save</button>
          <button class="btn-sm" id="testAnthropic">Test</button>
          ${state.settings.anthropic.apiKey ? '<button class="btn-delete-key" id="deleteAnthropicKey" title="Remove API key">Delete</button>' : ''}
          <span class="test-result" id="testAnthropicResult"></span>
        </div>

        <div class="settings-section-header" style="margin-top: 16px;">Local LLM (Advanced)</div>
        <button class="settings-collapsible" id="ollamaToggle">
          <span class="collapsible-chevron">${ICONS.chevronRight}</span>
          Ollama Setup
        </button>
        <div class="settings-collapsible-body" id="ollamaSection">
          <div class="settings-warning">
            ${ICONS.warning} Requires additional configuration to work with Chrome extensions.
          </div>
          <label>Ollama URL</label>
          <div class="setting-row">
            <input type="text" id="settOllamaUrl" value="${escapeHtml(state.settings.ollama.url)}" placeholder="http://localhost:11434" />
            <button class="btn-sm" id="testOllama">Test</button>
            <span class="test-result" id="testOllamaResult"></span>
          </div>
          <button class="btn-sm setup-guide-btn" id="ollamaGuideBtn">${ICONS.externalLink} Setup Instructions</button>
        </div>

        <div class="settings-section-header" style="margin-top: 16px;">Security &amp; Privacy</div>
        <button class="settings-collapsible" id="securityToggle">
          <span class="collapsible-chevron">${ICONS.chevronRight}</span>
          How your data is protected
        </button>
        <div class="settings-collapsible-body" id="securitySection">
          <div class="security-info">
            <div class="security-item">
              <div class="security-item-icon">${ICONS.lock}</div>
              <div class="security-item-body">
                <div class="security-item-title">Encrypted at rest</div>
                <div class="security-item-desc">API keys are encrypted using AES-256-GCM before being saved to your browser's local storage.</div>
              </div>
            </div>
            <div class="security-item">
              <div class="security-item-icon">${ICONS.shield}</div>
              <div class="security-item-body">
                <div class="security-item-title">Extension sandboxed</div>
                <div class="security-item-desc">Chrome isolates each extension's storage. Other extensions, websites, and tabs cannot access BranchAI's data.</div>
              </div>
            </div>
            <div class="security-item">
              <div class="security-item-icon">${ICONS.database}</div>
              <div class="security-item-body">
                <div class="security-item-title">Local-only storage</div>
                <div class="security-item-desc">All data stays on this device. There are no BranchAI servers. Keys are only sent directly to the API provider you configure.</div>
              </div>
            </div>
            <div class="security-item">
              <div class="security-item-icon">${ICONS.externalLink}</div>
              <div class="security-item-body">
                <div class="security-item-title">Open source</div>
                <div class="security-item-desc">BranchAI's source code is fully open source.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <div class="modal-footer-left">
          <button class="btn-secondary" id="settExportBtn">Export</button>
          <button class="btn-secondary" id="settImportBtn">Import</button>
        </div>
        <button class="btn-primary" id="settSaveBtn">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close handlers
  modal.querySelector('.modal-close').onclick = () => { modal.style.display = 'none'; };
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

  // Ollama collapsible toggle
  const ollamaToggle = $('ollamaToggle');
  const ollamaSection = $('ollamaSection');
  ollamaToggle.onclick = () => {
    ollamaToggle.classList.toggle('open');
    ollamaSection.classList.toggle('open');
  };

  // Security collapsible toggle
  const securityToggle = $('securityToggle');
  const securitySection = $('securitySection');
  securityToggle.onclick = () => {
    securityToggle.classList.toggle('open');
    securitySection.classList.toggle('open');
  };

  // Ollama setup guide
  $('ollamaGuideBtn').onclick = () => openOllamaGuideModal();

  // Test buttons
  $('testOllama').onclick = () => _testProvider('ollama', { url: $('settOllamaUrl').value.trim() }, $('testOllamaResult'));
  $('testOpenai').onclick = () => _testProvider('openai', { apiKey: $('settOpenaiKey').value.trim() }, $('testOpenaiResult'));
  $('testAnthropic').onclick = () => _testProvider('anthropic', { apiKey: $('settAnthropicKey').value.trim() }, $('testAnthropicResult'));

  // Save individual API key buttons
  $('saveOpenaiKey').onclick = () => {
    _callbacks.onSaveApiKey?.('openai', { apiKey: $('settOpenaiKey').value.trim() });
  };
  $('saveAnthropicKey').onclick = () => {
    _callbacks.onSaveApiKey?.('anthropic', { apiKey: $('settAnthropicKey').value.trim() });
  };

  // Delete API key buttons
  const deleteOpenaiBtn = $('deleteOpenaiKey');
  if (deleteOpenaiBtn) {
    deleteOpenaiBtn.onclick = () => {
      if (!confirm('Remove your OpenAI API key? This cannot be undone.')) return;
      $('settOpenaiKey').value = '';
      state.settings.openai.apiKey = '';
      _callbacks.onSettingsSave?.();
      // Re-create modal to reflect changes
      modal.remove();
      openSettingsModal();
    };
  }
  const deleteAnthropicBtn = $('deleteAnthropicKey');
  if (deleteAnthropicBtn) {
    deleteAnthropicBtn.onclick = () => {
      if (!confirm('Remove your Anthropic API key? This cannot be undone.')) return;
      $('settAnthropicKey').value = '';
      state.settings.anthropic.apiKey = '';
      _callbacks.onSettingsSave?.();
      modal.remove();
      openSettingsModal();
    };
  }

  // Save button
  $('settSaveBtn').onclick = () => _callbacks.onSettingsSave?.();

  // Export / Import
  $('settExportBtn').onclick = () => _callbacks.onExport?.();
  $('settImportBtn').onclick = () => $('fileInput')?.click();
}

function openOllamaGuideModal() {
  const existing = $('ollamaGuideModal');
  if (existing) { existing.style.display = 'flex'; return; }

  const guide = document.createElement('div');
  guide.id = 'ollamaGuideModal';
  guide.className = 'modal-overlay';
  guide.innerHTML = `
    <div class="modal setup-guide-modal">
      <div class="modal-header">
        <h3>Ollama Setup Guide</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="guide-step">
          <div class="guide-step-num">1</div>
          <div class="guide-step-body">
            <div class="guide-step-title">Install Ollama</div>
            <p>Download and install from <a href="https://ollama.ai" target="_blank" rel="noopener">ollama.ai</a></p>
          </div>
        </div>

        <div class="guide-step">
          <div class="guide-step-num">2</div>
          <div class="guide-step-body">
            <div class="guide-step-title">Pull a model</div>
            <div class="guide-code">ollama pull llama3.2</div>
          </div>
        </div>

        <div class="guide-step">
          <div class="guide-step-num">3</div>
          <div class="guide-step-body">
            <div class="guide-step-title">Set OLLAMA_ORIGINS</div>
            <p>Chrome extensions need cross-origin access. Stop Ollama, then restart with:</p>
            <div class="guide-platform">
              <strong>macOS / Linux</strong>
              <div class="guide-code">OLLAMA_ORIGINS=* ollama serve</div>
            </div>
            <div class="guide-platform">
              <strong>Windows (PowerShell)</strong>
              <div class="guide-code">$env:OLLAMA_ORIGINS="*"; ollama serve</div>
            </div>
          </div>
        </div>

        <div class="guide-step">
          <div class="guide-step-num">4</div>
          <div class="guide-step-body">
            <div class="guide-step-title">Test the connection</div>
            <p>Go back to Settings and click "Test" next to the Ollama URL.</p>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <div></div>
        <button class="btn-primary" id="guideCloseBtn">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(guide);

  guide.querySelector('.modal-close').onclick = () => { guide.style.display = 'none'; };
  guide.addEventListener('click', (e) => { if (e.target === guide) guide.style.display = 'none'; });
  $('guideCloseBtn').onclick = () => { guide.style.display = 'none'; };
}

async function _testProvider(providerId, config, resultEl) {
  resultEl.textContent = 'testing...';
  resultEl.className = 'test-result';
  try {
    const provider = getProvider(providerId, config);
    const result = await provider.testConnection();
    if (result.ok) {
      resultEl.textContent = '\u2713 ' + (result.info || 'OK');
      resultEl.className = 'test-result test-ok';
    } else {
      resultEl.textContent = '\u2717 ' + (result.error || 'Failed');
      resultEl.className = 'test-result test-fail';
    }
  } catch (e) {
    resultEl.textContent = '\u2717 ' + e.message;
    resultEl.className = 'test-result test-fail';
  }
}

export function getSettingsValues() {
  return {
    ollama: { url: $('settOllamaUrl')?.value.trim() || 'http://localhost:11434' },
    openai: { apiKey: $('settOpenaiKey')?.value.trim() || '' },
    anthropic: { apiKey: $('settAnthropicKey')?.value.trim() || '' },
  };
}

// --- new project/branch modals ---

function openNewProjectModal(onSave) {
  _openCreateModal('New Project', 'Project name', onSave);
}

function openNewBranchModal(onSave) {
  _openCreateModal('New Branch', 'Branch name', onSave);
}

function _openCreateModal(title, namePlaceholder, onSave, opts = {}) {
  const existing = $('createModal');
  if (existing) existing.remove();

  const { defaultName = '', aiGenerate = null } = opts;

  const aiBtnHtml = aiGenerate ? `
    <button class="btn-ai-generate" id="aiGenerateBtn" type="button">
      ${ICONS.sparkle} Auto-generate with AI
    </button>` : '';

  const modal = document.createElement('div');
  modal.id = 'createModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="create-form">
          <input type="text" id="createName" placeholder="${escapeHtml(namePlaceholder)}" value="${escapeHtml(defaultName)}" autofocus />
          <textarea id="createDesc" placeholder="Summary (optional)" rows="3"></textarea>
          ${aiBtnHtml}
        </div>
      </div>
      <div class="modal-footer">
        <div></div>
        <button class="btn-primary" id="createSaveBtn">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.modal-close').onclick = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  $('createSaveBtn').onclick = () => {
    const name = $('createName').value.trim() || 'Untitled';
    const desc = $('createDesc').value.trim();
    modal.remove();
    onSave(name, desc, '');
  };

  $('createName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('createSaveBtn').click();
    }
  });

  if (aiGenerate) {
    const aiBtn = $('aiGenerateBtn');
    aiBtn.onclick = async () => {
      const descEl = $('createDesc');
      const originalHtml = aiBtn.innerHTML;
      aiBtn.disabled = true;
      aiBtn.innerHTML = `${ICONS.sparkle} Generating...`;
      try {
        const text = await aiGenerate();
        if (text) descEl.value = text;
      } catch (e) {
        descEl.placeholder = 'AI generation failed: ' + (e?.message || e);
      } finally {
        aiBtn.disabled = false;
        aiBtn.innerHTML = originalHtml;
      }
    };
  }

  setTimeout(() => {
    const el = $('createName');
    if (!el) return;
    el.focus();
    if (defaultName) el.select();
  }, 50);
}
