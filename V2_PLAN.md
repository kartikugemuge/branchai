# BranchAI v2 — Rebuild Documentation

## What is BranchAI?

A Chrome Extension that lets you fork ChatGPT conversations into a branching workspace backed by real LLM providers (Ollama, OpenAI, Anthropic). Previously called "StormAI v1", which used in-browser WebLLM (broken due to WebGPU requirements).

---

## Current State (Post Phase 8B + UI Enhancements + Bug Fixes + UI Redesign)

**Branch:** `v2_refactor`
**Status:** Phases 1–8B complete + Settings UX fixes + Privacy section on home page + Summarization bug fixes + Message duplication bug fix + Model dropdown regression fix + UI Redesign (emoji removal, per-API-key save buttons, workspace/sidebar layout with expandable project tree). Project/branch/message data stored in IndexedDB (per-record read/write). Settings in `chrome.storage.local`. One-time migration from legacy blob runs automatically on first boot. API keys encrypted at rest (AES-256-GCM). Content script integration (Phase 4) still needs live testing on ChatGPT.

### File structure

```
branchai/
  manifest.json                         # Unified MV3 manifest
  app/
    index.html                          # Main UI (home screen + workspace with sidebar)
    app.css                             # Dark-first CSS with custom properties
    src/
      main.js                           # Entry point, provider orchestration, screen-based boot
      state.js                          # State management, IndexedDB + chrome.storage.local persistence
      ui.js                             # Screen-based DOM rendering (XSS-safe)
      utils.js                          # Helpers (genId, escapeHtml, timeAgo, etc.)
      router.js                         # Minimal screen-based view manager (NEW in Phase 6)
      icons.js                          # Inline SVG icon strings (extended: shieldCheck, userX, code, chevronLeft, home)
      crypto.js                         # AES-256-GCM encryption for API keys at rest (NEW in Phase 8A)
      db.js                             # IndexedDB wrapper for per-record storage (NEW in Phase 8B)
      migration.js                      # One-time migration from chrome.storage.local to IndexedDB (NEW in Phase 8B)
      export_import.js                  # Project export/import with extended fields
      providers/
        base.js                         # Abstract provider interface
        registry.js                     # Provider factory + cache
        ollama.js                       # Ollama HTTP provider (streaming)
        openai.js                       # OpenAI provider (streaming SSE)
        anthropic.js                    # Anthropic provider (streaming SSE)
  bg/
    background.js                       # Service worker (icon click + context handoff)
  content/
    content.js                          # ChatGPT page injector
    content.css                         # Branch button styling
  icons/
    icon16.png, icon48.png, icon128.png # Placeholder icons
  mockups/                              # UI reference mockups (untracked)
```

### Old files (still present, untouched)

```
branch-host/          # Old web app (will be removed eventually)
branch-chat-ext/      # Old Chrome extension (replaced by new root-level structure)
```

---

## Phase History

### Bugs fixed in Phase 1

| Bug | Fix |
|-----|-----|
| Models don't run (WebLLM/WebGPU) | Replaced with HTTP-based Ollama provider |
| `newBranch({object})` call mismatch | Fixed to `newBranch(title, seedMessages)` positional args everywhere |
| XSS in transcript (`innerHTML`) | All content passed through `escapeHtml()` |
| `buildMessages()` caps at 12 msgs | Sends ALL branch messages now |
| localStorage only | `chrome.storage.local` with localStorage fallback |

### Bugs fixed in Phase 2

| Bug | Fix |
|-----|-----|
| Ollama config key mismatch (`ollamaUrl` vs `url`) | `ollama.js` now reads `this.config.url` to match settings shape |
| Shared message refs between branches (shallow copy) | `newBranch()` and `newProject()` deep-copy with `.map(m => ({...m}))` |
| Stale output on branch switch | `renderAll()` clears `$('out')` on every render |

---

## Phase 3: Cloud providers (OpenAI + Anthropic) — DONE

### New files
| File | Description |
|------|-------------|
| `app/src/providers/openai.js` | OpenAI provider — `Bearer` auth, `GET /models` (filtered to `gpt-*`), `/chat/completions` streaming (SSE `data:` lines, `[DONE]` sentinel), uses `max_completion_tokens`, omits `temperature` by default to support reasoning models (o1/o3/o4) |
| `app/src/providers/anthropic.js` | Anthropic provider — `x-api-key` + `anthropic-version` + `anthropic-dangerous-direct-browser-access` headers, hardcoded model list (Sonnet 4, Haiku 3.5, Opus 3, 3.5 Sonnet, 3 Haiku), `_prepareMessages()` extracts system → top-level `system` field + merges consecutive same-role messages, SSE via `event: content_block_delta` / `event: message_stop`, `testConnection()` sends minimal 1-token request |

### Modified files
| File | Change |
|------|--------|
| `app/src/providers/registry.js` | Imported + registered `OpenAIProvider` and `AnthropicProvider` in `providerClasses` |
| `app/src/ui.js` | Added `getProvider` import; settings modal inputs wrapped in `.setting-row` with "Test" button + result `<span>` per provider; `_testProvider()` helper; `onBranchSwitch` callback called at end of `renderAll()` |
| `app/src/main.js` | `populateModels()` accepts optional `selectModelId`; new `syncBranchProvider()` restores branch provider/model on switch; `sendMessage()` uses branch `provider`/`model` with fallback to global; `onProviderChange`/`onModelChange` save to current branch; removed hardcoded `temperature: 0.7` from `sendMessage()` |
| `app/app.css` | Added `.setting-row`, `.btn-sm`, `.test-result`, `.test-ok`, `.test-fail` styles |

### Bugs fixed during Phase 3
| Bug | Fix |
|-----|-----|
| OpenAI rejects `max_tokens` on newer models | Changed to `max_completion_tokens` |
| OpenAI reasoning models (o1/o3/o4) reject custom `temperature` | Temperature only sent when explicitly provided by caller; removed hardcoded `0.7` from `sendMessage()` |

---

## Phase 4: Content script integration — NEEDS TESTING

- Test ChatGPT page → branch button → extension opens with scraped context
- Verify `chrome.storage.session` handoff from background.js to app page
- Verify late context injection (ctx-ready event)

---

## Phase 5: Export/import + hardening — DONE

### New files
| File | Description |
|------|-------------|
| `app/src/export_import.js` | `exportCurrentProject()` serializes active project to JSON Blob and triggers download as `{name}.branchai.json`. `importFromFile(file)` reads JSON via FileReader, validates shape (`name` + `branches`), assigns fresh IDs via `genId()` to avoid collisions, pushes into state, sets as active, persists. |

### Modified files
| File | Change |
|------|--------|
| `app/src/main.js` | `onImport` handler now calls `renderAll()` after successful import, with try/catch showing errors inline in output pane. Added `setCurrentModelId` import + calls wherever `currentModelId` changes (populateModels, syncBranchProvider, onModelChange). |
| `app/src/providers/ollama.js` | `listModels()`, `chat()`, `chatStream()` wrap `fetch` in try/catch — network failures throw `"Ollama not running at {url}"`. HTTP 404 → `"Model not found"`. |
| `app/src/providers/openai.js` | Same try/catch pattern in `listModels()`, `chat()`, `chatStream()` — network failures throw `"Cannot reach OpenAI API"`. 401 → `"Invalid OpenAI API key"` / `"Invalid API key"`, 429 → `"Rate limited — try again shortly"`, 404 → `"Model not found"`. |
| `app/src/providers/anthropic.js` | `chat()` and `chatStream()` wrap fetch in try/catch — network errors → `"Cannot reach Anthropic API"`, 401 → `"Invalid Anthropic API key"`, 429 → `"Rate limited — try again shortly"`, 400 → parsed error detail from response body. |
| `app/src/utils.js` | Added `TOKEN_LIMITS` map (`claude-` → 200k, `gpt-4` → 128k, `gpt-3.5` → 16385, default 8192) and exported `getTokenLimit(modelId)`. |
| `app/src/ui.js` | Added `_currentModelId` state + `setCurrentModelId()` export. `updateTokenInfo()` now shows `~{tokens} / {limit} tokens` with color classes: `token-ok` (<50%), `token-warn` (50–80%), `token-danger` (>80%). `renderBranches()` shows `"No branches yet"` when empty. `renderAll()` shows `"Connect a provider in Settings"` hint when modelSel is `--`. |
| `app/app.css` | Added `.token-ok` (green), `.token-warn` (amber), `.token-danger` (red) classes. |

