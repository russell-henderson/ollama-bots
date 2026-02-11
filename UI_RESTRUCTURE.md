# Ollama UI Restructuring - Implementation Guide

## Overview
This guide provides complete code for restructuring the Ollama UI to maximize chat space while maintaining all functionality through collapsible panels, compact layouts, and progressive disclosure.

---

## Phase 1: Remove Top Header & Relocate Elements

### Step 1.1: Delete Global Header

**Remove this entire section:**
```html
<!-- DELETE THIS -->
<div class="global-header">
  <div class="model-selector">
    <label>Model</label>
    <select>
      <option>MartinRizzo/Regent-Dominique-24b (23.6B)</option>
    </select>
  </div>
  <div class="ollama-status">
    <span class="status-indicator">●</span>
    Ollama connected
    <span class="model-count">Models: 7</span>
  </div>
</div>
```

### Step 1.2: Add Ollama Status Indicator to Bottom-Left Corner

**Add this to the bottom of the character sidebar:**
```html
<div class="character-sidebar">
  <!-- Existing character list -->
  
  <!-- New footer with compact status -->
  <div class="sidebar-footer">
    <div class="ollama-status-compact" id="ollama-status">
      <span class="status-dot connected"></span>
      <span class="status-text">Ollama</span>
      <span class="model-count">7</span>
    </div>
    <button class="settings-btn" onclick="openSettings()">
      ⚙️
    </button>
  </div>
</div>
```

**CSS for compact status:**
```css
.sidebar-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px;
  background: #0f1419;
  border-top: 1px solid #2a3142;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ollama-status-compact {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #8b92a8;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #666;
}

.status-dot.connected {
  background: #4caf50;
  box-shadow: 0 0 8px #4caf50;
  animation: pulse-status 2s ease-in-out infinite;
}

.status-dot.disconnected {
  background: #ff4b4b;
}

@keyframes pulse-status {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.model-count {
  background: #2a3142;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
}

.settings-btn {
  background: transparent;
  border: none;
  color: #8b92a8;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}

.settings-btn:hover {
  background: #2a3142;
  color: #e4e6eb;
}
```

### Step 1.3: Move Model Selector to Character Edit Panel

**Add model selector to character configuration form:**
```html
<div class="character-edit-panel">
  <h3>Edit Character: Mother</h3>
  
  <div class="form-group">
    <label>Name</label>
    <input type="text" value="Mother">
  </div>
  
  <!-- NEW: Model Selector Here -->
  <div class="form-group">
    <label>Model</label>
    <select id="character-model">
      <option value="martinrizzo/regent-dominique-24b">MartinRizzo/Regent-Dominique-24b (23.6B)</option>
      <option value="llama2">Llama 2 (7B)</option>
      <option value="mistral">Mistral (7B)</option>
      <!-- Populated from Ollama API -->
    </select>
    <small class="help-text">Choose which model this character uses</small>
  </div>
  
  <div class="form-group">
    <label>System Prompt</label>
    <textarea rows="6">...</textarea>
  </div>
  
  <!-- Rest of character settings -->
</div>
```

---

## Phase 2: Collapsible Analytics & Context Panels

### Step 2.1: New Chat Header with Pill Buttons

**Replace existing chat header with:**
```html
<div class="chat-header">
  <div class="character-info">
    <h2 class="character-name" id="active-character-name">Mother</h2>
    <span class="character-model" id="active-character-model">MartinRizzo/Regent-Dominique-24b</span>
  </div>
  
  <div class="chat-tools">
    <!-- Collapsible Analytics -->
    <button class="pill-button" id="analytics-toggle" onclick="togglePanel('analytics')">
      <span class="pill-icon">📊</span>
      <span class="pill-label">Analytics</span>
      <span class="pill-badge" id="analytics-badge">14 msgs</span>
      <span class="pill-arrow">▼</span>
    </button>
    
    <!-- Collapsible Context -->
    <button class="pill-button" id="context-toggle" onclick="togglePanel('context')">
      <span class="pill-icon">📄</span>
      <span class="pill-label">Context</span>
      <span class="pill-badge" id="context-badge">0%</span>
      <span class="pill-arrow">▼</span>
    </button>
    
    <!-- Existing tools -->
    <button class="tool-button" onclick="showConversationTools()">
      Conversation Tools
    </button>
    
    <button class="tool-button" onclick="showTemplates()">
      Templates
    </button>
    
    <button class="tool-button retry-button" onclick="retryLastMessage()">
      Retry
    </button>
  </div>
</div>
```

