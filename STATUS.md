# AI Processing Status Indicator - Implementation Guide

## Visual Design Concept

A dynamic status indicator that shows the AI's processing stages through color-coded animations and contextual information. The indicator provides transparency into what the model is doing during generation.

---

## Stage Definitions & Specifications

### Stage 1: Receiving Message

**When:** Message sent → API request accepted  
**Duration:** 100-300ms (typically)  
**Visual:**

- Orb color: `#4a9eff` (blue)
- Animation: Quick pulse-in effect (scale from 0.8 to 1.0)
- Opacity: 90%

**Display:**

```
[Blue pulsing orb] Receiving...
```

---

### Stage 2: Thinking (First Token Wait)

**When:** API request sent → First token received  
**Duration:** Variable (0.5s - 5s+ depending on model/load)  
**Visual:**

- Orb color: `#9b59b6` (purple)
- Animation: Slow rhythmic pulse (1.5s cycle)
- Effect: Concentric rings emanating outward
- Opacity: 95%

**Display:**

```
[Purple pulsing orb with rings] Thinking... 2.3s
```

**Technical:**

- Start timer on API call
- Update elapsed time every 100ms
- Show warning color (`#ff9800`) if exceeds 5s

---

### Stage 3: Reviewing Resources

**When:** During thinking phase, if documents/images are assigned  
**Duration:** Overlaps with Stage 2 (simulated cycling)  
**Visual:**

- Orb color: `#ff9800` (amber/orange)
- Animation: Pulse with rotating document icons orbiting
- Document icons: Mini thumbnails/file icons (max 3 visible at once)
- Opacity: 92%

**Display:**

```
[Orange orb with rotating doc icons] Reading Project_Report.pdf...
                                      ↓ (cycles every 2s)
[Orange orb with rotating doc icons] Reading Meeting_Notes.docx...
```

**Technical:**

- Cycle through assigned documents every 2 seconds
- Show document name (truncated to 25 chars)
- If >3 docs, show "and X more"
- This stage interleaves with Stage 2

---

### Stage 4: Preparing Response (Streaming)

**When:** First token received → Generation complete  
**Duration:** Variable (depends on response length)  
**Visual:**

- Orb color: `#4caf50` (green)
- Animation: Faster pulse (0.8s cycle) with streaming waves
- Effect: Horizontal wave lines moving right (suggesting text flow)
- Opacity: 100%

**Display:**

```
[Green pulsing orb with waves] Responding... (247 tokens)
```

**Technical:**

- Count tokens as they stream in
- Pulse gets slightly faster as generation continues
- Optional: Show estimated % complete based on avg response length

---

## Implementation Architecture

### HTML Structure

```html
<div class="ai-status-container" id="ai-status">
  <div class="status-orb" id="status-orb">
    <div class="orb-core"></div>
    <div class="orb-rings"></div>
    <div class="orb-resources" id="orb-resources">
      <!-- Document icons inserted here -->
    </div>
  </div>
  
  <div class="status-text">
    <span class="status-label" id="status-label">Receiving...</span>
    <span class="status-detail" id="status-detail"></span>
  </div>
  
  <button class="status-stop" id="status-stop-btn" style="display: none;">
    Stop
  </button>
</div>
```

### CSS Animations