---

## Phase 6: UI/UX Rework — DONE

### Goal

Replaced the cramped 3-pane layout with a 3-screen navigation flow matching the mockups:
1. **Home** — Project cards (grid/list)
2. **Project** — Branch cards within a project (grid/list)
3. **Chat** — Full-width chat view with streaming responses

### Reference Mockups

See `mockups/` folder:
- `10.10.40` — Home screen, grid view (project cards with gradients, emojis, branch count, time ago)
- `10.10.49` — Home screen, list view (full-width rows)
- `10.11.03` — Project detail / branches screen (branch cards with message count, time ago, branched-from indicator)
- `10.12.03` — Chat view (breadcrumb nav, purple user bubbles, AI bubbles, input bar at bottom)

---

### Sub-phase 6.1: State Model + Utils — DONE

**Files modified:** `app/src/state.js`, `app/src/utils.js`, `app/src/export_import.js`

#### state.js changes
- **Project** — added `description` (string), `emoji` (string), `updatedAt` (timestamp)
- **Branch** — added `description` (string), `emoji` (string), `updatedAt` (timestamp), `branchedFromMsg` (number|null)
- **State** — added `viewMode: 'grid'|'list'`, default `darkMode: true` (dark-first)
- `newProject(name, seedMessages, firstBranchTitle, { description, emoji })` — accepts options object as 4th param; sets `updatedAt`, assigns emoji via `pickDefaultEmoji()` if not provided
- `newBranch(title, seedMessages, branchedFromMsg, { description, emoji })` — accepts `branchedFromMsg` as 3rd param and options as 4th; sets `updatedAt`, also updates parent project's `updatedAt`
- `normalizeState()` — backfills `description`, `emoji`, `updatedAt`, `branchedFromMsg` on all projects/branches for backward compatibility with old saved state

#### utils.js changes
- Added `pickDefaultEmoji()` — rotates through 8 emojis (rocket, bulb, palette, lightning, chart, wrench, star, memo)
- Added `timeAgo(ts)` — returns human-readable strings: "just now", "5m ago", "2h ago", "3d ago", "1mo ago"

#### export_import.js changes
- Export now includes `description`, `emoji`, `updatedAt`, `branchedFromMsg` for projects and branches
- Import defaults missing fields (`description: ''`, `emoji` via `pickDefaultEmoji()`, `updatedAt` from `createdAt` or `now()`, `branchedFromMsg: null`)

---

### Sub-phase 6.2: Router — DONE

**New file:** `app/src/router.js` (24 lines)

- `SCREENS = { HOME: 'home', PROJECT: 'project', CHAT: 'chat' }`
- `navigateTo(screen)` — sets current screen, skips if already there, fires registered callbacks
- `onScreenChange(cb)` — register listener
- `getCurrentScreen()` — getter
- Initial screen is `HOME`

---

### Sub-phase 6.3: HTML Restructure — DONE

**File rewritten:** `app/index.html`

Replaced the 3-column `<div class="wrap">` grid with:
```html
<html class="dark">
<header id="appHeader">                   <!-- dynamic content per screen -->
<main id="screen-home" class="screen active">
  <div class="screen-inner">
    <div id="home-content"></div>
  </div>
</main>
<main id="screen-project" class="screen">
  <div class="screen-inner">
    <div id="project-content"></div>
  </div>
</main>
<main id="screen-chat" class="screen">
  <div class="chat-container">
    <div class="chat-subtitle" id="chatSubtitle"></div>
    <div class="chat-messages" id="chatMessages"></div>
    <div class="chat-input-bar">
      <textarea id="chatInput" ...></textarea>
      <button class="send-btn" id="sendBtn"></button>
    </div>
  </div>
</main>
<input type="file" id="fileInput" hidden>
```

Removed elements: `.wrap`, `.pane`, `#leftPane`, `#transcript`, `#extra`, `#out`, `#runBtn`, `#copyBtn`, `#importBtn`, `#exportBtn`, `#darkModeToggle`, `#providerSel`/`#modelSel` (now rendered dynamically in header), `#projectName`, `#tokenInfo` (now in header), `#newProjectBtn`/`#newBranchBtn` (now in header).

---

### Sub-phase 6.4: CSS Rewrite — DONE

**File rewritten:** `app/app.css` (~800 lines)

Dark-first design with CSS custom properties:

| Section | Details |
|---------|---------|
| Custom properties (`:root`) | `--bg: #0a0a0f`, `--surface: #14141f`, `--accent: #7c3aed` (purple), `--text: #e8e8ed`, `--border: #222235`, etc. |
| Light theme (`html.light`) | `--bg: #f8f9fb`, `--surface: #ffffff`, `--accent: #7c3aed`, light card gradients |
| Header | Sticky, `.header-left` (logo/breadcrumb), `.header-right` (actions, margin-left: auto) |
| Breadcrumb | `.breadcrumb` with links, separator chevrons, `.current` bold |
| View toggle | `.view-toggle` button group, `.active` state |
| Header selects | `.header-select` with styled `<select>` for provider/model |
| Status pill | `.status-pill` with `.status-ok` / `.status-bad` / `.status-connecting` |
| Screen system | `.screen` hidden, `.screen.active` visible, `.screen-inner` max-width 1100px |
| Page titles | `.page-title` 28px bold, `.page-subtitle` 15px muted |
| Cards (grid) | `.cards-grid` responsive grid (minmax 300px), `.project-card` / `.branch-card` with gradient backgrounds |
| Card gradients | 4 variants by `:nth-child(4n+N)`: purple-dark, teal-dark, green-dark, rose-dark |
| Card elements | `.card-emoji` 28px, `.card-name` 18px bold, `.card-desc`, `.card-meta` with icon+text spans |
| Active dot | `.active-dot` green circle on active branch card |
| Card delete | `.card-delete` absolute positioned, opacity 0 → 1 on hover |
| Cards (list) | `.cards-list` flex column, `.list-row` with emoji, body, meta, delete button |
| Chat layout | `.chat-container` flex column full height, max-width 840px |
| Chat subtitle | `.chat-subtitle` with branched-from info and message count |
| Message bubbles | `.msg-row.user` right-aligned purple, `.msg-row.assistant` left-aligned dark surface |
| Message avatars | `.msg-avatar` 32px circles, purple for user, surface-alt for AI |
| Message actions | `.msg-actions` absolute positioned, opacity 0 → 1 on hover, `.msg-action-btn` pill buttons |
| Streaming cursor | `.streaming-cursor::after` blinking dot animation |
| Chat input bar | `.chat-input-bar` fixed bottom, auto-resize textarea, `.send-btn` round purple 44px |
| Settings modal | `.modal-overlay` / `.modal` with updated dark styling |
| Dark mode toggle | `.dark-mode-row` with `.toggle-switch` slider in settings modal |
| Create modals | `.create-form` with text input, textarea, `.emoji-grid` with `.emoji-option` selectable tiles |
| Scrollbar | Thin 6px custom scrollbar matching theme |

---

### Sub-phase 6.5: UI Rewrite + Icons — DONE

**New file:** `app/src/icons.js`
- Exports `ICONS` object with inline SVG strings for: `gitBranch`, `gitFork`, `clock`, `message`, `grid`, `list`, `plus`, `arrowUp`, `backArrow`, `chevronRight`, `gear`, `copy`

**File rewritten:** `app/src/ui.js` (~640 lines)