**CSS for new header:**
```css
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: #1a1f2e;
  border-bottom: 1px solid #2a3142;
  flex-shrink: 0;
}

.character-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.character-name {
  font-size: 16px;
  font-weight: 600;
  color: #e4e6eb;
  margin: 0;
}

.character-model {
  font-size: 11px;
  color: #8b92a8;
  font-family: 'Monaco', 'Courier New', monospace;
}

.chat-tools {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* Pill Buttons */
.pill-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #2a3142;
  border: 1px solid #3a4152;
  border-radius: 20px;
  color: #e4e6eb;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.pill-button:hover {
  background: #3a4152;
  border-color: #4a5162;
}

.pill-button.active {
  background: #4a9eff;
  border-color: #4a9eff;
}

.pill-button.active .pill-arrow {
  transform: rotate(180deg);
}

.pill-icon {
  font-size: 14px;
}

.pill-label {
  font-weight: 500;
}

.pill-badge {
  background: rgba(255, 255, 255, 0.1);
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
}

.pill-arrow {
  font-size: 10px;
  transition: transform 0.2s;
}

/* Tool Buttons */
.tool-button {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid #3a4152;
  border-radius: 4px;
  color: #e4e6eb;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.tool-button:hover {
  background: #2a3142;
  border-color: #4a5162;
}

.retry-button {
  border-color: #4a9eff;
  color: #4a9eff;
}

.retry-button:hover {
  background: rgba(74, 158, 255, 0.1);
}
```

### Step 2.2: Collapsible Panel Structure

**Add these panels after the chat header:**
```html
<div class="chat-container">
  <div class="chat-header">
    <!-- Header from above -->
  </div>
  
  <!-- Analytics Panel (Collapsible) -->
  <div class="collapsible-panel" id="analytics-panel">
    <div class="panel-content">
      <div class="analytics-grid">
        <!-- Your existing analytics content -->
        <div class="stat-section">
          <h4>Session</h4>
          <div class="stat-row">
            <span>Duration:</span>
            <span>1 min</span>
          </div>
          <div class="stat-row">
            <span>Turns sent:</span>
            <span>0</span>
          </div>
          <div class="stat-row">
            <span>Branches:</span>
            <span>7</span>
          </div>
        </div>
        
        <div class="stat-section">
          <h4>Conversation</h4>
          <div class="stat-row">
            <span>Messages:</span>
            <span>25</span>
          </div>
          <div class="stat-row">
            <span>User/Assistant:</span>
            <span>11/14</span>
          </div>
          <div class="stat-row">
            <span>Edited turns:</span>
            <span>0</span>
          </div>
        </div>
        
        <div class="stat-section">
          <h4>Quality</h4>
          <div class="stat-row">
            <span>Rated assistant msgs:</span>
            <span>0</span>
          </div>
          <div class="stat-row">
            <span>Annotations:</span>
            <span>0</span>
          </div>
          <div class="stat-row">
            <span>Assigned docs:</span>
            <span>2</span>
          </div>
        </div>
        
        <div class="stat-section">
          <h4>Top Characters</h4>
          <div class="stat-row">
            <span>char-character-2-jnaefs:</span>
            <span>14 msgs</span>
          </div>
          <div class="stat-row">
            <span>Mommy:</span>
            <span>6 msgs</span>
          </div>
          <div class="stat-row">
            <span>The Mother:</span>
            <span>3 msgs</span>
          </div>
        </div>
      </div>
      
      <div class="stat-section full-width">
        <h4>Top Models</h4>
        <div class="stat-row">
          <span>Hermes-3-Llama-3.1-8:</span>
          <span>9 replies</span>
        </div>
        <div class="stat-row">
          <span>unknown:</span>
          <span>3 replies</span>
        </div>
        <div class="stat-row">
          <span>Gemma3-instruct..:</span>
          <span>2 replies</span>
        </div>
      </div>
      
      <button class="refresh-analytics-btn" onclick="refreshAnalytics()">
        <span>↻</span> Refresh
      </button>
    </div>
  </div>
  
  <!-- Context Panel (Collapsible) -->
  <div class="collapsible-panel" id="context-panel">
    <div class="panel-content">
      <div class="context-info">
        <div class="context-bar">
          <div class="context-breakdown">
            <div class="context-segment system" style="width: 5%;" title="System Prompt: 200 tokens"></div>
            <div class="context-segment docs" style="width: 0%;" title="Documents: 0 tokens"></div>
            <div class="context-segment history" style="width: 1%;" title="History: 1 tokens"></div>
            <div class="context-segment available" style="width: 94%;" title="Available: 7997 tokens"></div>
          </div>
        </div>
        
        <div class="context-stats">
          <div class="context-stat">
            <span class="stat-label">Used:</span>
            <span class="stat-value">0/1 tokens (0%)</span>
          </div>
          <div class="context-stat">
            <span class="stat-label">Reserve:</span>
            <span class="stat-value">0 tokens</span>
          </div>
        </div>
        
        <div class="context-message">
          No document context attached.
        </div>
      </div>
    </div>
  </div>
  
  <!-- Chat Messages (Now gets full space!) -->
  <div class="chat-messages" id="chat-messages">
    <!-- Messages render here -->
  </div>
  
  <!-- Chat Input (Fixed at bottom) -->
  <div class="chat-input-container">
    <!-- Your existing input -->
  </div>
</div>
```

