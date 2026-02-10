# Additions

## 1. Document Tags/Folders

**Data Structure:**

```javascript
// Add to document schema
{
  id: "doc_123",
  filename: "report.pdf",
  tags: ["project-alpha", "quarterly", "finance"],
  folder: "Projects/Q4-2026", // null for root
  // ... existing fields
}

// New folders table
folders = {
  "Projects": { parent: null, color: "#4a9eff" },
  "Projects/Q4-2026": { parent: "Projects", color: "#4a9eff" }
}
```

**UI Changes:**

- Add tag input field in document upload modal (autocomplete from existing tags)
- Folder tree view in Documents panel (collapsible, above Global Library)
- Tag filter chips below search bar
- Bulk tag editor (select multiple docs, add/remove tags)

**Implementation:**

```javascript
// In documents.js
function filterDocumentsByTags(tags) {
  return allDocs.filter(doc => 
    tags.every(tag => doc.tags?.includes(tag))
  );
}

function getDocumentsInFolder(folderPath) {
  return allDocs.filter(doc => 
    doc.folder === folderPath || 
    doc.folder?.startsWith(folderPath + '/')
  );
}
```

---

## 2. Conversation Search

**Data Structure:**

```javascript
// Index messages for search
conversationIndex = {
  "char_123_branch_456": {
    messages: [
      { role: "user", content: "...", timestamp: 1234567890 },
      { role: "assistant", content: "...", timestamp: 1234567891 }
    ],
    characterId: "char_123",
    branchId: "branch_456",
    documentIds: ["doc_1", "doc_2"] // docs used in this conversation
  }
}
```

**UI Changes:**

- Add search icon to chat panel header
- Search modal/sidebar with filters:
  - Full-text query
  - Character dropdown (multi-select)
  - Date range picker
  - "Documents used" filter
- Results show: snippet + character + timestamp + "Jump to conversation" button

**Implementation:**

```javascript
// Simple client-side search
function searchConversations(query, filters = {}) {
  const results = [];
  
  for (const [convId, conv] of Object.entries(conversationIndex)) {
    // Filter by character
    if (filters.characterIds?.length && 
        !filters.characterIds.includes(conv.characterId)) {
      continue;
    }
    
    // Filter by date
    if (filters.startDate && conv.messages[0].timestamp < filters.startDate) {
      continue;
    }
    
    // Search messages
    conv.messages.forEach((msg, idx) => {
      if (msg.content.toLowerCase().includes(query.toLowerCase())) {
        results.push({
          conversationId: convId,
          characterId: conv.characterId,
          messageIndex: idx,
          snippet: getSnippet(msg.content, query),
          timestamp: msg.timestamp
        });
      }
    });
  }
  
  return results.sort((a, b) => b.timestamp - a.timestamp);
}

function getSnippet(text, query, contextLength = 100) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + query.length + contextLength);
  return '...' + text.slice(start, end) + '...';
}
```

---

## 3. Context Usage Visualization

**Data Structure:**

```javascript
// Enhance message metadata
{
  role: "assistant",
  content: "...",
  metadata: {
    model: "llama2",
    timestamp: 1234567890,
    contextUsed: {
      systemPrompt: { tokens: 200 },
      documents: [
        { docId: "doc_1", chunkIds: [0, 2, 5], tokens: 1500 },
        { docId: "doc_2", chunkIds: [1], tokens: 800 }
      ],
      conversationHistory: { tokens: 2000 },
      total: 4500,
      limit: 8192
    }
  }
}
```

**UI Changes:**

- Add expandable "Context Details" section below each assistant message
- Visual progress bar showing token allocation:
  - System (red) | Docs (blue) | History (green) | Available (gray)
- Click document to highlight which chunks were used
- Warning icon when approaching context limit

**Implementation:**

```javascript
// Before sending to Ollama, calculate what you're sending
function buildPrompt(character, conversation, assignedDocs) {
  const systemTokens = estimateTokens(character.systemPrompt);
  
  const docChunks = [];
  let docTokens = 0;
  for (const doc of assignedDocs) {
    const chunks = getRelevantChunks(doc, conversation.messages);
    chunks.forEach(chunk => {
      docChunks.push({ docId: doc.id, chunkId: chunk.id });
      docTokens += estimateTokens(chunk.text);
    });
  }
  
  const historyTokens = conversation.messages.reduce(
    (sum, msg) => sum + estimateTokens(msg.content), 0
  );
  
  return {
    prompt: buildOllamaPrompt(...),
    contextUsed: {
      systemPrompt: { tokens: systemTokens },
      documents: docChunks.map(c => ({ 
        docId: c.docId, 
        chunkId: c.chunkId,
        tokens: estimateTokens(getChunk(c.docId, c.chunkId).text)
      })),
      conversationHistory: { tokens: historyTokens },
      total: systemTokens + docTokens + historyTokens,
      limit: character.contextWindow || 8192
    }
  };
}

// Rough token estimation (4 chars ≈ 1 token)
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
```

**Chunk Preview UI:**

```javascript
// When user clicks on document in context details
function showChunkHighlight(docId, chunkIds) {
  const doc = getDocument(docId);
  const highlightedText = doc.chunks.map((chunk, idx) => {
    if (chunkIds.includes(idx)) {
      return `<mark class="context-used">${chunk.text}</mark>`;
    }
    return `<span class="context-unused">${chunk.text}</span>`;
  }).join('\n\n');
  
  // Show in modal
  showModal('Document Context Preview', highlightedText);
}
```

---

## 4. Message Editing

**Data Structure:**

```javascript
// Messages already exist, just need edit capability
{
  role: "user",
  content: "Original message",
  editHistory: [
    { content: "First edit", timestamp: 1234567890 },
    { content: "Second edit", timestamp: 1234567900 }
  ],
  currentVersion: 1 // index in editHistory, or -1 for original
}
```

**UI Changes:**

- Hover over user message → show "Edit" button
- Click Edit → message becomes editable textarea
- Save → regenerate assistant response from that point
- Show "Edited" badge on edited messages
- Optionally view edit history