#### Architecture change
- Old: `bindStaticControls()` + `renderProjects()` / `renderBranches()` / `renderTranscript()` for 3 panes
- New: `setCallbacks()` + `renderAll()` dispatches to screen-specific renderers; header rendered dynamically per screen

#### Header rendering (`renderHeader()`)
- **HOME**: "BranchAI" logo + grid/list toggle + settings gear + "+ New Project" button
- **PROJECT**: Back arrow + "Projects" link + chevron + `[emoji] Project Name` + grid/list toggle + settings gear + "+ New Branch" button
- **CHAT**: Back arrow + "Projects" link + chevron + project link + chevron + `[emoji] Branch Name` + provider select + model select + status pill + token badge + settings gear

#### `wireHeaderEvents()`
Called after each header render. Binds: logo click → HOME, nav links → HOME/PROJECT, view toggle → update `state.viewMode` + re-render, settings button → open modal, new project/branch buttons → open create modals, provider/model selects → callbacks to main.js

#### `renderProjectsScreen()`
- Title "Your Projects" + subtitle
- Grid mode: `.cards-grid` with `.project-card` (emoji, name, description, branch count, time ago, delete button)
- List mode: `.cards-list` with `.list-row` (emoji, name, description, meta, delete)
- Click card → set `activeProjectId`, navigate to PROJECT
- Delete button → confirm dialog → `deleteProject()`

#### `renderBranchesScreen()`
- Title "Branches" + project description subtitle
- Grid/list cards with: emoji, title, description, message count, time ago, branched-from indicator, active green dot
- Click → set `activeBranchId`, navigate to CHAT
- Delete button → confirm → `deleteBranch()`

#### `renderChatScreen()`
- Subtitle bar: "Branched from msg N · M messages"
- Message bubbles: `.msg-row.user` (purple, right, "You" avatar) / `.msg-row.assistant` (dark, left, "AI" avatar)
- Hover actions per message: "Branch" button (creates branch with `branchedFromMsg`) + "Copy" button (assistant only, clipboard)
- Auto-scrolls to bottom after render
- Updates token info badge
- Sets send button SVG icon

#### Streaming
- `appendStreamingBubble()` — adds new assistant `.msg-row` with `#streaming-content` bubble + `.streaming-cursor` class
- `updateStreamingContent(text)` — updates textContent + auto-scrolls

#### `openSettingsModal()`
- Dark mode toggle (checkbox with slider switch)
- Ollama URL, OpenAI key, Anthropic key inputs with Test buttons
- Export Project / Import Project buttons in footer
- Save button
- `_testProvider()` helper validates connections with visual feedback

#### `openNewProjectModal()` / `openNewBranchModal()`
- Modal with: name input, description textarea, emoji picker (8 options grid)
- Enter key submits
- On save: calls callback with (name, description, emoji), navigates to next screen

#### Exports
`setCurrentModelId`, `setCallbacks`, `renderAll`, `setModelStatus`, `appendStreamingBubble`, `updateStreamingContent`, `openSettingsModal`, `getSettingsValues`

---

### Sub-phase 6.6: Main.js Updates — DONE

**File rewritten:** `app/src/main.js` (~390 lines)

#### `sendMessage()`
- Reads from `$('chatInput')` instead of old `$('extra')`
- Clears input + auto-resizes textarea after read
- Pushes user message → persist → `renderAll()` (shows bubble immediately)
- Calls `appendStreamingBubble()` before streaming starts
- `onToken` callback → `updateStreamingContent(text)` (real-time bubble update)
- On complete: reads `#streaming-content` textContent, pushes assistant message, updates `b.updatedAt` + `p.updatedAt`, persists, full re-render
- Error: updates streaming bubble with error text, sets status to bad
- Disables send button during generation

#### Callback system (`setCallbacks`)
Replaced old `bindStaticControls()` with `setCallbacks()`:
- `onProviderChange` — activates provider, saves to branch
- `onModelChange` — updates `currentModelId`, saves to branch and global default
- `onSettingsSave` — reads settings form, updates state, re-activates provider
- `onDarkModeChange` — updates `darkMode` setting, calls `applyTheme()`
- `onExport` — lazy-imports `export_import.js`, calls `exportCurrentProject()`

#### Provider/model management
- `populateProviders()` / `populateModels()` — null-check `$('providerSel')` / `$('modelSel')` since they only exist on CHAT screen
- `_cachedModels` array — models fetched once on `activateProvider()`, reused via `repopulateModelsFromCache()` when re-entering CHAT screen (avoids redundant API calls)
- `syncBranchProvider()` — restores branch's saved provider/model into header dropdowns on CHAT entry

#### Screen change listener (`onScreenChange`)
- On navigate to CHAT: `populateProviders()` → `repopulateModelsFromCache()` → `syncBranchProvider()` → `wireChatInput()`
- Always calls `renderAll()` on any screen change

#### Chat input wiring (`wireChatInput()`)
- Enter → send (Shift+Enter → newline)
- `oninput` → `autoResizeTextarea()` (height auto-adjusts up to 150px max)
- Send button click → `sendMessage()`
- Re-wired on each CHAT screen entry (since DOM is rebuilt)

#### Boot sequence
1. `getInjectedContext()` — checks `chrome.storage.session`, window globals, sessionStorage (unchanged)
2. `loadInitial()` with injected context
3. `applyTheme()` — toggles `html.dark` / `html.light` classes
4. `activateProvider()` eagerly (caches models internally for later)
5. If injected context → `navigateTo(CHAT)` (fires `onScreenChange` → render + wire)
6. Else → `renderAll()` manually (HOME is default, `navigateTo` skips since already HOME)
7. Late context listeners: `branchai:ctx-ready` event + `CTX_READY` message from background

#### Dark mode
- No more standalone toggle button in header
- Moved to settings modal as toggle switch checkbox
- `applyTheme()` sets both `dark` and `light` classes on `<html>` for CSS specificity

---

### Sub-phase 6.7: Feature Preservation — VERIFIED

All features from the old 3-pane UI preserved in the new screen-based UI:

| Feature | Old Location | New Location | Status |
|---------|-------------|-------------|--------|
| Export project | Header button `#exportBtn` | Settings modal footer "Export Project" button → `onExport` callback | Done |
| Import project | Header button `#importBtn` + `#fileInput` | Settings modal footer "Import Project" button → triggers `#fileInput` | Done |
| Copy message | `#copyBtn` (copied latest output) | Hover action on each assistant bubble → `navigator.clipboard.writeText()` per message | Done |
| Token info | `#tokenInfo` badge in mid-pane toolbar | `#tokenInfo` badge in chat screen header, with ok/warn/danger colors | Done |
| Content script injection | `getInjectedContext()` → `loadInitial()` | Unchanged logic, now navigates to CHAT screen on context received | Done |
| Branch from message | "branch here" button per transcript message | "Branch" hover button per chat bubble, creates branch with `branchedFromMsg` index | Done |
| Delete project | `×` button on project list item | `×` hover button on project card/row with confirm dialog | Done |
| Delete branch | `×` button on branch list item | `×` hover button on branch card/row with confirm dialog | Done |
| Dark/light mode | `#darkModeToggle` button in header | Toggle switch in settings modal, `onDarkModeChange` callback | Done |
| Per-branch provider/model | Saved on branch object, restored via `syncBranchProvider()` | Same logic, `syncBranchProvider()` called on CHAT screen entry | Done |
| Settings modal | `#settingsBtn` in header → modal | `#settingsBtn` (gear icon) in header on all screens → same modal with updated styling | Done |
| Streaming responses | `onToken` → `$('out').textContent` | `appendStreamingBubble()` + `updateStreamingContent()` → chat bubble with blinking cursor | Done |
| Auto-scroll | `#transcript` scrollTop on render | `#chatMessages` scrollTop on render + on each streaming token | Done |

---

## Key Architecture Decisions