**CSS for collapsible panels:**
```css
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.collapsible-panel {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background: #151922;
  border-bottom: 1px solid transparent;
}

.collapsible-panel.expanded {
  max-height: 350px;
  overflow-y: auto;
  border-bottom-color: #2a3142;
}

.panel-content {
  padding: 16px 20px;
}

/* Analytics Grid */
.analytics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}

.stat-section {
  background: #1e2530;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid #2a3142;
}

.stat-section.full-width {
  grid-column: 1 / -1;
}

.stat-section h4 {
  margin: 0 0 8px 0;
  font-size: 12px;
  color: #8b92a8;
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 12px;
  color: #e4e6eb;
}

.stat-row span:first-child {
  color: #8b92a8;
}

.stat-row span:last-child {
  font-weight: 600;
  color: #4a9eff;
}

.refresh-analytics-btn {
  padding: 8px 16px;
  background: #2a3142;
  border: 1px solid #3a4152;
  border-radius: 6px;
  color: #e4e6eb;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.refresh-analytics-btn:hover {
  background: #3a4152;
  border-color: #4a9eff;
}

/* Context Panel */
.context-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.context-bar {
  background: #1e2530;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid #2a3142;
}

.context-breakdown {
  height: 24px;
  display: flex;
  border-radius: 4px;
  overflow: hidden;
}

.context-segment {
  height: 100%;
  transition: width 0.3s;
}

.context-segment.system {
  background: #ff4b4b;
}

.context-segment.docs {
  background: #4a9eff;
}

.context-segment.history {
  background: #4caf50;
}

.context-segment.available {
  background: #2a3142;
}

.context-stats {
  display: flex;
  gap: 24px;
}

.context-stat {
  display: flex;
  gap: 8px;
  font-size: 12px;
}

.stat-label {
  color: #8b92a8;
}

.stat-value {
  color: #e4e6eb;
  font-weight: 600;
  font-family: 'Monaco', 'Courier New', monospace;
}

.context-message {
  padding: 12px;
  background: #1e2530;
  border-radius: 6px;
  border: 1px solid #2a3142;
  font-size: 12px;
  color: #8b92a8;
  text-align: center;
}

/* Chat Messages - Now fills available space */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: #151922;
}

.chat-input-container {
  flex-shrink: 0;
  padding: 16px 20px;
  background: #1a1f2e;
  border-top: 1px solid #2a3142;
}
```