**Implementation:**

```javascript
function editMessage(conversationId, messageIndex, newContent) {
  const conversation = getConversation(conversationId);
  const message = conversation.messages[messageIndex];
  
  // Store edit history
  if (!message.editHistory) {
    message.editHistory = [{ content: message.content, timestamp: Date.now() }];
  }
  message.editHistory.push({ content: newContent, timestamp: Date.now() });
  message.content = newContent;
  message.currentVersion = message.editHistory.length - 1;
  
  // Remove all messages after this one (they're based on old content)
  conversation.messages = conversation.messages.slice(0, messageIndex + 1);
  
  // Regenerate response
  generateResponse(conversationId, conversation.characterId);
  
  saveConversation(conversation);
}

// UI component
function renderUserMessage(msg, msgIndex, convId) {
  return `
    <div class="message user-message">
      <div class="message-content">${msg.content}</div>
      ${msg.editHistory ? '<span class="edited-badge">Edited</span>' : ''}
      <button onclick="editMessage(${convId}, ${msgIndex})">Edit</button>
      ${msg.editHistory ? `<button onclick="showEditHistory(${msgIndex})">History</button>` : ''}
      <span class="timestamp">${formatTime(msg.timestamp)}</span>
    </div>
  `;
}
```

---

## 5. Conversation Auto-Naming

**Implementation:**

```javascript
// After first assistant response, generate a name
async function autoNameConversation(conversationId) {
  const conversation = getConversation(conversationId);
  
  // Only name if unnamed and has at least 2 messages
  if (conversation.label || conversation.messages.length < 2) {
    return;
  }
  
  // Use lightweight model to generate name
  const prompt = `Based on this conversation start, suggest a brief descriptive title (max 5 words):

User: ${conversation.messages[0].content}
Assistant: ${conversation.messages[1].content}

Title:`;

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: 'gemma:2b', // Use smallest/fastest model
      prompt: prompt,
      stream: false
    })
  });
  
  const data = await response.json();
  const title = data.response.trim().replace(/['"]/g, '').slice(0, 50);
  
  conversation.label = title;
  saveConversation(conversation);
  updateUI();
}

// Call after first response
async function onAssistantMessageComplete(conversationId) {
  // ... existing completion logic
  await autoNameConversation(conversationId);
}
```

---

## 6. Prompt Chains

**Data Structure:**

```javascript
// New chain schema
chains = {
  "chain_123": {
    name: "Draft → Review → Finalize",
    steps: [
      {
        characterId: "char_draft",
        promptTemplate: "{input}", // First step uses user input
        outputVariable: "draft"
      },
      {
        characterId: "char_review",
        promptTemplate: "Review this draft:\n\n{draft}",
        outputVariable: "review"
      },
      {
        characterId: "char_final",
        promptTemplate: "Finalize based on review:\nDraft: {draft}\nReview: {review}",
        outputVariable: "final"
      }
    ]
  }
}
```

**UI Changes:**

- New "Chains" tab in Quick Actions
- Chain builder interface:
  - Add step (select character, write prompt template with {variables})
  - Drag to reorder steps
  - Preview flow diagram
- Run chain → shows progress through steps
- View intermediate outputs

**Implementation:**

```javascript
async function runChain(chainId, initialInput) {
  const chain = chains[chainId];
  const variables = { input: initialInput };
  const results = [];
  
  for (const [index, step] of chain.steps.entries()) {
    // Replace variables in prompt template
    let prompt = step.promptTemplate;
    for (const [key, value] of Object.entries(variables)) {
      prompt = prompt.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    
    // Generate response
    updateChainProgress(chainId, index, 'running');
    const response = await generateWithCharacter(step.characterId, prompt);
    
    // Store output
    variables[step.outputVariable] = response;
    results.push({
      stepIndex: index,
      characterId: step.characterId,
      prompt: prompt,
      response: response
    });
    
    updateChainProgress(chainId, index, 'complete');
  }
  
  // Show final results
  displayChainResults(results);
  return variables;
}

async function generateWithCharacter(characterId, prompt) {
  const character = getCharacter(characterId);
  
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: character.model,
      prompt: buildFullPrompt(character, prompt),
      temperature: character.temperature,
      stream: false
    })
  });
  
  const data = await response.json();
  return data.response;
}
```

---

## 7. Smart Context Windowing

**Implementation:**