- **API calls from extension page, not service worker:** MV3 service workers die after 30s idle. Extension pages stay alive. `host_permissions` bypasses CORS from extension pages.
- **No token limit in MVP:** Send all messages, let the API error if too long. Token windowing is a later enhancement.
- **Vanilla JS:** Codebase is ~2000 lines total across 10 source files. No framework needed.
- **IndexedDB for data, chrome.storage.local for settings:** Conversations/projects stored per-record in IndexedDB (no size limit, granular writes). Settings stay in chrome.storage.local (small, fast boot read). Compat shim keeps ui.js unchanged.
- **Screen-based navigation over 3-pane layout:** Each screen gets full viewport width. Header content changes per screen. Router is ~25 lines with callback pattern.
- **Callback pattern over direct imports:** `ui.js` doesn't import from `main.js`. Instead, `main.js` registers callbacks via `setCallbacks()` that `ui.js` invokes on user actions. Avoids circular dependencies.
- **Cached model lists:** Provider models fetched once on `activateProvider()`, stored in `_cachedModels`. Re-entering CHAT screen repopulates selects from cache via `repopulateModelsFromCache()` without re-fetching.

---

## How to Test (Full)

1. Load extension in `chrome://extensions` (Developer mode), click icon
2. **Home screen**: see project cards in grid view, toggle to list view, create new project with name/description/emoji picker
3. **Click project**: see branches screen with breadcrumb nav, branch cards with metadata (message count, time ago, branched-from indicator)
4. **Click branch**: see chat view with message bubbles, type message, get streaming response in purple/dark bubbles
5. **Branch from message**: hover any message → click "Branch" → navigates to project screen → new branch with correct `branchedFromMsg`
6. **Copy message**: hover assistant message → click "Copy" → text copied to clipboard
7. **Persistence**: close tab, reopen → state restored, projects/branches intact
8. **Settings**: gear icon → modal with dark mode toggle, provider configs, test buttons, export/import
9. **Export/Import**: export project from settings → JSON file downloaded; import → new project appears
10. **Content script**: open ChatGPT, click branch button on a message → extension opens at chat screen with scraped context

---

## Post-Phase 6: UI Refinements — DONE

### Tabular list view

Replaced the old `.cards-list` / `.list-row` list mode with a proper data table layout for both screens:

- **Projects table** — columns: PROJECT, DESCRIPTION, BRANCHES, UPDATED
- **Branches table** — columns: BRANCH, SUMMARY, MESSAGES, ORIGIN, UPDATED

CSS uses `.data-table` container with `.table-header` / `.table-row` using `display: grid`. Column widths set per table type (`.projects-table` 4-col, `.branches-table` 5-col). Active branch gets a green left border (`.row-active`). Delete button appears on row hover.

Grid view (cards) is unchanged and still available via the toggle.

### Bug fixes

| Bug | Fix |
|-----|-----|
| Theme toggle did nothing | `ui.js` called `_callbacks.onThemeToggle()` but main.js registered `onDarkModeChange` — fixed callback name |
| Sun/moon icon didn't update after toggle | Added `renderAll()` call after `applyTheme()` in `onDarkModeChange` |
| Model dropdown stuck on "loading..." | Redundant `renderAll()` after `navigateTo()` destroyed populated selects — removed 5 redundant calls in ui.js |
| Status pill reset to "starting..." on re-render | Added `replayModelStatus()` after `renderChatScreen()` in `renderAll()` |
| Breadcrumb chevron SVG unsized | Added `display: flex` and `svg { width: 14px }` to `.breadcrumb .sep` |
| Message action button SVGs unsized | Added `.msg-action-btn svg { width: 12px; height: 12px }` |
| Chat selects empty after theme toggle | Added select repopulation (`populateProviders` + `repopulateModelsFromCache` + `wireChatInput`) to `onDarkModeChange` when on chat screen |

---

## Auto-Summarization for Branches — DONE

### New file: `app/src/summarize.js`

Single exported function: `summarizeBranch(provider, model, branch)`.

Takes the branch's conversation (up to 20 messages), sends a summarization prompt to `provider.chat()` (non-streaming, max 60 tokens, temperature 0.3), returns a one-line summary string. Includes branch-point context if `branchedFromMsg` is set. Returns `''` on failure.

### Data model changes (`state.js`)

Added two fields to each branch object (backfilled via `normalizeState`):

| Field | Type | Purpose |
|-------|------|---------|
| `b.summary` | `string` | AI-generated summary, separate from user-editable `b.description` |
| `b.summaryMsgCount` | `number` | Message count when summary was last generated; skips re-summarization of unchanged branches |

### Trigger points

**Primary — after chat send** (`main.js`, inside `sendMessage()` after assistant response is saved):
- Fire-and-forget: if `b.messages.length !== b.summaryMsgCount`, calls `summarizeBranch()` in the background, updates `b.summary` and `b.summaryMsgCount` on success, persists.

**Secondary — lazy fill on PROJECT screen entry** (`main.js`, `lazySummarizeBranches()`):
- On `onScreenChange(PROJECT)`, iterates all branches in the current project. Any branch with messages but stale/missing summary gets a background `summarizeBranch()` call. On success, updates fields, persists, and re-renders.

### Display

- **Table list view**: Summary column shows `b.summary || b.description || ''`
- **Grid card view**: Card description shows `b.summary || b.description || ''`
- **Expandable summaries**: In table view, a small inline chevron (`>`) appears before truncated summary text. Clicking it toggles `.expanded` on the row — the chevron rotates 90 degrees and the summary text wraps within its column bounds (no overflow into other columns).

### Export/import (`export_import.js`)

`summary` and `summaryMsgCount` included in both export and import, defaulting to `''` / `0` if missing.

---

## Post-Phase 6.2: Provider Switching Bug Fixes — DONE

### Bugs fixed

| Bug | Root Cause | Fix |
|-----|------------|-----|
| Model not found (404) when using OpenAI after switching from Ollama | Branch's `model` field retained old provider's model name (e.g., 'llama3.2') which doesn't exist on the new provider | `onProviderChange` now validates model from dropdown; `sendMessage()` validates `b.model` against `_cachedModels` and falls back to UI selection |
| Model dropdown stuck on "loading..." | `repopulateModelsFromCache()` returned early when `_cachedModels` was empty, leaving the default "loading..." text | Now shows "no models available" when cache is empty; `onScreenChange` triggers fresh `populateModels()` if cache is empty |
| Ollama 403 error without helpful message | Ollama CORS restrictions cause 403 when `OLLAMA_ORIGINS` not set | Added specific error message: "Ollama rejected request (403). Try setting OLLAMA_ORIGINS=* when starting Ollama" |
| Branch model mismatch after provider switch | `syncBranchProvider()` didn't validate if saved model exists in current provider | Now validates model against available options; updates branch if model doesn't exist |

### Files modified

| File | Changes |
|------|---------|
| `app/src/main.js` | `onProviderChange` validates new model; `sendMessage()` validates model against cache; `repopulateModelsFromCache()` shows proper message when empty; `syncBranchProvider()` validates model existence; `onScreenChange`/`onDarkModeChange`/late context handlers now fetch models if cache empty |
| `app/src/providers/ollama.js` | Added 403-specific error message with OLLAMA_ORIGINS hint in both `chat()` and `chatStream()` |

---

## Phase 7: Ollama UX Improvements — DONE

### Problem

Ollama requires users to set `OLLAMA_ORIGINS=*` environment variable before it works with Chrome extensions. This causes 403 errors and confusion for users who don't know about this requirement.

### Goal

Make cloud providers (OpenAI, Anthropic) the default experience. Keep Ollama as an "advanced" option with clear setup guidance.

### Sub-phase 7.1: Default Provider Change — DONE

**File:** `app/src/state.js`

- Changed `activeProvider: 'ollama'` → `activeProvider: 'openai'` in both default state and `normalizeState()` fallback
- First-time users now see OpenAI selected (prompts them to enter API key)

### Sub-phase 7.2: Settings Modal Reorganization — DONE

**File:** `app/src/ui.js` (openSettingsModal function)