### Step 2.3: JavaScript for Toggle Functionality

```javascript
// Panel toggle logic
let expandedPanels = new Set();

function togglePanel(panelName) {
  const panel = document.getElementById(`${panelName}-panel`);
  const toggle = document.getElementById(`${panelName}-toggle`);
  
  if (expandedPanels.has(panelName)) {
    // Collapse
    panel.classList.remove('expanded');
    toggle.classList.remove('active');
    expandedPanels.delete(panelName);
  } else {
    // Expand
    panel.classList.add('expanded');
    toggle.classList.add('active');
    expandedPanels.add(panelName);
  }
}

// Update badge values
function updateAnalyticsBadge(messageCount) {
  document.getElementById('analytics-badge').textContent = `${messageCount} msgs`;
}

function updateContextBadge(percentage) {
  const badge = document.getElementById('context-badge');
  badge.textContent = `${percentage}%`;
  
  // Change color based on usage
  if (percentage > 80) {
    badge.style.background = 'rgba(255, 75, 75, 0.3)';
    badge.style.color = '#ff4b4b';
  } else if (percentage > 60) {
    badge.style.background = 'rgba(255, 152, 0, 0.3)';
    badge.style.color = '#ff9800';
  } else {
    badge.style.background = 'rgba(255, 255, 255, 0.1)';
    badge.style.color = '#e4e6eb';
  }
}

// Call these when values change
function onMessageSent() {
  // ... your existing logic
  updateAnalyticsBadge(getTotalMessageCount());
  updateContextBadge(calculateContextUsagePercentage());
}
```

---

## Phase 3: Compact Character Cards

### Step 3.1: Optimized Character Card HTML

```html
<div class="character-list">
  <div class="character-group">
    <div class="group-header" onclick="toggleGroup('ungrouped')">
      <span class="group-toggle">▼</span>
      <span class="group-name">UNGROUPED</span>
      <span class="group-count">(3)</span>
    </div>
    
    <div class="group-characters" id="group-ungrouped">
      <!-- Compact Character Card -->
      <div class="character-card active" data-character-id="char-1" onclick="switchCharacter('char-1')">
        <div class="character-avatar">M</div>
        <div class="character-details">
          <div class="character-name">Mother</div>
          <div class="character-model">MartinRizzo/Regent-Dom...</div>
        </div>
        <input type="checkbox" class="character-select" onclick="toggleCharacterSelect('char-1', event)">
      </div>
      
      <div class="character-card" data-character-id="char-2" onclick="switchCharacter('char-2')">
        <div class="character-avatar">M</div>
        <div class="character-details">
          <div class="character-name">Mommy</div>
          <div class="character-model">MartinRizzo/Regent-Dom...</div>
        </div>
        <input type="checkbox" class="character-select" onclick="toggleCharacterSelect('char-2', event)">
      </div>
      
      <div class="character-card" data-character-id="char-3" onclick="switchCharacter('char-3')">
        <div class="character-avatar">TM</div>
        <div class="character-details">
          <div class="character-name">The Mother</div>
          <div class="character-model">MartinRizzo/Regent-Dom...</div>
        </div>
        <input type="checkbox" class="character-select" onclick="toggleCharacterSelect('char-3', event)">
      </div>
    </div>
  </div>
  
  <!-- Collapsed group example -->
  <div class="character-group">
    <div class="group-header" onclick="toggleGroup('work')">
      <span class="group-toggle">▶</span>
      <span class="group-name">WORK</span>
      <span class="group-count">(2)</span>
    </div>
    
    <div class="group-characters collapsed" id="group-work">
      <!-- Characters hidden when collapsed -->
    </div>
  </div>
</div>
```

### Step 3.2: Compact Character Card CSS