```javascript
// Automatic context management
function buildSmartContext(character, conversation, assignedDocs) {
  const contextLimit = character.contextWindow || 8192;
  const systemTokens = estimateTokens(character.systemPrompt);
  let availableTokens = contextLimit - systemTokens - 500; // Reserve 500 for response
  
  // Priority 1: Always include pinned documents (full)
  const pinnedDocs = assignedDocs.filter(d => d.pinned);
  const pinnedChunks = [];
  for (const doc of pinnedDocs) {
    const chunks = doc.chunks.filter(c => c.priority === 'high');
    chunks.forEach(chunk => {
      const tokens = estimateTokens(chunk.text);
      if (availableTokens > tokens) {
        pinnedChunks.push(chunk.text);
        availableTokens -= tokens;
      }
    });
  }
  
  // Priority 2: Recent conversation (keep last N messages)
  const recentMessages = [];
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const msg = conversation.messages[i];
    const tokens = estimateTokens(msg.content);
    
    if (availableTokens > tokens) {
      recentMessages.unshift(msg);
      availableTokens -= tokens;
    } else {
      break; // No more room
    }
  }
  
  // Priority 3: Relevant document chunks (semantic search)
  const otherDocs = assignedDocs.filter(d => !d.pinned);
  const relevantChunks = findRelevantChunks(
    conversation.messages[conversation.messages.length - 1]?.content,
    otherDocs,
    availableTokens
  );
  
  // Priority 4: If still room, summarize older conversation
  let conversationSummary = '';
  if (availableTokens > 500 && conversation.messages.length > recentMessages.length) {
    const olderMessages = conversation.messages.slice(0, conversation.messages.length - recentMessages.length);
    conversationSummary = await summarizeConversation(olderMessages, character.model);
    availableTokens -= estimateTokens(conversationSummary);
  }
  
  return {
    systemPrompt: character.systemPrompt,
    pinnedDocuments: pinnedChunks.join('\n\n'),
    conversationSummary: conversationSummary,
    recentMessages: recentMessages,
    relevantChunks: relevantChunks,
    tokensUsed: contextLimit - availableTokens,
    tokensAvailable: availableTokens
  };
}

// Simple semantic search (could use embeddings for better results)
function findRelevantChunks(query, docs, maxTokens) {
  const scoredChunks = [];
  
  docs.forEach(doc => {
    doc.chunks.forEach(chunk => {
      const score = calculateRelevance(query, chunk.text);
      scoredChunks.push({ text: chunk.text, score: score, tokens: estimateTokens(chunk.text) });
    });
  });
  
  // Sort by relevance, take until token limit
  scoredChunks.sort((a, b) => b.score - a.score);
  
  const selected = [];
  let used = 0;
  for (const chunk of scoredChunks) {
    if (used + chunk.tokens <= maxTokens) {
      selected.push(chunk.text);
      used += chunk.tokens;
    }
  }
  
  return selected;
}

// Basic keyword matching (could upgrade to TF-IDF or embeddings)
function calculateRelevance(query, text) {
  const queryWords = query.toLowerCase().split(/\s+/);
  const textLower = text.toLowerCase();
  
  let score = 0;
  queryWords.forEach(word => {
    const occurrences = (textLower.match(new RegExp(word, 'g')) || []).length;
    score += occurrences;
  });
  
  return score;
}

async function summarizeConversation(messages, model) {
  const conversationText = messages.map(m => 
    `${m.role}: ${m.content}`
  ).join('\n\n');
  
  const prompt = `Summarize this conversation in 2-3 sentences:\n\n${conversationText}\n\nSummary:`;
  
  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: 'gemma:2b', // Fast model for summarization
      prompt: prompt,
      stream: false
    })
  });
  
  const data = await response.json();
  return data.response.trim();
}
```

---

## Quick Wins (Low Effort, High Impact)

### Copy Formatting Options