```css
.ai-status-container {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background: rgba(30, 37, 48, 0.8);
  border-radius: 8px;
  backdrop-filter: blur(10px);
  margin-bottom: 12px;
}

/* Orb Container */
.status-orb {
  position: relative;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Core Orb */
.orb-core {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--orb-color, #4a9eff);
  box-shadow: 0 0 20px var(--orb-color, #4a9eff);
  animation: orb-pulse 1.5s ease-in-out infinite;
  position: relative;
  z-index: 2;
}

@keyframes orb-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.9;
  }
  50% {
    transform: scale(1.1);
    opacity: 1;
  }
}

/* Concentric Rings (Stage 2) */
.orb-rings {
  position: absolute;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
}

.orb-rings.active {
  opacity: 1;
}

.orb-rings::before,
.orb-rings::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid var(--orb-color, #9b59b6);
  opacity: 0.6;
}

.orb-rings::before {
  width: 40px;
  height: 40px;
  animation: ring-expand 2s ease-out infinite;
}

.orb-rings::after {
  width: 40px;
  height: 40px;
  animation: ring-expand 2s ease-out infinite 1s;
}

@keyframes ring-expand {
  0% {
    width: 32px;
    height: 32px;
    opacity: 0.8;
  }
  100% {
    width: 56px;
    height: 56px;
    opacity: 0;
  }
}

/* Document Icons Orbiting (Stage 3) */
.orb-resources {
  position: absolute;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
}

.orb-resources.active {
  opacity: 1;
}

.doc-icon {
  position: absolute;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  animation: orbit 3s linear infinite;
  transform-origin: 24px 24px;
}

.doc-icon:nth-child(1) {
  animation-delay: 0s;
}

.doc-icon:nth-child(2) {
  animation-delay: -1s;
}

.doc-icon:nth-child(3) {
  animation-delay: -2s;
}

@keyframes orbit {
  from {
    transform: rotate(0deg) translateX(28px) rotate(0deg);
  }
  to {
    transform: rotate(360deg) translateX(28px) rotate(-360deg);
  }
}

/* Streaming Waves (Stage 4) */
.orb-core.streaming::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 100%;
  width: 30px;
  height: 2px;
  background: linear-gradient(90deg, 
    var(--orb-color) 0%, 
    transparent 100%);
  animation: wave-stream 1s ease-in-out infinite;
}

@keyframes wave-stream {
  0% {
    transform: translateY(-50%) scaleX(0);
    opacity: 1;
  }
  100% {
    transform: translateY(-50%) scaleX(1);
    opacity: 0;
  }
}

/* Status Text */
.status-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-label {
  font-size: 14px;
  font-weight: 600;
  color: #e4e6eb;
}

.status-detail {
  font-size: 12px;
  color: #8b92a8;
  font-family: 'Monaco', 'Courier New', monospace;
}

/* Stop Button */
.status-stop {
  padding: 6px 12px;
  background: rgba(255, 75, 75, 0.2);
  border: 1px solid #ff4b4b;
  color: #ff4b4b;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.status-stop:hover {
  background: rgba(255, 75, 75, 0.3);
}

/* Stage-specific Orb Colors */
.status-orb.stage-receiving .orb-core {
  --orb-color: #4a9eff;
}

.status-orb.stage-thinking .orb-core {
  --orb-color: #9b59b6;
  animation-duration: 1.5s;
}

.status-orb.stage-resources .orb-core {
  --orb-color: #ff9800;
}

.status-orb.stage-responding .orb-core {
  --orb-color: #4caf50;
  animation-duration: 0.8s;
}

/* Warning state (taking too long) */
.status-orb.warning .orb-core {
  --orb-color: #ff9800;
}
```

---

## JavaScript Implementation

### State Machine