```css
.character-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

/* Group Headers */
.character-group {
  margin-bottom: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.group-header:hover {
  background: rgba(255, 255, 255, 0.03);
}

.group-toggle {
  font-size: 10px;
  color: #8b92a8;
  transition: transform 0.2s;
}

.group-name {
  font-size: 11px;
  font-weight: 600;
  color: #8b92a8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.group-count {
  font-size: 10px;
  color: #666;
  margin-left: auto;
}

.group-characters {
  max-height: 1000px;
  overflow: hidden;
  transition: max-height 0.3s ease;
}

.group-characters.collapsed {
  max-height: 0;
}

/* Compact Character Cards */
.character-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin: 2px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
  position: relative;
}

.character-card:hover {
  background: #1e2530;
  border-color: #2a3142;
}

.character-card.active {
  background: #2a3142;
  border-left: 3px solid #4a9eff;
  padding-left: 9px; /* Compensate for thicker border */
}

.character-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  font-size: 13px;
  flex-shrink: 0;
}

.character-details {
  flex: 1;
  min-width: 0; /* Allow text truncation */
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.character-name {
  font-size: 13px;
  font-weight: 500;
  color: #e4e6eb;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.character-model {
  font-size: 10px;
  color: #666;
  font-family: 'Monaco', 'Courier New', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.character-select {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #4a9eff;
  flex-shrink: 0;
}

/* Activity indicator dot */
.character-card.has-conversation::before {
  content: '';
  position: absolute;
  top: 8px;
  right: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4caf50;
}
```

### Step 3.3: Character Card JavaScript

```javascript
// Group toggle
function toggleGroup(groupId) {
  const group = document.getElementById(`group-${groupId}`);
  const header = group.previousElementSibling;
  const toggle = header.querySelector('.group-toggle');
  
  if (group.classList.contains('collapsed')) {
    group.classList.remove('collapsed');
    toggle.textContent = '▼';
  } else {
    group.classList.add('collapsed');
    toggle.textContent = '▶';
  }
  
  // Save state
  saveGroupState(groupId, !group.classList.contains('collapsed'));
}

// Character selection
let selectedCharacters = new Set();

function toggleCharacterSelect(characterId, event) {
  event.stopPropagation(); // Prevent card click
  
  if (selectedCharacters.has(characterId)) {
    selectedCharacters.delete(characterId);
  } else {
    selectedCharacters.add(characterId);
  }
  
  updateAskAllButton();
}

function updateAskAllButton() {
  const askAllBtn = document.querySelector('.ask-all-button');
  if (selectedCharacters.size > 1) {
    askAllBtn.textContent = `Ask ${selectedCharacters.size} Characters`;
    askAllBtn.disabled = false;
  } else {
    askAllBtn.textContent = 'Ask All Characters To...';
    askAllBtn.disabled = true;
  }
}

// Switch active character
function switchCharacter(characterId) {
  // Remove active from all
  document.querySelectorAll('.character-card').forEach(card => {
    card.classList.remove('active');
  });
  
  // Add active to selected
  const card = document.querySelector(`[data-character-id="${characterId}"]`);
  card.classList.add('active');
  
  // Load character conversation
  loadCharacterConversation(characterId);
  
  // Update header
  const character = getCharacter(characterId);
  document.getElementById('active-character-name').textContent = character.name;
  document.getElementById('active-character-model').textContent = character.model;
}
```

---

## Phase 4: Optimize Documents Panel

### Step 4.1: Compact Documents Panel HTML