```javascript
function copyMessage(messageContent, format = 'plain') {
  let textToCopy;
  
  switch(format) {
    case 'markdown':
      textToCopy = messageContent; // Already in markdown if using markdown
      break;
    case 'plain':
      textToCopy = stripMarkdown(messageContent);
      break;
    case 'code':
      // Extract only code blocks
      const codeBlocks = messageContent.match(/```[\s\S]*?```/g) || [];
      textToCopy = codeBlocks.map(block => 
        block.replace(/```[a-z]*\n?/, '').replace(/```$/, '')
      ).join('\n\n');
      break;
  }
  
  navigator.clipboard.writeText(textToCopy);
  showToast('Copied to clipboard');
}

// Add to message UI
function renderMessageActions(msg) {
  return `
    <div class="message-actions">
      <button onclick="copyMessage('${escapeQuotes(msg.content)}', 'plain')">Copy</button>
      <button onclick="copyMessage('${escapeQuotes(msg.content)}', 'markdown')">Copy as Markdown</button>
      <button onclick="copyMessage('${escapeQuotes(msg.content)}', 'code')">Copy Code Only</button>
    </div>
  `;
}
```

### Auto-save Drafts

```javascript
// In input handler
function onInputChange(characterId, inputText) {
  // Save draft every 2 seconds
  clearTimeout(window.draftSaveTimeout);
  window.draftSaveTimeout = setTimeout(() => {
    localStorage.setItem(`draft_${characterId}`, inputText);
  }, 2000);
}

// On load
function loadDraft(characterId) {
  const draft = localStorage.getItem(`draft_${characterId}`);
  if (draft) {
    document.getElementById('chat-input').value = draft;
    showToast('Draft restored');
  }
}

// On send
function onSendMessage(characterId) {
  // Clear draft after sending
  localStorage.removeItem(`draft_${characterId}`);
  // ... send logic
}
```

---

# Detailed Implementation Guide - Remaining Features

## 8. Usage Analytics Dashboard

### Data Collection Layer

**Tracking Schema:**

```javascript
// analytics.js - New file
const analytics = {
  sessions: {
    "session_2026-02-09_001": {
      startTime: 1234567890,
      endTime: 1234570000,
      charactersUsed: ["char_1", "char_2"],
      totalMessages: 45,
      totalTokens: 12500
    }
  },
  
  characterStats: {
    "char_1": {
      totalUses: 150,
      totalMessages: 450,
      avgResponseTime: 2.3, // seconds
      avgTokensPerResponse: 280,
      modelBreakdown: {
        "llama2": { uses: 100, avgTime: 2.1 },
        "mistral": { uses: 50, avgTime: 2.7 }
      },
      documentsUsedWith: {
        "doc_1": 45, // times this doc was active
        "doc_2": 30
      },
      ratingDistribution: {
        thumbsUp: 120,
        thumbsDown: 30
      }
    }
  },
  
  documentStats: {
    "doc_1": {
      timesUsed: 89,
      charactersUsedWith: ["char_1", "char_2"],
      avgChunksPerUse: 3.2,
      lastUsed: 1234567890
    }
  },
  
  modelPerformance: {
    "llama2": {
      totalCalls: 200,
      avgResponseTime: 2.1,
      avgFirstTokenLatency: 0.4,
      avgTokensPerSecond: 45,
      timesByTemperature: {
        "0.7": { calls: 100, avgTime: 2.0 },
        "1.0": { calls: 100, avgTime: 2.2 }
      }
    }
  },
  
  dailyActivity: {
    "2026-02-09": {
      messages: 45,
      characters: ["char_1", "char_2"],
      tokens: 12500,
      timeSpent: 3600 // seconds
    }
  }
};
```

**Event Tracking:**

```javascript
// Track every interaction
function trackEvent(eventType, eventData) {
  const event = {
    timestamp: Date.now(),
    type: eventType,
    ...eventData
  };
  
  // Add to session
  const currentSession = getCurrentSession();
  if (!currentSession.events) currentSession.events = [];
  currentSession.events.push(event);
  
  // Update aggregated stats
  updateAnalytics(eventType, eventData);
  
  // Persist
  saveAnalytics();
}

// Hook into existing functions
function onMessageSent(characterId, message) {
  trackEvent('message_sent', {
    characterId: characterId,
    messageLength: message.length,
    documentsActive: getActiveDocuments(characterId).map(d => d.id)
  });
  
  // ... existing send logic
}

function onResponseReceived(characterId, response, metadata) {
  trackEvent('response_received', {
    characterId: characterId,
    model: metadata.model,
    responseTime: metadata.responseTime,
    firstTokenLatency: metadata.firstTokenLatency,
    tokensGenerated: metadata.tokens,
    tokensPerSecond: metadata.tokens / metadata.responseTime
  });
  
  // Update character stats
  updateCharacterStats(characterId, metadata);
  updateModelStats(metadata.model, metadata);
  
  // ... existing response handling
}

function updateCharacterStats(characterId, metadata) {
  if (!analytics.characterStats[characterId]) {
    analytics.characterStats[characterId] = {
      totalUses: 0,
      totalMessages: 0,
      avgResponseTime: 0,
      avgTokensPerResponse: 0,
      modelBreakdown: {},
      documentsUsedWith: {},
      ratingDistribution: { thumbsUp: 0, thumbsDown: 0 }
    };
  }
  
  const stats = analytics.characterStats[characterId];
  stats.totalUses++;
  stats.totalMessages++;
  
  // Running average for response time
  stats.avgResponseTime = 
    (stats.avgResponseTime * (stats.totalMessages - 1) + metadata.responseTime) 
    / stats.totalMessages;
  
  // Running average for tokens
  stats.avgTokensPerResponse = 
    (stats.avgTokensPerResponse * (stats.totalMessages - 1) + metadata.tokens) 
    / stats.totalMessages;
  
  // Model breakdown
  if (!stats.modelBreakdown[metadata.model]) {
    stats.modelBreakdown[metadata.model] = { uses: 0, avgTime: 0 };
  }
  const modelStats = stats.modelBreakdown[metadata.model];
  modelStats.uses++;
  modelStats.avgTime = 
    (modelStats.avgTime * (modelStats.uses - 1) + metadata.responseTime) 
    / modelStats.uses;
  
  saveAnalytics();
}
```

### Dashboard UI

**New Analytics Panel:**

```javascript
// analytics-ui.js
function renderAnalyticsDashboard() {
  return `
    <div class="analytics-dashboard">
      <div class="analytics-header">
        <h2>Analytics Dashboard</h2>
        <select id="analytics-timeframe">
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="all">All Time</option>
        </select>
      </div>
      
      <div class="analytics-grid">
        <!-- Summary Cards -->
        <div class="stat-card">
          <div class="stat-label">Total Messages</div>
          <div class="stat-value">${getTotalMessages()}</div>
          <div class="stat-trend">+12% vs last week</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">Avg Response Time</div>
          <div class="stat-value">${getAvgResponseTime()}s</div>
          <div class="stat-trend">-5% vs last week</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">Most Used Character</div>
          <div class="stat-value">${getMostUsedCharacter().name}</div>
          <div class="stat-subtext">${getMostUsedCharacter().uses} uses</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">Tokens Generated</div>
          <div class="stat-value">${formatNumber(getTotalTokens())}</div>
          <div class="stat-trend">~${estimateCost()} API cost equivalent</div>
        </div>
        
        <!-- Character Usage Chart -->
        <div class="chart-card span-2">
          <h3>Character Usage</h3>
          <canvas id="character-usage-chart"></canvas>
        </div>
        
        <!-- Model Performance Chart -->
        <div class="chart-card span-2">
          <h3>Model Performance</h3>
          <canvas id="model-performance-chart"></canvas>
        </div>
        
        <!-- Activity Heatmap -->
        <div class="chart-card span-4">
          <h3>Activity Over Time</h3>
          <div id="activity-heatmap"></div>
        </div>
        
        <!-- Document Usage Table -->
        <div class="table-card span-2">
          <h3>Most Used Documents</h3>
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Uses</th>
                <th>Avg Chunks</th>
                <th>Last Used</th>
              </tr>
            </thead>
            <tbody>
              ${renderDocumentUsageRows()}
            </tbody>
          </table>
        </div>
        
        <!-- Character Leaderboard -->
        <div class="table-card span-2">
          <h3>Character Performance</h3>
          <table>
            <thead>
              <tr>
                <th>Character</th>
                <th>Rating</th>
                <th>Avg Time</th>
                <th>Uses</th>
              </tr>
            </thead>
            <tbody>
              ${renderCharacterLeaderboard()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// Chart rendering with Chart.js
function renderCharacterUsageChart() {
  const ctx = document.getElementById('character-usage-chart').getContext('2d');
  
  const data = Object.entries(analytics.characterStats)
    .sort((a, b) => b[1].totalUses - a[1].totalUses)
    .slice(0, 10);
  
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(([id, stats]) => getCharacter(id).name),
      datasets: [{
        label: 'Messages',
        data: data.map(([id, stats]) => stats.totalMessages),
        backgroundColor: '#4a9eff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

function renderModelPerformanceChart() {
  const ctx = document.getElementById('model-performance-chart').getContext('2d');
  
  const models = Object.entries(analytics.modelPerformance);
  
  new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: models.map(([model, stats]) => ({
        label: model,
        data: [{
          x: stats.avgResponseTime,
          y: stats.avgTokensPerSecond,
          r: Math.sqrt(stats.totalCalls) * 2 // Bubble size based on usage
        }]
      }))
    },
    options: {
      scales: {
        x: { title: { display: true, text: 'Avg Response Time (s)' } },
        y: { title: { display: true, text: 'Tokens/Second' } }
      }
    }
  });
}

// Activity heatmap
function renderActivityHeatmap() {
  const container = document.getElementById('activity-heatmap');
  const days = getLast30Days();
  
  const heatmapHTML = days.map(day => {
    const activity = analytics.dailyActivity[day] || { messages: 0 };
    const intensity = Math.min(activity.messages / 50, 1); // Cap at 50 messages
    
    return `
      <div class="heatmap-cell" 
           style="background: rgba(74, 158, 255, ${intensity})"
           title="${day}: ${activity.messages} messages">
      </div>
    `;
  }).join('');
  
  container.innerHTML = heatmapHTML;
}
```

---

## 9. Message Rating & Quality Tracking

**Rating System:**

```javascript
// Add to message schema
{
  role: "assistant",
  content: "...",
  metadata: {
    // ... existing metadata
    rating: null, // null, 'up', 'down'
    ratingTimestamp: null,
    ratingNote: "" // Optional user note on why
  }
}

// Rating UI
function renderMessageRating(message, messageIndex, conversationId) {
  const isRated = message.metadata?.rating !== null;
  const ratingUp = message.metadata?.rating === 'up';
  const ratingDown = message.metadata?.rating === 'down';
  
  return `
    <div class="message-rating">
      <button class="rating-btn ${ratingUp ? 'active' : ''}"
              onclick="rateMessage('${conversationId}', ${messageIndex}, 'up')">
        👍 ${ratingUp ? '✓' : ''}
      </button>
      <button class="rating-btn ${ratingDown ? 'active' : ''}"
              onclick="rateMessage('${conversationId}', ${messageIndex}, 'down')">
        👎 ${ratingDown ? '✓' : ''}
      </button>
      ${isRated ? `<button onclick="showRatingNote('${conversationId}', ${messageIndex})">Note</button>` : ''}
    </div>
  `;
}

function rateMessage(conversationId, messageIndex, rating) {
  const conversation = getConversation(conversationId);
  const message = conversation.messages[messageIndex];
  
  // Toggle if clicking same rating
  if (message.metadata.rating === rating) {
    message.metadata.rating = null;
    message.metadata.ratingTimestamp = null;
  } else {
    message.metadata.rating = rating;
    message.metadata.ratingTimestamp = Date.now();
  }
  
  // Update character stats
  const characterId = conversation.characterId;
  updateCharacterRating(characterId, rating, message.metadata.rating === null);
  
  // Prompt for note if thumbs down
  if (rating === 'down' && message.metadata.rating === 'down') {
    showRatingNoteDialog(conversationId, messageIndex);
  }
  
  saveConversation(conversation);
  renderMessages();
}

function showRatingNoteDialog(conversationId, messageIndex) {
  const conversation = getConversation(conversationId);
  const message = conversation.messages[messageIndex];
  
  const note = prompt('Why was this response not helpful? (Optional)');
  if (note) {
    message.metadata.ratingNote = note;
    saveConversation(conversation);
  }
}

// A/B Testing support
function comparePromptVariants(characterId, promptVariants) {
  const results = [];
  
  for (const [index, variant] of promptVariants.entries()) {
    // Create temporary conversation branch
    const branchId = createTempBranch(characterId, variant.systemPrompt);
    
    // Send test message
    const response = await generateResponse(branchId, variant.testMessage);
    
    results.push({
      variantIndex: index,
      variantName: variant.name,
      systemPrompt: variant.systemPrompt,
      response: response,
      responseTime: response.metadata.responseTime,
      tokens: response.metadata.tokens
    });
  }
  
  // Display comparison UI
  displayPromptComparison(results);
  
  return results;
}

// Comparison UI
function displayPromptComparison(results) {
  const comparisonHTML = `
    <div class="prompt-comparison">
      <h3>Prompt Variant Comparison</h3>
      <div class="comparison-grid">
        ${results.map((result, idx) => `
          <div class="variant-card">
            <h4>${result.variantName}</h4>
            <div class="variant-metrics">
              <span>Time: ${result.responseTime.toFixed(2)}s</span>
              <span>Tokens: ${result.tokens}</span>
            </div>
            <div class="variant-prompt">
              <strong>System Prompt:</strong>
              <pre>${result.systemPrompt}</pre>
            </div>
            <div class="variant-response">
              <strong>Response:</strong>
              <div>${result.response.content}</div>
            </div>
            <div class="variant-actions">
              <button onclick="adoptVariant(${idx})">Use This Variant</button>
              <button onclick="rateVariant(${idx}, 'up')">👍</button>
              <button onclick="rateVariant(${idx}, 'down')">👎</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  
  showModal('Prompt Comparison', comparisonHTML);
}
```

---

## 10. Character Grouping & Organization

**Data Structure:**

```javascript
// Add groups schema
characterGroups = {
  "group_work": {
    name: "Work Projects",
    color: "#4a9eff",
    characterIds: ["char_1", "char_2"],
    collapsed: false
  },
  "group_personal": {
    name: "Personal Assistants",
    color: "#4caf50",
    characterIds: ["char_3", "char_4"],
    collapsed: false
  }
};

// Add to character schema
{
  id: "char_1",
  name: "Code Reviewer",
  groupId: "group_work", // null if ungrouped
  sortOrder: 0, // For custom ordering within group
  // ... existing fields
}
```

**UI Implementation:**

```javascript
// Render grouped character list
function renderCharacterSidebar() {
  const grouped = groupCharactersByGroup();
  const ungrouped = getUngroupedCharacters();
  
  let html = '<div class="character-sidebar">';
  
  // Render groups
  for (const [groupId, group] of Object.entries(characterGroups)) {
    const characters = grouped[groupId] || [];
    const isCollapsed = group.collapsed;
    
    html += `
      <div class="character-group" style="border-left: 3px solid ${group.color}">
        <div class="group-header" onclick="toggleGroup('${groupId}')">
          <span class="group-icon">${isCollapsed ? '▶' : '▼'}</span>
          <span class="group-name">${group.name}</span>
          <span class="group-count">${characters.length}</span>
          <button class="group-menu" onclick="showGroupMenu('${groupId}')">⋮</button>
        </div>
        
        <div class="group-characters" style="display: ${isCollapsed ? 'none' : 'block'}">
          ${characters.map(char => renderCharacterCard(char)).join('')}
        </div>
      </div>
    `;
  }
  
  // Render ungrouped characters
  if (ungrouped.length > 0) {
    html += `
      <div class="character-group ungrouped">
        <div class="group-header">
          <span class="group-name">Ungrouped</span>
          <span class="group-count">${ungrouped.length}</span>
        </div>
        <div class="group-characters">
          ${ungrouped.map(char => renderCharacterCard(char)).join('')}
        </div>
      </div>
    `;
  }
  
  html += '</div>';
  
  document.getElementById('character-sidebar').innerHTML = html;
}

// Drag and drop for reordering
function enableCharacterDragDrop() {
  const characterCards = document.querySelectorAll('.character-card');
  
  characterCards.forEach(card => {
    card.setAttribute('draggable', true);
    
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('characterId', card.dataset.characterId);
      card.classList.add('dragging');
    });
    
    card.addEventListener('dragend', (e) => {
      card.classList.remove('dragging');
    });
    
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = document.querySelector('.dragging');
      const afterElement = getDragAfterElement(card.parentElement, e.clientY);
      
      if (afterElement == null) {
        card.parentElement.appendChild(dragging);
      } else {
        card.parentElement.insertBefore(dragging, afterElement);
      }
    });
    
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const characterId = e.dataTransfer.getData('characterId');
      const targetGroupId = card.closest('.character-group').dataset.groupId;
      
      // Update character's group
      moveCharacterToGroup(characterId, targetGroupId);
      
      // Update sort orders based on new position
      updateSortOrders(targetGroupId);
    });
  });
}

