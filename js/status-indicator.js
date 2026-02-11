export class AIStatusIndicator {
  static create(config) {
    const indicator = new AIStatusIndicator(config || {});
    return indicator.isReady ? indicator : null;
  }

  constructor(config) {
    this.container = document.getElementById(config.containerId || "ai-status");
    this.orb = document.getElementById(config.orbId || "status-orb");
    this.labelNode = document.getElementById(config.labelId || "status-label");
    this.detailNode = document.getElementById(config.detailId || "status-detail");
    this.ringsNode = document.getElementById(config.ringsId || "status-rings");
    this.resourcesNode = document.getElementById(config.resourcesId || "orb-resources");
    this.stopButton = document.getElementById(config.stopButtonId || "status-stop-btn");
    this.linearNode = document.getElementById(config.linearId || "status-linear");
    this.linearFillNode = document.getElementById(config.linearFillId || "status-linear-fill");
    this.linearStagesNode = document.getElementById(config.linearStagesId || "status-linear-stages");
    this.modeButton = document.getElementById(config.modeButtonId || "status-mode-toggle");
    this.onStop = typeof config.onStop === "function" ? config.onStop : null;
    this.onModeChange = typeof config.onModeChange === "function" ? config.onModeChange : null;
    this.resourceNames = [];
    this.resourceIndex = 0;
    this.thinkingStartedAt = 0;
    this.thinkingTimer = null;
    this.resourceCycleTimer = null;
    this.resourcesTransitionTimer = null;
    this.warningThresholdMs = 5000;
    this.receivingPulseTimer = null;
    this.currentTokenCount = 0;
    this.mode = config.mode === "linear" ? "linear" : "orb";
    this.currentStage = this.stages ? this.stages.RECEIVING : "receiving";
    this.isReady = Boolean(this.container && this.orb && this.labelNode && this.detailNode && this.stopButton);
    this.stageClassMap = {
      receiving: "stage-receiving",
      thinking: "stage-thinking",
      resources: "stage-resources",
      responding: "stage-responding"
    };
    this.stages = {
      RECEIVING: "receiving",
      THINKING: "thinking",
      RESOURCES: "resources",
      RESPONDING: "responding"
    };

    if (!this.isReady) {
      return;
    }

    this.stopButton.addEventListener("click", () => {
      if (this.onStop) {
        this.onStop();
      }
    });
    if (this.modeButton) {
      this.modeButton.addEventListener("click", () => {
        const nextMode = this.mode === "linear" ? "orb" : "linear";
        this.setMode(nextMode);
        if (this.onModeChange) {
          this.onModeChange(nextMode);
        }
      });
    }
    this.hide();
  }

  start(options) {
    if (!this.isReady) {
      return;
    }
    const next = options || {};
    this.setResources(next.resources || []);
    if (next.mode === "linear" || next.mode === "orb") {
      this.setMode(next.mode);
    }
    this.container.hidden = false;
    this.setStopVisible(Boolean(next.showStop));
    this.setStage(this.stages.RECEIVING);
  }

  setResources(resources) {
    this.resourceNames = Array.isArray(resources)
      ? resources.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    this.resourceIndex = 0;
    this.renderResourceIcons();
  }

  setStage(stage) {
    if (!this.isReady) {
      return;
    }
    this.clearStageTimers();
    this.currentStage = stage;
    this.setOrbStageClass(stage);
    this.updateLinearStage(stage);

    if (stage === this.stages.RECEIVING) {
      this.currentTokenCount = 0;
      this.toggleRings(false);
      this.toggleResources(false);
      this.toggleStreaming(false);
      this.toggleWarning(false);
      this.toggleDetailWarning(false);
      this.restartReceivingPulse();
      this.setText("Receiving...", "");
      return;
    }

    if (stage === this.stages.THINKING) {
      this.currentTokenCount = 0;
      this.setText("Thinking...", "0.0s");
      this.toggleRings(true);
      this.toggleStreaming(false);
      this.thinkingStartedAt = performance.now();
      this.thinkingTimer = window.setInterval(() => {
        const elapsedMs = performance.now() - this.thinkingStartedAt;
        this.setText("Thinking...", `${(elapsedMs / 1000).toFixed(1)}s`);
        const isWarning = elapsedMs >= this.warningThresholdMs;
        this.toggleWarning(isWarning);
        this.toggleDetailWarning(isWarning);
      }, 100);
      if (this.resourceNames.length) {
        this.resourcesTransitionTimer = window.setTimeout(() => {
          this.setStage(this.stages.RESOURCES);
        }, 1000);
      }
      return;
    }

    if (stage === this.stages.RESOURCES) {
      this.currentTokenCount = 0;
      this.toggleRings(true);
      this.toggleResources(true);
      this.toggleStreaming(false);
      this.thinkingStartedAt = this.thinkingStartedAt || performance.now();
      this.thinkingTimer = window.setInterval(() => {
        const elapsedMs = performance.now() - this.thinkingStartedAt;
        const isWarning = elapsedMs >= this.warningThresholdMs;
        this.toggleWarning(isWarning);
        this.toggleDetailWarning(isWarning);
      }, 100);
      if (!this.resourceNames.length) {
        this.setText("Reviewing resources...", "");
        return;
      }
      this.resourceIndex = 0;
      this.updateResourceText();
      this.resourceCycleTimer = window.setInterval(() => {
        this.resourceIndex = (this.resourceIndex + 1) % this.resourceNames.length;
        this.updateResourceText();
      }, 2000);
      return;
    }

    if (stage === this.stages.RESPONDING) {
      this.currentTokenCount = 0;
      this.toggleRings(false);
      this.toggleResources(false);
      this.toggleWarning(false);
      this.toggleDetailWarning(false);
      this.toggleStreaming(true);
      this.setText("Responding...", "(0 tokens)");
    }
  }

  setText(label, detail) {
    if (!this.isReady) {
      return;
    }
    if (typeof label === "string") {
      this.labelNode.textContent = label;
    }
    if (typeof detail === "string") {
      this.detailNode.textContent = detail;
    }
  }

  setStopVisible(isVisible) {
    if (!this.isReady) {
      return;
    }
    this.stopButton.hidden = !isVisible;
  }

  hide() {
    if (!this.isReady) {
      return;
    }
    this.clearStageTimers();
    this.currentTokenCount = 0;
    this.setOrbStageClass(this.stages.RECEIVING);
    this.toggleWarning(false);
    this.toggleDetailWarning(false);
    this.toggleRings(false);
    this.toggleResources(false);
    this.toggleStreaming(false);
    this.setText("Receiving...", "");
    this.setStopVisible(false);
    this.container.hidden = true;
  }

  setMode(mode) {
    if (!this.isReady) {
      return;
    }
    this.mode = mode === "linear" ? "linear" : "orb";
    this.container.classList.toggle("linear-mode", this.mode === "linear");
    if (this.modeButton) {
      this.modeButton.textContent = this.mode === "linear" ? "Linear" : "Orb";
    }
    this.updateLinearStage(this.currentStage || this.stages.RECEIVING);
  }

  clearStageTimers() {
    if (this.thinkingTimer) {
      window.clearInterval(this.thinkingTimer);
      this.thinkingTimer = null;
    }
    if (this.resourceCycleTimer) {
      window.clearInterval(this.resourceCycleTimer);
      this.resourceCycleTimer = null;
    }
    if (this.resourcesTransitionTimer) {
      window.clearTimeout(this.resourcesTransitionTimer);
      this.resourcesTransitionTimer = null;
    }
    if (this.receivingPulseTimer) {
      window.clearTimeout(this.receivingPulseTimer);
      this.receivingPulseTimer = null;
    }
    this.orb.classList.remove("pulse-receiving");
  }

  setOrbStageClass(stage) {
    if (!this.isReady) {
      return;
    }
    Object.values(this.stageClassMap).forEach((className) => this.orb.classList.remove(className));
    const className = this.stageClassMap[stage] || this.stageClassMap[this.stages.RECEIVING];
    this.orb.classList.add(className);
  }

  toggleWarning(isWarning) {
    if (!this.isReady) {
      return;
    }
    this.orb.classList.toggle("warning", Boolean(isWarning));
  }

  toggleDetailWarning(isWarning) {
    if (!this.isReady) {
      return;
    }
    this.detailNode.classList.toggle("status-detail-warning", Boolean(isWarning));
  }

  toggleRings(isActive) {
    if (this.ringsNode) {
      this.ringsNode.classList.toggle("active", Boolean(isActive));
    }
  }

  toggleResources(isActive) {
    if (this.resourcesNode) {
      this.resourcesNode.classList.toggle("active", Boolean(isActive));
    }
  }

  updateResourceText() {
    if (!this.resourceNames.length) {
      this.setText("Reviewing resources...", "");
      return;
    }
    const maxLength = 25;
    const raw = this.resourceNames[this.resourceIndex] || "";
    const display = raw.length > maxLength ? `${raw.slice(0, maxLength - 3)}...` : raw;
    const overflow = this.resourceNames.length > 3 ? ` and ${this.resourceNames.length - 3} more` : "";
    this.setText(`Reading ${display}...`, overflow);
  }

  setTokenCount(count) {
    if (!this.isReady) {
      return;
    }
    const next = Math.max(0, Number(count) || 0);
    if (next < this.currentTokenCount) {
      return;
    }
    this.currentTokenCount = next;
    this.setText("Responding...", `(${this.currentTokenCount} tokens)`);
  }

  restartReceivingPulse() {
    if (!this.isReady) {
      return;
    }
    this.orb.classList.remove("pulse-receiving");
    // Force reflow so the quick receive animation retriggers every send.
    void this.orb.offsetWidth;
    this.orb.classList.add("pulse-receiving");
    this.receivingPulseTimer = window.setTimeout(() => {
      this.orb.classList.remove("pulse-receiving");
      this.receivingPulseTimer = null;
    }, 420);
  }

  renderResourceIcons() {
    if (!this.resourcesNode) {
      return;
    }
    this.resourcesNode.innerHTML = "";
    const maxIcons = Math.min(3, this.resourceNames.length);
    for (let i = 0; i < maxIcons; i += 1) {
      const icon = document.createElement("span");
      icon.className = "doc-icon";
      icon.textContent = this.iconForName(this.resourceNames[i]);
      icon.title = this.resourceNames[i];
      this.resourcesNode.appendChild(icon);
    }
  }

  iconForName(name) {
    const normalized = String(name || "").toLowerCase();
    if (normalized.endsWith(".pdf")) return "PDF";
    if (normalized.endsWith(".doc") || normalized.endsWith(".docx")) return "DOC";
    if (normalized.endsWith(".md")) return "MD";
    if (normalized.endsWith(".txt")) return "TXT";
    return "DOC";
  }

  toggleStreaming(isStreaming) {
    if (!this.isReady) {
      return;
    }
    this.orb.classList.toggle("streaming", Boolean(isStreaming));
  }

  updateLinearStage(stage) {
    if (!this.linearFillNode || !this.linearStagesNode) {
      return;
    }
    const widthMap = {
      receiving: 25,
      thinking: 50,
      resources: 75,
      responding: 100
    };
    const width = widthMap[stage] || 25;
    this.linearFillNode.style.width = `${width}%`;
    const nodes = Array.from(this.linearStagesNode.querySelectorAll("[data-stage]"));
    nodes.forEach((node) => {
      const isActive = node.getAttribute("data-stage") === stage;
      node.classList.toggle("active", isActive);
    });
  }
}