```html
<div class="documents-panel">
  <div class="documents-header">
    <div class="tab-group">
      <button class="tab active" data-tab="documents">Documents</button>
      <button class="tab" data-tab="quick-actions">Quick Actions</button>
    </div>
    <button class="panel-menu">⋯</button>
  </div>
  
  <!-- Documents Tab -->
  <div class="tab-content active" id="documents-tab">
    <!-- Compact Search -->
    <div class="documents-search">
      <input type="text" placeholder="Search documents..." id="doc-search">
    </div>
    
    <!-- Folder Tree (Collapsible) -->
    <div class="folder-tree">
      <div class="folder-item" onclick="toggleFolder('root')">
        <span class="folder-toggle">▼</span>
        <span class="folder-icon">📁</span>
        <span class="folder-name">Root</span>
        <span class="folder-count">(2)</span>
      </div>
      
      <div class="folder-contents" id="folder-root">
        <div class="document-item" data-doc-id="doc-1">
          <div class="doc-info">
            <span class="doc-icon">📄</span>
            <span class="doc-name">Action.md</span>
            <span class="doc-size">6.8 KB</span>
          </div>
          <div class="doc-actions">
            <input type="checkbox" class="doc-assign" title="Assign to character">
            <button class="doc-action-btn" onclick="viewDocument('doc-1')">👁️</button>
            <button class="doc-action-btn delete" onclick="deleteDocument('doc-1')">🗑️</button>
          </div>
        </div>
        
        <div class="document-item assigned" data-doc-id="doc-2">
          <div class="doc-info">
            <span class="doc-icon">📄</span>
            <span class="doc-name">Mother Description.md</span>
            <span class="doc-size">6.7 KB</span>
            <span class="doc-badge">Assigned</span>
          </div>
          <div class="doc-actions">
            <input type="checkbox" class="doc-assign" checked title="Unassign from character">
            <button class="doc-action-btn" onclick="viewDocument('doc-2')">👁️</button>
            <button class="doc-action-btn delete" onclick="deleteDocument('doc-2')">🗑️</button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Upload Button -->
    <div class="upload-zone-compact">
      <button class="upload-button" onclick="document.getElementById('file-upload').click()">
        <span>📤</span> Upload Documents
      </button>
      <input type="file" id="file-upload" multiple style="display: none;">
    </div>
  </div>
  
  <!-- Quick Actions Tab -->
  <div class="tab-content" id="quick-actions-tab">
    <div class="quick-actions-list">
      <button class="action-button" onclick="askAllCharacters()" id="ask-all-btn" disabled>
        <span class="action-icon">👥</span>
        <span class="action-label">Ask All Characters To...</span>
      </button>
      
      <button class="action-button" onclick="duplicateConversation()">
        <span class="action-icon">📋</span>
        <span class="action-label">Duplicate Conversation</span>
      </button>
      
      <button class="action-button" onclick="exportCharacter()">
        <span class="action-icon">💾</span>
        <span class="action-label">Export Character</span>
      </button>
      
      <button class="action-button" onclick="exportWorkspace()">
        <span class="action-icon">📦</span>
        <span class="action-label">Export Workspace</span>
      </button>
      
      <button class="action-button" onclick="openAnalyticsDashboard()">
        <span class="action-icon">📊</span>
        <span class="action-label">View Full Analytics</span>
      </button>
    </div>
  </div>
</div>
```

### Step 4.2: Compact Documents Panel CSS