New layout:
```
── Cloud Providers ──────────────────────
OpenAI API Key: [input] [Test]
Anthropic API Key: [input] [Test]

── Local LLM (Advanced) ─────────────────
▶ Ollama Setup  [collapsed by default]
   ⚠ Requires additional configuration
   [Ollama URL input] [Test]
   [Setup Instructions button]
```

Changes:
- Reordered: OpenAI and Anthropic first under "Cloud Providers" section header
- Ollama grouped under collapsible "Local LLM (Advanced)" section with chevron toggle
- Added amber warning banner indicating additional configuration required
- Added "Setup Instructions" button that opens in-app guide modal

### Sub-phase 7.3: Ollama Setup Instructions — DONE

**Implemented:** Option A (in-app modal via `openOllamaGuideModal()`)

Step-by-step guide covers:
1. Install Ollama (link to ollama.ai)
2. Pull a model (`ollama pull llama3.2`)
3. Set `OLLAMA_ORIGINS=*` with copy-paste commands for macOS/Linux and Windows PowerShell
4. Test the connection via Settings

Modal uses numbered step circles (accent purple) with monospace code blocks (`user-select: all` for easy copy).

### Sub-phase 7.4: CSS Updates — DONE

**File:** `app/app.css`

| Class | Purpose |
|-------|---------|
| `.settings-section-header` | Uppercase 11px section divider with bottom border |
| `.settings-collapsible` | Full-width button with chevron, toggles `.open` class |
| `.collapsible-chevron` | Inline SVG chevron that rotates 90deg when `.open` |
| `.settings-collapsible-body` | Hidden by default (`display: none`), shown as flex column when `.open` |
| `.settings-warning` | Amber background/border banner with warning icon, 12px text |
| `.setup-guide-btn` | Inline flex button with external link icon |
| `.setup-guide-modal` | Modal container for the guide |
| `.guide-step` | Flex row with numbered circle + body content |
| `.guide-step-num` | 28px accent purple circle with step number |
| `.guide-code` | Monospace code block with `user-select: all` for easy copying |
| `.guide-platform` | Platform-specific command section |

### New file changes

| File | Changes |
|------|---------|
| `app/src/state.js` | Changed default `activeProvider` from `'ollama'` to `'openai'` (2 locations) |
| `app/src/icons.js` | Added `warning` (alert triangle) and `externalLink` (arrow-out-of-box) icons |
| `app/src/ui.js` | Reorganized `openSettingsModal()` — cloud providers first, Ollama in collapsible section; added `openOllamaGuideModal()` function |
| `app/app.css` | Added ~120 lines of styles for settings sections, collapsible, warning, and setup guide modal |

---

## Phase 8A: API Key Encryption + Security Info — DONE

### Problem

API keys for OpenAI and Anthropic were stored as plaintext strings in `chrome.storage.local`. While Chrome's per-extension sandbox prevents other extensions from reading this data, the keys were plaintext on disk (LevelDB files in the Chrome profile). No security documentation existed for users.

### Goal

Encrypt API keys at rest using AES-256-GCM + add a Security & Privacy info section in the settings modal.

### New file: `app/src/crypto.js` (~83 lines)

Encryption module using Web Crypto API (AES-256-GCM).

**Key derivation strategy — deterministic key + session cache:**
1. On first run, generates 16 random bytes (`installSalt`) via `crypto.getRandomValues()`, persists to `chrome.storage.local` under key `branchai_install_salt`
2. Derives AES-256 key via HKDF: `ikm = chrome.runtime.id`, `salt = installSalt`, `info = "branchai-api-key-encryption-v1"`
3. Caches derived `CryptoKey` in module-level variable (lives as long as the page is open)

**Dev fallback:** If `chrome.runtime.id` is undefined (running outside extension context), `encrypt()` returns plaintext as-is — mirrors existing `localStorage` fallback pattern in `state.js`. `decrypt()` warns and returns empty string.

**Exports:**
| Function | Signature | Description |
|----------|-----------|-------------|
| `encrypt` | `(plaintext) → { _enc: true, iv: '<base64>', ct: '<base64>' }` | Encrypts a string; returns plaintext if outside extension context or empty |
| `decrypt` | `({ _enc, iv, ct }) → string` | Decrypts an encrypted object back to plaintext |
| `isEncrypted` | `(value) → boolean` | Checks for `_enc: true` marker |

### Modified files

| File | Changes |
|------|---------|
| `app/src/state.js` | Added `import { encrypt, decrypt, isEncrypted } from './crypto.js'`. New `encryptApiKeys(settings)` replaces `.openai.apiKey` and `.anthropic.apiKey` with encrypted objects. New `decryptApiKeys(settings)` reverses. `persist()` clones state and encrypts keys before writing. `loadFromStorage()` decrypts after reading. **Backward compat:** plain string keys pass through unchanged; auto-encrypt on next `persist()`. |
| `app/src/icons.js` | Added 3 SVG icons: `lock` (padlock), `shield` (security shield), `database` (storage icon) |
| `app/src/ui.js` | Added collapsible "Security & Privacy" section to settings modal between Local LLM section and footer. Contains 4 items: Encrypted at rest (lock icon), Extension sandboxed (shield icon), Local-only storage (database icon), Open source (external link icon). Uses same `.settings-collapsible` pattern as Ollama section. |
| `app/app.css` | Added ~35 lines: `.security-info` container, `.security-item` flex row, `.security-item-icon` (accent colored, 20px), `.security-item-body`, `.security-item-title` (13px bold), `.security-item-desc` (12px muted) |

### Files NOT changed (no changes needed)

- `manifest.json` — Web Crypto API needs no extra permissions
- All provider files — they read decrypted in-memory `this.config.apiKey`
- `background.js`, `content.js`, `router.js`, `utils.js`, `summarize.js`, `export_import.js`

### Verification

1. **Encryption works**: Enter API key → close/reopen extension → key persists and works for API calls
2. **Storage encrypted**: DevTools → Application → Extension Storage → `branchai_state_v2` → API key values show `{ _enc: true, iv: "...", ct: "..." }` not plaintext
3. **Backward compat**: Existing install with plaintext keys → update extension → keys auto-encrypt on next persist, no user action needed
4. **Dev fallback**: Run `app/index.html` directly in browser → keys stored as plaintext (no crash)
5. **Security info**: Open settings → "Security & Privacy" collapsible section visible with 4 items
6. **Provider test**: After encryption, "Test" buttons in settings still work for OpenAI and Anthropic

---

## Post-Phase 8A: Settings Modal UX Fixes — DONE

### Problems
1. "How your data is protected" dropdown expanded the popup size, pushing action buttons (Export/Import/Save) off-screen
2. No way for users to explicitly delete stored API keys

### Fixes

**Fixed modal size with scrollable body:**
- `.modal` now uses `height: 85vh` (fixed, not max-height — prevents the modal from resizing when collapsible sections expand/collapse), `display: flex`, `flex-direction: column`
- `.modal-body` gets `overflow-y: auto` with thin custom scrollbar styling
- `.modal-header` and `.modal-footer` use `flex-shrink: 0` to always remain visible
- When both Ollama and Security dropdowns are open, content scrolls smoothly while buttons stay accessible

**Delete API key buttons:**
- Added red "Delete" button next to each API key's Test button (only shown when a key exists)
- Clicking shows a confirmation dialog, then clears the key from state and `chrome.storage.local`
- Modal re-creates itself to reflect the updated state (Delete button disappears after removal)

### Files modified

| File | Changes |
|------|---------|
| `app/app.css` | `.modal` → `width: 520px`, `height: 85vh` (fixed size, no resizing on collapsible toggle), flex layout; `.modal-body` → `overflow-y: auto` with scrollbar styling; `.modal-header`/`.modal-footer` → `flex-shrink: 0`; new `.btn-delete-key` style (red outline, fills red on hover) |
| `app/src/ui.js` | Added conditional "Delete" buttons for OpenAI/Anthropic keys; wired delete handlers with confirm + state clear + modal refresh; wired save button inside `openSettingsModal()` for post-delete re-creation |