```javascript
// status-indicator.js

class AIStatusIndicator {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.orb = document.getElementById('status-orb');
    this.label = document.getElementById('status-label');
    this.detail = document.getElementById('status-detail');
    this.resources = document.getElementById('orb-resources');
    this.stopBtn = document.getElementById('status-stop-btn');
    
    this.currentStage = null;
    this.startTime = null;
    this.timerInterval = null;
    this.resourceCycleInterval = null;
    this.assignedDocuments = [];
    this.currentDocIndex = 0;
    this.tokenCount = 0;
    
    this.stages = {
      RECEIVING: 'receiving',
      THINKING: 'thinking',
      RESOURCES: 'resources',
      RESPONDING: 'responding'
    };
  }
  
  // Start the status indicator
  start(assignedDocs = []) {
    this.reset();
    this.assignedDocuments = assignedDocs;
    this.container.style.display = 'flex';
    this.stopBtn.style.display = 'inline-block';
    this.setStage(this.stages.RECEIVING);
  }
  
  // Progress to next stage
  setStage(stage) {
    this.currentStage = stage;
    this.clearTimers();
    
    // Remove all stage classes
    this.orb.className = 'status-orb';
    this.orb.querySelector('.orb-rings').classList.remove('active');
    this.resources.classList.remove('active');
    this.orb.querySelector('.orb-core').classList.remove('streaming');
    
    switch(stage) {
      case this.stages.RECEIVING:
        this.handleReceiving();
        break;
      case this.stages.THINKING:
        this.handleThinking();
        break;
      case this.stages.RESOURCES:
        this.handleResources();
        break;
      case this.stages.RESPONDING:
        this.handleResponding();
        break;
    }
  }
  
  handleReceiving() {
    this.orb.classList.add('stage-receiving');
    this.label.textContent = 'Receiving...';
    this.detail.textContent = '';
    
    // Quick animation
    this.orb.querySelector('.orb-core').style.animation = 'orb-pulse 0.6s ease-in-out 2';
  }
  
  handleThinking() {
    this.orb.classList.add('stage-thinking');
    this.orb.querySelector('.orb-rings').classList.add('active');
    this.label.textContent = 'Thinking...';
    
    // Start timer
    this.startTime = Date.now();
    this.timerInterval = setInterval(() => {
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      this.detail.textContent = `${elapsed}s`;
      
      // Show warning if taking too long
      if (elapsed > 5) {
        this.orb.classList.add('warning');
      }
    }, 100);
    
    // If documents are assigned, cycle to resources stage
    if (this.assignedDocuments.length > 0) {
      setTimeout(() => {
        this.setStage(this.stages.RESOURCES);
      }, 1000); // Show thinking for 1s first
    }
  }
  
  handleResources() {
    this.orb.classList.add('stage-resources');
    this.orb.querySelector('.orb-rings').classList.add('active');
    this.resources.classList.add('active');
    
    // Create orbiting document icons
    this.createDocumentIcons();
    
    // Cycle through document names
    this.currentDocIndex = 0;
    this.updateResourceLabel();
    
    this.resourceCycleInterval = setInterval(() => {
      this.currentDocIndex = (this.currentDocIndex + 1) % this.assignedDocuments.length;
      this.updateResourceLabel();
    }, 2000);
    
    // Continue timer from thinking stage
    if (!this.timerInterval) {
      this.startTime = Date.now();
      this.timerInterval = setInterval(() => {
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        // Timer continues in detail
      }, 100);
    }
  }
  
  createDocumentIcons() {
    this.resources.innerHTML = '';
    
    const maxIcons = Math.min(3, this.assignedDocuments.length);
    for (let i = 0; i < maxIcons; i++) {
      const doc = this.assignedDocuments[i];
      const icon = document.createElement('div');
      icon.className = 'doc-icon';
      icon.textContent = this.getDocIcon(doc.filename);
      icon.title = doc.filename;
      this.resources.appendChild(icon);
    }
  }
  
  getDocIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const iconMap = {
      'pdf': '📄',
      'docx': '📝',
      'txt': '📃',
      'md': '📋',
      'png': '🖼️',
      'jpg': '🖼️',
      'jpeg': '🖼️'
    };
    return iconMap[ext] || '📄';
  }
  
  updateResourceLabel() {
    const doc = this.assignedDocuments[this.currentDocIndex];
    const docName = doc.filename.length > 25 
      ? doc.filename.substring(0, 22) + '...' 
      : doc.filename;
    
    this.label.textContent = `Reading ${docName}`;
    
    if (this.assignedDocuments.length > 3) {
      this.detail.textContent = `and ${this.assignedDocuments.length - 3} more`;
    }
  }
  
  handleResponding() {
    this.orb.classList.add('stage-responding');
    this.orb.querySelector('.orb-core').classList.add('streaming');
    this.label.textContent = 'Responding...';
    this.tokenCount = 0;
    
    // Update token count as tokens come in
    this.detail.textContent = '(0 tokens)';
  }
  
  // Call this as tokens stream in
  updateTokenCount(count) {
    this.tokenCount = count;
    if (this.currentStage === this.stages.RESPONDING) {
      this.detail.textContent = `(${count} tokens)`;
    }
  }
  
  // Call when generation is complete
  complete() {
    this.clearTimers();
    
    // Show completion state briefly
    this.orb.classList.add('stage-complete');
    this.label.textContent = 'Complete';
    
    setTimeout(() => {
      this.hide();
    }, 800);
  }
  
  hide() {
    this.container.style.display = 'none';
    this.reset();
  }
  
  reset() {
    this.clearTimers();
    this.currentStage = null;
    this.startTime = null;
    this.assignedDocuments = [];
    this.currentDocIndex = 0;
    this.tokenCount = 0;
    this.orb.className = 'status-orb';
    this.resources.innerHTML = '';
  }
  
  clearTimers() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.resourceCycleInterval) {
      clearInterval(this.resourceCycleInterval);
      this.resourceCycleInterval = null;
    }
  }
}
```