function moveCharacterToGroup(characterId, groupId) {
  const character = getCharacter(characterId);
  character.groupId = groupId === 'ungrouped' ? null : groupId;
  
  if (groupId !== 'ungrouped') {
    characterGroups[groupId].characterIds.push(characterId);
  }
  
  saveCharacters();
  renderCharacterSidebar();
}

// Group management menu
function showGroupMenu(groupId) {
  const group = characterGroups[groupId];
  
  const menuHTML = `
    <div class="group-menu-popup">
      <button onclick="renameGroup('${groupId}')">Rename Group</button>
      <button onclick="changeGroupColor('${groupId}')">Change Color</button>
      <button onclick="exportGroup('${groupId}')">Export Group</button>
      <button onclick="deleteGroup('${groupId}')" class="danger">Delete Group</button>
    </div>
  `;
  
  showContextMenu(menuHTML, event);
}

function createNewGroup() {
  const name = prompt('Group name:');
  if (!name) return;
  
  const groupId = 'group_' + Date.now();
  characterGroups[groupId] = {
    name: name,
    color: getRandomColor(),
    characterIds: [],
    collapsed: false
  };
  
  saveGroups();
  renderCharacterSidebar();
}
```

---

## 11. Inline Message Annotations

**Data Structure:**

```javascript
// Add to message schema
{
  role: "assistant",
  content: "...",
  metadata: {
    // ... existing
    annotations: [
      {
        id: "anno_123",
        text: "This response was particularly good because...",
        timestamp: 1234567890,
        type: "note", // 'note', 'feedback', 'bookmark'
        highlighted: false
      }
    ]
  }
}
```

**UI Implementation:**

```javascript
// Annotation button on message hover
function renderMessageWithAnnotations(message, messageIndex, conversationId) {
  const hasAnnotations = message.metadata?.annotations?.length > 0;
  
  return `
    <div class="message assistant-message" data-message-index="${messageIndex}">
      <div class="message-content">${message.content}</div>
      
      <div class="message-actions">
        <button onclick="toggleAnnotation('${conversationId}', ${messageIndex})" 
                class="${hasAnnotations ? 'has-annotation' : ''}">
          📝 ${hasAnnotations ? message.metadata.annotations.length : 'Annotate'}
        </button>
        ${renderMessageRating(message, messageIndex, conversationId)}
      </div>
      
      ${hasAnnotations ? `
        <div class="message-annotations">
          ${message.metadata.annotations.map(anno => renderAnnotation(anno, conversationId, messageIndex)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function toggleAnnotation(conversationId, messageIndex) {
  const conversation = getConversation(conversationId);
  const message = conversation.messages[messageIndex];
  
  if (!message.metadata.annotations) {
    message.metadata.annotations = [];
  }
  
  // Show annotation editor
  showAnnotationEditor(conversationId, messageIndex);
}

function showAnnotationEditor(conversationId, messageIndex) {
  const conversation = getConversation(conversationId);
  const message = conversation.messages[messageIndex];
  
  const editorHTML = `
    <div class="annotation-editor">
      <textarea id="annotation-text" 
                placeholder="Add your notes about this response..."></textarea>
      
      <div class="annotation-options">
        <label>
          <input type="checkbox" id="annotation-highlight">
          Highlight this message
        </label>
        
        <select id="annotation-type">
          <option value="note">Note</option>
          <option value="feedback">Feedback</option>
          <option value="bookmark">Bookmark</option>
        </select>
      </div>
      
      <div class="annotation-actions">
        <button onclick="saveAnnotation('${conversationId}', ${messageIndex})">Save</button>
        <button onclick="closeAnnotationEditor()">Cancel</button>
      </div>
    </div>
  `;
  
  // Insert editor below message
  const messageElement = document.querySelector(`[data-message-index="${messageIndex}"]`);
  messageElement.insertAdjacentHTML('beforeend', editorHTML);
}

function saveAnnotation(conversationId, messageIndex) {
  const text = document.getElementById('annotation-text').value;
  if (!text.trim()) return;
  
  const conversation = getConversation(conversationId);
  const message = conversation.messages[messageIndex];
  
  if (!message.metadata.annotations) {
    message.metadata.annotations = [];
  }
  
  message.metadata.annotations.push({
    id: 'anno_' + Date.now(),
    text: text,
    timestamp: Date.now(),
    type: document.getElementById('annotation-type').value,
    highlighted: document.getElementById('annotation-highlight').checked
  });
  
  saveConversation(conversation);
  closeAnnotationEditor();
  renderMessages();
}

// Build personal feedback dataset
function exportFeedbackDataset() {
  const dataset = [];
  
  // Collect all rated and annotated messages
  for (const conversation of Object.values(conversations)) {
    conversation.messages.forEach((message, index) => {
      if (message.role === 'assistant' && 
          (message.metadata?.rating || message.metadata?.annotations?.length > 0)) {
        
        const userMessage = conversation.messages[index - 1];
        
        dataset.push({
          prompt: userMessage?.content || '',
          response: message.content,
          rating: message.metadata.rating,
          annotations: message.metadata.annotations || [],
          character: conversation.characterId,
          model: message.metadata.model,
          timestamp: message.metadata.timestamp
        });
      }
    });
  }
  
  // Export as JSON
  const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `feedback-dataset-${Date.now()}.json`;
  a.click();
}
```

---

## 12. Advanced Export Options

**Markdown Export:**

```javascript
function exportConversationAsMarkdown(conversationId) {
  const conversation = getConversation(conversationId);
  const character = getCharacter(conversation.characterId);
  
  let markdown = `# Conversation with ${character.name}\n\n`;
  markdown += `**Model:** ${character.model}\n`;
  markdown += `**Date:** ${new Date(conversation.timestamp).toLocaleDateString()}\n\n`;
  
  if (conversation.documentIds?.length > 0) {
    markdown += `## Documents Used\n\n`;
    conversation.documentIds.forEach(docId => {
      const doc = getDocument(docId);
      markdown += `- ${doc.filename}\n`;
    });
    markdown += `\n`;
  }
  
  markdown += `## Conversation\n\n`;
  
  conversation.messages.forEach((message, index) => {
    if (message.role === 'user') {
      markdown += `### You\n\n${message.content}\n\n`;
    } else {
      markdown += `### ${character.name}\n\n${message.content}\n\n`;
      
      // Add metadata
      if (message.metadata) {
        markdown += `<details>\n<summary>Metadata</summary>\n\n`;
        markdown += `- Response time: ${message.metadata.responseTime?.toFixed(2)}s\n`;
        markdown += `- Tokens: ${message.metadata.tokens}\n`;
        if (message.metadata.rating) {
          markdown += `- Rating: ${message.metadata.rating === 'up' ? '👍' : '👎'}\n`;
        }
        markdown += `\n</details>\n\n`;
      }
      
      // Add annotations
      if (message.metadata?.annotations?.length > 0) {
        markdown += `> **Notes:**\n`;
        message.metadata.annotations.forEach(anno => {
          markdown += `> - ${anno.text}\n`;
        });
        markdown += `\n`;
      }
    }
  });
  
  // Download
  downloadTextFile(markdown, `conversation-${conversationId}.md`);
}

// PDF Export (using jsPDF)
async function exportConversationAsPDF(conversationId) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  
  const conversation = getConversation(conversationId);
  const character = getCharacter(conversation.characterId);
  
  let y = 20;
  
  // Title
  doc.setFontSize(18);
  doc.text(`Conversation with ${character.name}`, 20, y);
  y += 10;
  
  // Metadata
  doc.setFontSize(10);
  doc.text(`Model: ${character.model}`, 20, y);
  y += 6;
  doc.text(`Date: ${new Date(conversation.timestamp).toLocaleDateString()}`, 20, y);
  y += 12;
  
  // Messages
  conversation.messages.forEach((message, index) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    
    // Role header
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(message.role === 'user' ? 'You' : character.name, 20, y);
    y += 8;
    
    // Content
    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    
    const lines = doc.splitTextToSize(message.content, 170);
    doc.text(lines, 20, y);
    y += (lines.length * 6) + 6;
  });
  
  doc.save(`conversation-${conversationId}.pdf`);
}

// HTML Export with styling
function exportConversationAsHTML(conversationId) {
  const conversation = getConversation(conversationId);
  const character = getCharacter(conversation.characterId);
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Conversation with ${character.name}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .conversation {
      background: white;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      border-bottom: 2px solid #eee;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .message {
      margin-bottom: 20px;
      padding: 15px;
      border-radius: 8px;
    }
    .message.user {
      background: #e3f2fd;
      margin-left: 40px;
    }
    .message.assistant {
      background: #f5f5f5;
      margin-right: 40px;
    }
    .message-role {
      font-weight: bold;
      margin-bottom: 8px;
      color: #333;
    }
    .message-content {
      line-height: 1.6;
    }
    .metadata {
      font-size: 0.85em;
      color: #666;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #ddd;
    }
    .annotation {
      background: #fff9c4;
      padding: 10px;
      margin-top: 10px;
      border-left: 3px solid #fbc02d;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="conversation">
    <div class="header">
      <h1>Conversation with ${character.name}</h1>
      <p><strong>Model:</strong> ${character.model}</p>
      <p><strong>Date:</strong> ${new Date(conversation.timestamp).toLocaleString()}</p>
      ${conversation.documentIds?.length > 0 ? `
        <p><strong>Documents:</strong> ${conversation.documentIds.map(id => getDocument(id).filename).join(', ')}</p>
      ` : ''}
    </div>
    
    ${conversation.messages.map((message, index) => `
      <div class="message ${message.role}">
        <div class="message-role">${message.role === 'user' ? 'You' : character.name}</div>
        <div class="message-content">${formatMessageContent(message.content)}</div>
        
        ${message.metadata ? `
          <div class="metadata">
            ${message.metadata.responseTime ? `Response time: ${message.metadata.responseTime.toFixed(2)}s` : ''}
            ${message.metadata.tokens ? ` | Tokens: ${message.metadata.tokens}` : ''}
            ${message.metadata.rating ? ` | Rating: ${message.metadata.rating === 'up' ? '👍' : '👎'}` : ''}
          </div>
        ` : ''}
        
        ${message.metadata?.annotations?.map(anno => `
          <div class="annotation">
            <strong>Note:</strong> ${anno.text}
          </div>
        `).join('') || ''}
      </div>
    `).join('')}
  </div>
</body>
</html>
  `;
  
  downloadTextFile(html, `conversation-${conversationId}.html`);
}

function formatMessageContent(content) {
  // Basic markdown to HTML
  return content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}
```

---

## 13. Command Palette (Quick Actions)

**Implementation:**

```javascript
// command-palette.js
const commands = [
  {
    id: 'new-character',
    label: 'Create New Character',
    keywords: ['new', 'character', 'create', 'add'],
    action: () => openCharacterCreator(),
    icon: '👤'
  },
  {
    id: 'new-conversation',
    label: 'New Conversation',
    keywords: ['new', 'conversation', 'chat'],
    action: () => createNewConversation(),
    icon: '💬'
  },
  {
    id: 'upload-document',
    label: 'Upload Document',
    keywords: ['upload', 'document', 'file', 'add'],
    action: () => document.getElementById('file-upload').click(),
    icon: '📄'
  },
  {
    id: 'switch-character',
    label: 'Switch Character',
    keywords: ['switch', 'change', 'character'],
    action: () => showCharacterSwitcher(),
    icon: '🔄'
  },
  {
    id: 'export-workspace',
    label: 'Export Workspace',
    keywords: ['export', 'backup', 'save', 'workspace'],
    action: () => exportWorkspace(),
    icon: '💾'
  },
  {
    id: 'analytics',
    label: 'View Analytics',
    keywords: ['analytics', 'stats', 'dashboard'],
    action: () => showAnalyticsDashboard(),
    icon: '📊'
  },
  {
    id: 'search-conversations',
    label: 'Search Conversations',
    keywords: ['search', 'find', 'conversations'],
    action: () => showConversationSearch(),
    icon: '🔍'
  }
];

// Dynamic character-specific commands
function getCharacterCommands() {
  return Object.values(characters).map(char => ({
    id: `switch-to-${char.id}`,
    label: `Switch to ${char.name}`,
    keywords: ['switch', char.name.toLowerCase()],
    action: () => switchToCharacter(char.id),
    icon: '👤'
  }));
}

// Command palette UI
function initCommandPalette() {
  // Listen for Ctrl+K
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      toggleCommandPalette();
    }
    
    // ESC to close
    if (e.key === 'Escape' && document.querySelector('.command-palette')) {
      closeCommandPalette();
    }
  });
}

function toggleCommandPalette() {
  if (document.querySelector('.command-palette')) {
    closeCommandPalette();
  } else {
    openCommandPalette();
  }
}

function openCommandPalette() {
  const allCommands = [...commands, ...getCharacterCommands()];
  
  const paletteHTML = `
    <div class="command-palette-overlay" onclick="closeCommandPalette()">
      <div class="command-palette" onclick="event.stopPropagation()">
        <input type="text" 
               id="command-search" 
               placeholder="Type a command or search..."
               autofocus>
        <div class="command-list" id="command-list">
          ${renderCommandList(allCommands)}
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', paletteHTML);
  
  // Setup search
  const searchInput = document.getElementById('command-search');
  searchInput.addEventListener('input', (e) => {
    const filtered = filterCommands(allCommands, e.target.value);
    document.getElementById('command-list').innerHTML = renderCommandList(filtered);
  });
  
  // Keyboard navigation
  searchInput.addEventListener('keydown', handleCommandNavigation);
}

function filterCommands(commands, query) {
  if (!query.trim()) return commands;
  
  const lowerQuery = query.toLowerCase();
  
  return commands.filter(cmd => {
    return cmd.label.toLowerCase().includes(lowerQuery) ||
           cmd.keywords.some(kw => kw.includes(lowerQuery));
  }).sort((a, b) => {
    // Prioritize exact matches
    const aExact = a.label.toLowerCase().startsWith(lowerQuery);
    const bExact = b.label.toLowerCase().startsWith(lowerQuery);
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    return 0;
  });
}

function renderCommandList(commands) {
  if (commands.length === 0) {
    return '<div class="no-results">No commands found</div>';
  }
  
  return commands.map((cmd, index) => `
    <div class="command-item ${index === 0 ? 'selected' : ''}" 
         data-command-id="${cmd.id}"
         onclick="executeCommand('${cmd.id}')">
      <span class="command-icon">${cmd.icon}</span>
      <span class="command-label">${cmd.label}</span>
    </div>
  `).join('');
}

function handleCommandNavigation(e) {
  const items = document.querySelectorAll('.command-item');
  const selected = document.querySelector('.command-item.selected');
  const selectedIndex = Array.from(items).indexOf(selected);
  
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const nextIndex = Math.min(selectedIndex + 1, items.length - 1);
    selected?.classList.remove('selected');
    items[nextIndex]?.classList.add('selected');
    items[nextIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prevIndex = Math.max(selectedIndex - 1, 0);
    selected?.classList.remove('selected');
    items[prevIndex]?.classList.add('selected');
    items[prevIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const commandId = selected?.dataset.commandId;
    if (commandId) {
      executeCommand(commandId);
    }
  }
}

function executeCommand(commandId) {
  const allCommands = [...commands, ...getCharacterCommands()];
  const command = allCommands.find(cmd => cmd.id === commandId);
  
  if (command) {
    closeCommandPalette();
    command.action();
  }
}

function closeCommandPalette() {
  document.querySelector('.command-palette-overlay')?.remove();
}
```

**CSS for Command Palette:**

```css
.command-palette-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 20vh;
  z-index: 9999;
}

.command-palette {
  background: #1e2530;
  border-radius: 8px;
  width: 600px;
  max-height: 400px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

#command-search {
  width: 100%;
  padding: 16px;
  font-size: 16px;
  border: none;
  border-bottom: 1px solid #2a3142;
  background: transparent;
  color: #e4e6eb;
  outline: none;
}

.command-list {
  max-height: 340px;
  overflow-y: auto;
}

.command-item {
  padding: 12px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: background 0.1s;
}

.command-item:hover,
.command-item.selected {
  background: #2a3142;
}

.command-icon {
  font-size: 20px;
}

.command-label {
  color: #e4e6eb;
}

.no-results {
  padding: 40px;
  text-align: center;
  color: #8b92a8;
}
```