---

## Phase 8B: IndexedDB Migration — DONE

### Problem

The entire state tree (all projects, branches, messages, and settings) was serialized as one JSON blob into `chrome.storage.local` on every single mutation — every message sent, every branch click, every settings toggle. Two issues:
1. `chrome.storage.local` has a ~10MB default limit; conversations grow unbounded
2. Writing the entire state on every keystroke is wasteful

### Solution

Moved project/branch/message data into IndexedDB (per-record read/write). Settings stay in `chrome.storage.local` (small, needed at boot). Existing data migrated seamlessly on first boot.

### Schema — Database `branchai_db` v1

| Store | keyPath | Indexes |
|-------|---------|---------|
| `projects` | `id` | `updatedAt` |
| `branches` | `id` | `by_project` (projectId), `updatedAt` |
| `messages` | auto-increment | `by_branch` (branchId), `by_branch_seq` ([branchId, seq]) |

### What stays in `chrome.storage.local`

Settings only under key `branchai_settings_v1` — provider config, dark mode, view mode, active IDs, encrypted API keys. Small, needed at boot before IndexedDB opens.

### New file: `app/src/db.js` (~220 lines)

IndexedDB wrapper. Lazy-open singleton via `getDB()`.

**Exports:**
| Function | Description |
|----------|-------------|
| `getDB()` | Lazy-open singleton, creates stores on upgrade |
| `getAllProjects()` | Read all project records |
| `getProject(id)` | Read single project |
| `putProject(obj)` | Upsert project record |
| `deleteProjectFromDB(id)` | Cascade delete: project + branches + messages |
| `getBranchesForProject(projectId)` | Read branches by project index |
| `getBranch(id)` | Read single branch |
| `putBranch(obj)` | Upsert branch record |
| `deleteBranchFromDB(id)` | Cascade delete: branch + messages |
| `getMessagesForBranch(branchId)` | Read messages sorted by [branchId, seq] |
| `replaceMessages(branchId, msgs)` | Delete existing + write new messages with seq |
| `appendMessage(branchId, msg, seq)` | Add single message |
| `putProjectWithChildren(nestedProject)` | Atomic bulk write of project + branches + messages (used by migration + import) |
| `exportProjectTree(projectId)` | Reassemble nested tree from IDB (project + branches + messages) |

All functions wrapped in try/catch with `[BranchAI IDB]` console logging. Read failures return `[]`/`null`. Write failures are silent (in-memory state remains valid).

### New file: `app/src/migration.js` (~65 lines)

One-time migration from `branchai_state_v2` blob to IndexedDB.

**Constants:**
- `LEGACY_KEY = 'branchai_state_v2'`
- `MIGRATED_FLAG = 'branchai_idb_migrated_v1'`
- `SETTINGS_KEY = 'branchai_settings_v1'` (exported, used by state.js)

**`migrateIfNeeded(): Promise<boolean>`:**
1. Check `MIGRATED_FLAG` in chrome.storage.local — if set, return false (fast path)
2. Read legacy blob from `LEGACY_KEY`
3. If no data or empty projects — set flag, return false
4. For each project: normalize fields, add `projectId` to branches, call `putProjectWithChildren()`
5. Write settings to `SETTINGS_KEY` (settings + viewMode + activeProjectId + activeBranchId)
6. Back up legacy data under `branchai_legacy_backup` (do NOT delete original)
7. Set `MIGRATED_FLAG = true`
8. On error: set `MIGRATED_FLAG = 'failed'` to prevent infinite retries

### Modified file: `app/src/state.js` — Major refactor

**State shape unchanged** — `state.projects` is still a nested tree with branches and messages. Only the persistence layer changed.

**Removed:** `STORAGE_KEY`, old `persist()` (full-blob write), old `loadFromStorage()`

**New persistence functions:**
| Function | Description |
|----------|-------------|
| `persistSettings()` | Writes `{settings, viewMode, activeProjectId, activeBranchId}` to `chrome.storage.local[SETTINGS_KEY]` with encrypted API keys |
| `persistProject(projectId)` | Writes project + all its branches + all messages to IDB via `putProjectWithChildren()` |
| `persistBranchMessages(branchId)` | Writes branch metadata + messages to IDB (for sendMessage) |
| `persistBranchMetadata(branch, projectId)` | Writes only branch record to IDB (for summary/provider updates) |
| `persist()` | **Compat shim** — only calls `persistSettings()`. Serves ui.js viewMode/activeId changes without modification. |

**New loading functions:**
| Function | Description |
|----------|-------------|
| `loadSettings()` | Reads `chrome.storage.local[SETTINGS_KEY]`, decrypts API keys |
| `reloadFromDB()` | Reads all projects/branches/messages from IDB, reconstructs nested `state.projects` tree, sorted by updatedAt desc |

**Mutation function updates:**
- `newProject()` → calls `persistProject(pid)` + `persistSettings()` (fire-and-forget)
- `newBranch()` → calls `persistProject(p.id)` + `persistSettings()` (fire-and-forget)
- `deleteProject()` → calls `deleteProjectFromDB(id)` + `persistSettings()`
- `deleteBranch()` → calls `deleteBranchFromDB(id)` + `persistSettings()`
- `updateSettings()` → calls `persistSettings()` only

### Modified file: `app/src/main.js`

**Boot:** Added `migrateIfNeeded()` call (dynamic import) before `loadInitial()`.

**`sendMessage()` changes:**
- After user message: `persistBranchMessages(b.id)` instead of `persist()`
- After assistant response: `persistBranchMessages(b.id)` + `putProject()` for project.updatedAt

**Summarization:** `persist()` → `persistBranchMetadata(b, p.id)`

**`onProviderChange`/`onModelChange`:** `persist()` → `persistBranchMetadata(b, p.id)` + `persistSettings()`

### Modified file: `app/src/export_import.js`

- Import: `persist()` → `persistProject(pid)` + `persistSettings()`
- Export: unchanged (reads from in-memory state)

### Unchanged: `app/src/ui.js`

All `persist()` calls in ui.js are for UI state (viewMode, activeProjectId, activeBranchId) — the compat shim handles these correctly. No changes needed.

### Verification

1. **Fresh install**: 3 IDB stores created, `branchai_settings_v1` in Extension Storage, no `branchai_state_v2`
2. **Migration**: Existing data migrates on first boot, console shows `[BranchAI] Migrated N projects to IndexedDB`, `branchai_legacy_backup` created, flag set
3. **Re-run safety**: Migration does not re-run on subsequent boots (flag check)
4. **CRUD**: Create/delete projects and branches reflected in IDB stores with cascade deletes
5. **Messages**: Send messages → appear in IDB `messages` store with correct branchId and seq
6. **Persistence**: Close/reopen → all data intact from IDB
7. **Settings**: API keys encrypted in `branchai_settings_v1`, dark mode/provider preserved
8. **Export/Import**: Round-trip works, imported data written to IDB

---

## Future: Provider API Options — DEFERRED

Adding free-tier cloud providers (Google Gemini, Groq, OpenRouter) requires:
- Centralized usage tracking per user
- Daily/monthly rate limiting
- Backend infrastructure to manage API keys

Deferred until infrastructure is in place.

---

## Privacy Section on Home Page — DONE

### Goal

Add a "Your Data, Your Control" privacy section to the bottom of the home page, with four info cards and a closing "What data do we collect? Nothing." line. Visible in both grid/list view modes and below the empty state.

### New icons (`app/src/icons.js`)

| Icon | SVG Description |
|------|-----------------|
| `shieldCheck` | Shield outline with checkmark path inside (for "Privacy First" card) |
| `userX` | Person silhouette with X lines (for "No User Accounts" card) |
| `code` | Code angle brackets `</>` (for "Fully Open Source" card) |

Existing `database` and `shield` icons reused for "Local Storage Only" and the badge pill.

### HTML changes (`app/src/ui.js`)