---

## Integration with Ollama Generation

### Usage in Main Application

```javascript
// In your main app code
const statusIndicator = new AIStatusIndicator('ai-status');

async function generateResponse(characterId, userMessage) {
  const character = getCharacter(characterId);
  const assignedDocs = getAssignedDocuments(characterId);
  
  // Stage 1: Receiving
  statusIndicator.start(assignedDocs);
  
  try {
    // Stage 2: Thinking (when API call is made)
    setTimeout(() => {
      statusIndicator.setStage(statusIndicator.stages.THINKING);
    }, 200);
    
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: character.model,
        prompt: buildFullPrompt(character, userMessage, assignedDocs),
        stream: true
      })
    });
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let tokenCount = 0;
    let firstToken = true;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        const data = JSON.parse(line);
        
        // Stage 4: First token received = responding
        if (firstToken && data.response) {
          statusIndicator.setStage(statusIndicator.stages.RESPONDING);
          firstToken = false;
        }
        
        if (data.response) {
          fullResponse += data.response;
          tokenCount++;
          statusIndicator.updateTokenCount(tokenCount);
          
          // Update UI with streaming text
          updateChatMessage(fullResponse);
        }
        
        if (data.done) {
          statusIndicator.complete();
        }
      }
    }
    
    return fullResponse;
    
  } catch (error) {
    console.error('Generation error:', error);
    statusIndicator.hide();
    throw error;
  }
}

// Stop button handler
document.getElementById('status-stop-btn').addEventListener('click', () => {
  abortGeneration();
  statusIndicator.hide();
});
```

---

## Alternative: Simpler Linear Progress Bar

If the orb animation is too complex, here's a simpler alternative:

```html
<div class="ai-status-linear">
  <div class="status-progress-bar">
    <div class="progress-fill" id="progress-fill"></div>
  </div>
  <div class="status-stages">
    <div class="stage" data-stage="receiving">
      <div class="stage-dot"></div>
      <span>Receiving</span>
    </div>
    <div class="stage" data-stage="thinking">
      <div class="stage-dot"></div>
      <span>Thinking</span>
    </div>
    <div class="stage" data-stage="resources">
      <div class="stage-dot"></div>
      <span>Reading Docs</span>
    </div>
    <div class="stage" data-stage="responding">
      <div class="stage-dot"></div>
      <span>Responding</span>
    </div>
  </div>
</div>
```

This shows a progress bar with dots that light up as each stage completes.

---

## Recommended Approach

**For Production:** Use the **orb animation** - it's more engaging and provides clear visual feedback without taking up much space.

**For Quick Implementation:** Start with stages 1, 2, and 4. Add stage 3 (resources) later as an enhancement.

**Progressive Enhancement:**

1. Start with simple text status ("Thinking...")
2. Add timer to thinking stage
3. Add color-coded orb
4. Add animations (pulse, rings)
5. Add resource cycling (stage 3)
6. Polish with streaming effects

---

## Testing Checklist

- [ ] Stage 1 appears immediately on send
- [ ] Stage 2 shows elapsed timer
- [ ] Stage 3 cycles through all assigned documents
- [ ] Stage 4 updates token count in real-time
- [ ] Stop button works and aborts generation
- [ ] Indicator hides smoothly on completion
- [ ] Warning color appears if thinking >5s
- [ ] Works with 0 documents assigned (skips stage 3)
- [ ] Works with 1, 3, and 10+ documents
- [ ] Animations perform smoothly (no jank)