```css
.documents-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #151922;
}

/* Documents Header */
.documents-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #1a1f2e;
  border-bottom: 1px solid #2a3142;
  flex-shrink: 0;
}

.tab-group {
  display: flex;
  gap: 4px;
}

.tab {
  padding: 6px 12px;
  background: transparent;
  border: none;
  color: #8b92a8;
  font-size: 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.tab:hover {
  color: #e4e6eb;
}

.tab.active {
  color: #e4e6eb;
  border-bottom-color: #4a9eff;
}

.panel-menu {
  background: transparent;
  border: none;
  color: #8b92a8;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
}

/* Tab Content */
.tab-content {
  display: none;
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.tab-content.active {
  display: flex;
  flex-direction: column;
}

/* Search */
.documents-search {
  margin-bottom: 12px;
}

.documents-search input {
  width: 100%;
  padding: 8px 12px;
  background: #1e2530;
  border: 1px solid #2a3142;
  border-radius: 6px;
  color: #e4e6eb;
  font-size: 12px;
}

.documents-search input:focus {
  outline: none;
  border-color: #4a9eff;
}

/* Folder Tree */
.folder-tree {
  flex: 1;
}

.folder-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.2s;
}

.folder-item:hover {
  background: #1e2530;
}

.folder-toggle {
  font-size: 10px;
  color: #8b92a8;
  transition: transform 0.2s;
}

.folder-icon {
  font-size: 14px;
}

.folder-name {
  font-size: 12px;
  font-weight: 500;
  color: #e4e6eb;
  flex: 1;
}

.folder-count {
  font-size: 11px;
  color: #666;
}

.folder-contents {
  margin-left: 20px;
  max-height: 1000px;
  overflow: hidden;
  transition: max-height 0.3s ease;
}

.folder-contents.collapsed {
  max-height: 0;
}

/* Document Items */
.document-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  margin: 2px 0;
  border-radius: 6px;
  transition: background 0.2s;
  border: 1px solid transparent;
}

.document-item:hover {
  background: #1e2530;
  border-color: #2a3142;
}

.document-item.assigned {
  background: rgba(74, 158, 255, 0.05);
  border-color: rgba(74, 158, 255, 0.2);
}

.doc-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.doc-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.doc-name {
  font-size: 12px;
  color: #e4e6eb;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-size {
  font-size: 10px;
  color: #666;
  font-family: 'Monaco', 'Courier New', monospace;
  flex-shrink: 0;
}

.doc-badge {
  font-size: 9px;
  padding: 2px 6px;
  background: rgba(74, 158, 255, 0.2);
  color: #4a9eff;
  border-radius: 10px;
  font-weight: 600;
  text-transform: uppercase;
  flex-shrink: 0;
}

.doc-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.doc-assign {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #4a9eff;
}

.doc-action-btn {
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.2s;
  font-size: 14px;
}

.doc-action-btn:hover {
  opacity: 1;
}

.doc-action-btn.delete:hover {
  filter: hue-rotate(320deg);
}

/* Upload Zone */
.upload-zone-compact {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #2a3142;
}

.upload-button {
  width: 100%;
  padding: 10px;
  background: #2a3142;
  border: 1px dashed #4a5162;
  border-radius: 6px;
  color: #e4e6eb;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s;
}

.upload-button:hover {
  background: #3a4152;
  border-color: #4a9eff;
}

/* Quick Actions */
.quick-actions-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.action-button {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #1e2530;
  border: 1px solid #2a3142;
  border-radius: 6px;
  color: #e4e6eb;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.action-button:hover:not(:disabled) {
  background: #2a3142;
  border-color: #4a9eff;
}

.action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-icon {
  font-size: 18px;
}

.action-label {
  flex: 1;
}
```

### Step 4.3: Document Panel JavaScript

```javascript
// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', function() {
    const tabName = this.dataset.tab;
    
    // Remove active from all tabs and contents
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    // Add active to clicked tab and corresponding content
    this.classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
  });
});

// Folder toggle
function toggleFolder(folderId) {
  const folder = document.getElementById(`folder-${folderId}`);
  const toggle = folder.previousElementSibling.querySelector('.folder-toggle');
  
  if (folder.classList.contains('collapsed')) {
    folder.classList.remove('collapsed');
    toggle.textContent = '▼';
  } else {
    folder.classList.add('collapsed');
    toggle.textContent = '▶';
  }
}

// Document preview modal (replaces always-visible preview)
function viewDocument(docId) {
  const doc = getDocument(docId);
  
  const modal = `
    <div class="modal-overlay" onclick="closeModal()">
      <div class="modal-content document-preview-modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>${doc.filename}</h3>
          <button onclick="closeModal()">✕</button>
        </div>
        
        <div class="modal-tabs">
          <button class="modal-tab active" data-tab="preview">Preview</button>
          <button class="modal-tab" data-tab="settings">Settings</button>
        </div>
        
        <div class="modal-body">
          <div class="modal-tab-content active" id="preview-content">
            <div class="extracted-text">
              ${doc.extractedText || 'Processing...'}
            </div>
          </div>
          
          <div class="modal-tab-content" id="settings-content">
            <div class="form-group">
              <label>Chunk Strategy</label>
              <select id="chunk-strategy">
                <option value="paragraph">Paragraph</option>
                <option value="token">Token Count</option>
                <option value="section">Section/Heading</option>
                <option value="whole">Whole Document</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Token Size</label>
              <input type="number" id="token-size" value="120">
            </div>
            
            <div class="form-group">
              <label>Preprocessing Instructions</label>
              <textarea id="preprocess-instructions" rows="4" placeholder="e.g., Summarize this document first..."></textarea>
            </div>
            
            <button class="primary-button" onclick="applyDocumentSettings('${docId}')">
              Apply Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modal);
}
```

---

## Phase 5: Final Layout Assembly

### Complete Layout Structure

```css
/* Main Application Layout */
.app-container {
  display: grid;
  grid-template-columns: 280px 1fr 320px;
  grid-template-rows: 1fr;
  height: 100vh;
  background: #0f1419;
  overflow: hidden;
}