`renderProjectsScreen()` restructured so the privacy section always renders at the bottom — both when projects exist (grid or list) and on empty state. Previously, the empty state had an early `return` that would skip any appended content.

Privacy section structure:
```
.privacy-section
  .privacy-badge  →  shield icon + "Privacy-First & Open Source"
  h2.privacy-title  →  "Your Data, Your Control"
  p.privacy-subtitle  →  "BranchAI is built with privacy..."
  .privacy-cards (4-col responsive grid)
    .privacy-card × 4:
      1. userX → "No User Accounts" / "Use immediately without signing up or logging in"
      2. database → "Local Storage Only" / "All data stays in your browser — nothing stored in the cloud"
      3. shieldCheck → "Privacy First" / "Your conversations and API keys never touch our servers"
      4. code → "Fully Open Source" / "Inspect the code, contribute, or self-host"
  p.privacy-verify  →  "Want to verify?..." with GitHub link
  p.privacy-collect  →  "What data do we collect? Nothing."
```

### CSS changes (`app/app.css`)

~65 lines of new styles:

| Class | Key Styles |
|-------|------------|
| `.privacy-section` | `text-align: center`, `margin-top: 48px`, `padding: 40px 0` |
| `.privacy-badge` | `inline-flex` pill, `border: 1px solid var(--accent)`, `border-radius: 20px`, accent text, 12px, 14px icon |
| `.privacy-title` | 28px bold, `margin-top: 16px` |
| `.privacy-subtitle` | 15px muted, `max-width: 520px`, `margin: auto` |
| `.privacy-cards` | `grid`, `repeat(auto-fill, minmax(200px, 1fr))`, `gap: 16px`, `margin-top: 32px`, `text-align: left` |
| `.privacy-card` | `border: 1px solid var(--border)`, `border-radius: 12px`, `padding: 24px` |
| `.privacy-card-icon` | 40px rounded square, `var(--accent-soft)` background, accent icon color, 20px SVG |
| `.privacy-card-title` | 15px semibold, `margin-top: 14px` |
| `.privacy-card-desc` | 13px muted, `margin-top: 6px` |
| `.privacy-verify` | 14px muted, `margin-top: 32px`, link with accent underline |
| `.privacy-collect` | 13px dim, `margin-top: 12px` |

---

## Summarization Bug Fixes — DONE

### Problem

Multiple cascading issues with branch auto-summarization:

1. **400 errors flooding the console** — OpenAI returned `400 Bad Request` on every summarize call
2. **Infinite retry loop** — failed branches retried on every PROJECT screen navigation
3. **Empty summaries from reasoning models** — `gpt-5-mini` used all `max_completion_tokens` for reasoning, returning `"content": ""`
4. **Unnecessary re-summarization** — branches with existing summaries were re-requested

### Root causes and fixes

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| 400 Bad Request | `summarizeBranch()` sent `temperature: 0.3` — rejected by `gpt-5-mini` (and o-series models) which only accept default (1) | Removed `temperature` from summarize options entirely |
| Infinite retry | On failure, `summaryMsgCount` was never updated, so `lazySummarizeBranches` re-fired the same requests on every navigation | Added `_summaryFailed` Map that tracks `branchId → msgCount` at failure; skips branches that already failed at current message count; clears on success |
| Empty summaries | `max_completion_tokens: 60` too small for reasoning models — `gpt-5-mini` used all 60 tokens for reasoning (`"reasoning_tokens": 60`), leaving 0 for output | Increased `max_tokens` to 600; hardcoded `gpt-4o-mini` for OpenAI summaries (no need for expensive/reasoning models) |
| Redundant re-summarization | `lazySummarizeBranches` checked `summaryMsgCount !== messages.length`, re-triggering for any branch where messages changed since last summary | Changed condition to `if (b.summary) continue` — skips any branch that already has a summary; per-message summarize in `sendMessage()` handles updates |

### Model override for summarization (`app/src/summarize.js`)

Summarization now uses a **hardcoded small model per provider**, ignoring the user's selected model:

```js
const SUMMARY_MODEL = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
};
```

Falls back to user's model for other providers (e.g., Ollama). Uses standard `system` role (no reasoning model workarounds needed). `max_tokens: 600`.

### Files modified

| File | Changes |
|------|---------|
| `app/src/summarize.js` | Rewrote: removed reasoning model detection (`REASONING_RE`), removed `temperature`, added `SUMMARY_MODEL` map per provider, `max_tokens` 60→600, added `console.warn` on failure + rethrow |
| `app/src/main.js` | `lazySummarizeBranches()`: replaced `_summarizing` Set with `_summaryFailed` Map; added `if (b.summary) continue` to skip existing summaries; added `.catch()` to sendMessage summarize path |

---

## Message Duplication Bug Fix — DONE

### Problem

After creating new branches, all existing branch messages were duplicated (some 3x, some 6x). The message counts in the UI were wildly inflated (e.g., 104 → 624, 136 → 816).

### Root cause

`putProjectWithChildren()` in `db.js` used `msgStore.add()` to write messages — which always creates NEW records (messages store uses `autoIncrement` keys). **It never deleted existing messages first.** Each call appended duplicates.

This function is called from:
- `newBranch()` → `persistProject()` → `putProjectWithChildren()`
- `newProject()` → `persistProject()` → `putProjectWithChildren()`
- `migration.js` (one-time)

So every `newBranch()` call re-wrote ALL messages for ALL branches in the project as additional records, multiplying messages.

### Fix (`app/src/db.js`)

Added existing message deletion before writes in `putProjectWithChildren()`:

```js
// delete existing messages for this branch first to prevent duplicates
const existingKeys = await req2p(msgStore.index('by_branch').getAllKeys(branch.id));
for (const k of existingKeys) msgStore.delete(k);
```

This matches the pattern already used in `replaceMessages()`.

### Data repair on load (`app/src/state.js`)

Added deduplication in `reloadFromDB()` to clean up already-duplicated data:

```js
// Dedup: keep only the first message per seq value
const seen = new Set();
const uniqueMsgs = [];
for (const m of rawMsgs) {
  if (!seen.has(m.seq)) {
    seen.add(m.seq);
    uniqueMsgs.push(m);
  }
}
// If duplicates were found, repair the IDB data
if (uniqueMsgs.length < rawMsgs.length) {
  await replaceMessages(b.id, cleaned);
}
```

On load, if duplicates are detected, the branch's messages are repaired in-place via `replaceMessages()` (which deletes-then-adds). Console warns with before/after counts.

### Files modified

| File | Changes |
|------|---------|
| `app/src/db.js` | `putProjectWithChildren()`: added message deletion before adding new messages for each branch |
| `app/src/state.js` | `reloadFromDB()`: added seq-based deduplication with IDB repair via `replaceMessages()` |

---

## Model Dropdown Regression Fix — DONE

### Problem

After summarization started succeeding (with `gpt-4o-mini`), users saw "No model selected. Please select a model from the dropdown." when sending messages — even though the model dropdown visibly showed a model.

### Root cause

`lazySummarizeBranches()` fires on the PROJECT screen. When a summary succeeds, it calls `renderAll()`. If the user navigated to the CHAT screen in the meantime, `renderAll()` → `renderHeader()` recreates the `<select id="modelSel">` with only `<option>loading...</option>`. But `renderAll()` never called `repopulateModelsFromCache()` to refill it.

When the user then sent a message, `$('modelSel')?.value` was `"loading..."`, which matched the guard condition → alert.

This was a **latent bug** exposed by summarization now succeeding. Previously, summarization always failed with `gpt-5-mini`, so `renderAll()` was never called from the summarize handler.

### Fix

Added `onChatRender` callback to the callback system:

**`app/src/ui.js`** — `renderAll()` now calls `_callbacks.onChatRender?.()` after `renderChatScreen()` + `replayModelStatus()` when on the chat screen.

**`app/src/main.js`** — Registered `onChatRender` callback in `setCallbacks()`:

```js
onChatRender: () => {
  repopulateModelsFromCache();
  populateProviders();
},
```

This ensures provider/model dropdowns are always repopulated from cache whenever the chat screen's header is re-rendered — regardless of what triggered `renderAll()`.

### Files modified

| File | Changes |
|------|---------|
| `app/src/ui.js` | `renderAll()`: added `_callbacks.onChatRender?.()` call when on CHAT screen |
| `app/src/main.js` | `setCallbacks()`: added `onChatRender` callback that calls `repopulateModelsFromCache()` + `populateProviders()` |

---

## UI Redesign: Emoji Removal + Per-Key Save + Workspace/Sidebar Layout — DONE

### Overview

Three-part UI overhaul that removes the emoji system, adds per-provider API key save buttons, and replaces the old 3-screen navigation with a workspace layout featuring a persistent sidebar.

---

### Part 1: Emoji System Removal — DONE

Removed all automatic emoji assignment. Projects/branches no longer get emojis by default. Existing data with user-provided emojis is still displayed (backwards compat).

| File | Changes |
|------|---------|
| `app/src/utils.js` | Removed `DEFAULT_EMOJIS` array, `_emojiIdx` counter, and `pickDefaultEmoji()` function |
| `app/src/state.js` | Removed `pickDefaultEmoji` import; `normalizeState()` defaults `emoji` to `''` instead of calling `pickDefaultEmoji()`; `newProject()` and `newBranch()` default emoji to `''` |
| `app/src/ui.js` | Removed `pickDefaultEmoji` import; removed `EMOJI_OPTIONS` array; removed emoji picker (label + `.emoji-grid`) from `_openCreateModal()`; emoji display in cards/rows/breadcrumbs now conditional (`p.emoji ? ... : ''`) |
| `app/src/export_import.js` | Removed `pickDefaultEmoji` import; import defaults emoji to `''` for projects and branches |
| `app/app.css` | Removed `.emoji-grid` and `.emoji-option` styles (~15 lines) |

---

### Part 2: Per-API-Key Save Buttons — DONE

Each provider's API key section now has its own "Save" button that persists that specific key immediately, separate from the global Save button.

| File | Changes |
|------|---------|
| `app/src/ui.js` | Added `<button class="btn-sm btn-save-key" id="saveOpenaiKey">Save</button>` and matching Anthropic button in settings modal HTML; wired `onSaveApiKey` callback for each |
| `app/src/main.js` | Added `onSaveApiKey(provider, config)` callback in `setCallbacks()` — calls `Object.assign(state.settings[provider], config)` + `persistSettings()` |
| `app/app.css` | Added `.btn-save-key` style (accent purple background, white text) |

Settings modal API key row layout is now: `[input] [Save] [Test] [Delete?]`

---

### Part 3: Workspace/Sidebar Layout — DONE

Replaced the old 3-screen system (`screen-home`, `screen-project`, `screen-chat` as separate `<main>` elements) with a workspace layout: HOME screen stays as-is, but PROJECT and CHAT screens now render inside a flex workspace with a persistent sidebar.

#### HTML restructure (`app/index.html`)

Old:
```html
<main id="screen-home" class="screen active">...</main>
<main id="screen-project" class="screen">...</main>
<main id="screen-chat" class="screen">...</main>
```

New:
```html
<main id="screen-home" class="screen active">...</main>
<div id="workspace" class="workspace" style="display:none;">
  <aside id="sidebar" class="sidebar">
    <div id="sidebar-content"></div>
  </aside>
  <div id="workspace-main">
    <div id="workspace-content"></div>
  </div>
</div>
```

Chat screen HTML (subtitle, messages, input bar) is no longer static in `index.html` — it's dynamically generated by `renderChatInto()`.

#### New icons (`app/src/icons.js`)

| Icon | Description |
|------|-------------|
| `chevronLeft` | Left-pointing chevron for sidebar back button |
| `home` | House icon (available but not currently used in sidebar) |

#### State changes (`app/src/state.js`)

Added two runtime-only properties (not persisted):
- `sidebarCollapsed: false` — tracks sidebar state
- `_sidebarExpanded: true` — tracks whether active project's branch list is expanded in sidebar

#### Screen activation (`app/src/ui.js` — `activateScreen()`)

Old: toggled `.active` class on `.screen` elements.

New:
- HOME: show `#screen-home`, hide `#workspace`
- PROJECT/CHAT: hide `#screen-home`, show `#workspace` (flex)

#### Sidebar rendering (`app/src/ui.js` — `renderSidebar()`)

Unified sidebar for both PROJECT and CHAT screens. Always full-width (280px). Shows all projects as expandable tree nodes:

```
← Projects              (back to HOME)
▶ Scratchpad            (collapsed — click to expand)
    1 branch
▼ Car Wash Project      (expanded — active project)
    2 branches
    ├─ Branch @ msg 8   (click → CHAT)
    └─ Branched from Chat ● (active branch, highlighted)
```

Behavior:
- Clicking a project toggles its branch sub-list open/closed
- Clicking a different project switches active project + expands its branches
- Clicking a branch navigates to CHAT for that branch
- Active branch highlighted with accent-colored left border
- Back button ("← Projects") navigates to HOME

#### Branch rendering (`app/src/ui.js` — `renderBranchesInto(el)`)

Renamed from `renderBranchesScreen()`. Now takes a target element parameter instead of looking up `$('project-content')`. Renders into `#workspace-content`.

#### Chat rendering (`app/src/ui.js` — `renderChatInto(container)`)

Renamed from `renderChatScreen()`. Dynamically creates the entire chat DOM (subtitle, messages, input bar, send button) inside the provided container. Old code relied on static HTML elements in `index.html`.

#### Main render (`app/src/ui.js` — `renderAll()`)

Updated dispatch:
- HOME: `renderProjectsScreen()` into `#home-content` (unchanged)
- PROJECT: `renderSidebar()` + `renderBranchesInto(#workspace-content)`
- CHAT: `renderSidebar()` + `renderChatInto(#workspace-content)` with `.chat-mode` class

#### Sidebar collapse logic (`app/src/main.js`)

`onScreenChange` sets `state.sidebarCollapsed` based on screen (false for PROJECT, true for CHAT). Sidebar renders identically in both cases (full-width tree).

#### CSS (`app/app.css`)

~80 lines of new workspace/sidebar styles:

| Class | Key Styles |
|-------|------------|
| `.workspace` | `display: flex`, `height: calc(100vh - 57px)` |
| `.sidebar` | `width: 280px`, `border-right`, `overflow-y: auto`, `flex-shrink: 0`, `background: var(--surface)` |
| `.sidebar-back-btn` | Flex row with chevron-left icon, hover highlight |
| `.sidebar-project-group` | Container for project item + expandable branch list |
| `.sidebar-item` | Flex row with chevron toggle + project name/meta |
| `.sidebar-item-chevron` | Rotates 90deg when `.expanded` |
| `.sidebar-branches` | Hidden by default, shown with `.open` class |
| `.sidebar-branch` | Indented (34px left padding), top border separator |
| `.sidebar-branch.active` | Accent-soft background + 3px accent left border |
| `#workspace-main` | `flex: 1`, `overflow-y: auto`, `min-width: 0` |
| `#workspace-content` | `max-width: 1100px`, centered, padded |
| `#workspace-content.chat-mode` | Full width, no padding, `height: calc(100vh - 57px)` |

Removed old collapsed sidebar styles (~25 lines): `.sidebar.collapsed`, `.sidebar-collapsed-content`, `.sidebar-collapsed-project`, `.sidebar-collapsed-branch` (vertical text writing-mode).

---

## Resume Point

**Phases 1–8B complete + Settings UX fixes + Privacy section + Summarization fixes + Message duplication fix + UI Redesign (emoji removal, per-key save, workspace/sidebar) done.** Next steps:
- Live-test content script integration on ChatGPT (Phase 4 verification)
- Polish: empty state illustrations, loading skeletons, keyboard shortcuts
- Remove legacy `branch-host/` and `branch-chat-ext/` directories
- Real extension icons (replace placeholders)