/* Character Sidebar (Left) */
.character-sidebar {
  grid-column: 1;
  display: flex;
  flex-direction: column;
  background: #151922;
  border-right: 1px solid #2a3142;
  overflow: hidden;
}

.sidebar-header {
  padding: 16px;
  background: #1a1f2e;
  border-bottom: 1px solid #2a3142;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sidebar-header h2 {
  font-size: 14px;
  font-weight: 600;
  color: #e4e6eb;
  margin: 0;
}

.add-character-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #4a9eff;
  border: none;
  color: white;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.add-character-btn:hover {
  background: #3a8eef;
  transform: scale(1.05);
}

/* Character list already defined above */

/* Chat Panel (Center) - Gets maximum space */
.chat-panel {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  background: #151922;
  overflow: hidden;
}

/* Chat components already defined above */

/* Documents Panel (Right) */
.documents-panel {
  grid-column: 3;
  border-left: 1px solid #2a3142;
}

/* Documents components already defined above */

/* Responsive: Collapse to single column on smaller screens */
@media (max-width: 1200px) {
  .app-container {
    grid-template-columns: 240px 1fr 280px;
  }
}

@media (max-width: 900px) {
  .app-container {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr auto;
  }
  
  .character-sidebar,
  .documents-panel {
    position: fixed;
    top: 0;
    bottom: 0;
    width: 280px;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.3s;
  }
  
  .character-sidebar {
    left: 0;
  }
  
  .documents-panel {
    right: 0;
    transform: translateX(100%);
  }
  
  .character-sidebar.open {
    transform: translateX(0);
  }
  
  .documents-panel.open {
    transform: translateX(0);
  }
}
```

---

## Testing Checklist

After implementation, verify:

- [ ] Top header is removed, gaining ~50px vertical space
- [ ] Ollama status visible in bottom-left corner
- [ ] Analytics panel collapses/expands on pill button click
- [ ] Context panel collapses/expands on pill button click
- [ ] Chat messages fill all available vertical space
- [ ] Character cards are compact (3-4 visible without scrolling)
- [ ] Character groups collapse/expand properly
- [ ] Document folder tree collapses/expand properly
- [ ] Document preview opens in modal (not always visible)
- [ ] Quick Actions tab shows all action buttons
- [ ] Layout responsive on smaller screens
- [ ] All animations smooth (no jank)
- [ ] Keyboard navigation still works (Ctrl+K, etc.)

---

## Estimated Space Gains

**Before:**
- Top header: 60px
- Analytics panel (expanded): 280px
- Context panel (expanded): 120px
- Character cards (bulky): 80px each
- Document preview (always visible): 180px
- **Total wasted space: ~720px**

**After:**
- Top header: 0px (removed)
- Analytics panel (collapsed): 0px
- Context panel (collapsed): 0px
- Character cards (compact): 45px each
- Document preview (hidden): 0px
- **Total space saved: ~720px → goes to chat messages!**

Your chat window just gained **60-70% more vertical space**! 🎉
