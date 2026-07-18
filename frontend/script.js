// Empty string = same-origin relative paths (e.g. fetch("/api/upload")).
// This works both locally and after deployment (Render, etc.) without any
// hardcoded URL, because the backend now serves this frontend directly —
// see FRONTEND_DIR mount at the bottom of backend/main.py.
const API_BASE = "";

// Wraps fetch with a timeout so a slow/hung backend can never leave a
// button or status stuck forever with no feedback. 90s default because
// free-tier hosts (Render, etc.) can take 50+ seconds to wake from sleep —
// too short a timeout here would misreport a normal cold start as a failure.
async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Request timed out. Check your backend is running and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ---------------------------------------------------------------------
   PARTICLE BACKGROUND (dots drifting, faint connecting lines) — the
   original style, restored per request.
--------------------------------------------------------------------- */
const canvas = document.getElementById("particles");
const ctx = canvas.getContext("2d");
let particles = [];

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = document.body.scrollHeight;
}

function initParticles() {
  const count = Math.floor((canvas.width * canvas.height) / 18000);
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r: Math.random() * 1.5 + 0.5,
  }));
}

function drawParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(148, 197, 255, 0.8)";

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
    if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i], b = particles[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist < 110) {
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.12 * (1 - dist / 110)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }
  requestAnimationFrame(drawParticles);
}

window.addEventListener("resize", () => { resizeCanvas(); initParticles(); });
resizeCanvas();
initParticles();
drawParticles();

/* ---------------------------------------------------------------------
   NAV / SCROLL HELPERS
--------------------------------------------------------------------- */
document.getElementById("navUploadBtn").onclick = () => document.getElementById("csvInput").click();
document.getElementById("heroUploadBtn").onclick = () => document.getElementById("csvInput").click();
document.getElementById("chooseFileBtn").onclick = () => document.getElementById("csvInput").click();
document.getElementById("getStartedBtn").onclick = () =>
  document.getElementById("features").scrollIntoView({ behavior: "smooth" });

/* ---------------------------------------------------------------------
   BACKEND STATUS CHECK — handles free-tier cold starts (Render, etc.)
   gracefully instead of treating a sleeping server as "offline". A sleeping
   free-tier instance can take 50+ seconds to wake up; we poll patiently
   and show the user what's happening instead of a confusing failure.
--------------------------------------------------------------------- */
async function checkBackend() {
  const statPill = document.getElementById("statBackend");
  const banner = document.getElementById("coldStartBanner");

  const MAX_ATTEMPTS = 15;
  const RETRY_DELAY_MS = 4000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/status`, {}, 10000);
      if (res.ok) {
        statPill.textContent = "Online";
        statPill.className = "pill pill-done";
        if (banner) banner.style.display = "none";
        return;
      }
    } catch {
      // fall through to retry
    }

    // First failure: show the "waking up" banner instead of "offline" —
    // this is almost always just a cold start, not a real problem.
    if (banner) {
      banner.style.display = "flex";
      banner.querySelector(".cold-start-text").textContent =
        `⏳ Waking up the server (free tier can take up to a minute)... attempt ${attempt}/${MAX_ATTEMPTS}`;
    }
    statPill.textContent = "Waking up...";
    statPill.className = "pill pill-warn";

    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }

  // All retries exhausted — now it's fair to call it actually offline
  statPill.textContent = "Offline";
  statPill.className = "pill";
  statPill.style.background = "rgba(248,113,113,0.15)";
  statPill.style.color = "#f87171";
  if (banner) {
    banner.querySelector(".cold-start-text").textContent =
      "⚠️ Couldn't reach the backend after several attempts. It may genuinely be down — check your Render service.";
  }
}
checkBackend();

/* ---------------------------------------------------------------------
   UPLOAD
--------------------------------------------------------------------- */
let insightsGenerated = 0;

document.getElementById("csvInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const chooseBtn = document.getElementById("chooseFileBtn");
  const statusEl = document.getElementById("uploadStatus");

  document.getElementById("fileNameLabel").textContent = file.name;
  statusEl.textContent = "Uploading...";
  chooseBtn.disabled = true; // prevent a second upload from starting mid-flight

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/upload`,
      { method: "POST", body: formData },
      120000
    );

    if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
    const data = await res.json();

    document.getElementById("datasetSize").textContent = `${data.size_kb} KB`;
    statusEl.textContent = "Uploaded";
    document.getElementById("datasetName").textContent = data.filename;
    document.getElementById("previewRows").textContent = data.rows;
    document.getElementById("statDataset").textContent = "Ready";
    document.getElementById("statDataset").className = "pill pill-done";

    document.getElementById("totalFeatures").textContent = data.columns;
    document.getElementById("totalRecords").textContent = data.rows;
    document.getElementById("missingValues").textContent = data.missing_values;
    document.getElementById("duplicateRows").textContent = data.duplicate_rows;

    renderPreviewTable(data.column_names, data.preview);
    addHistoryEntry(data);
    checkAuthenticity();
  } catch (err) {
    statusEl.textContent = "Error";
    alert(err.message);
  } finally {
    chooseBtn.disabled = false;
    // Reset the input so selecting the SAME file again still fires
    // "change" — without this, re-picking an identical file does nothing
    // and the UI looks stuck on whatever status was last shown.
    e.target.value = "";
  }
});

function renderPreviewTable(columns, rows) {
  const thead = document.querySelector("#previewTable thead");
  const tbody = document.querySelector("#previewTable tbody");
  thead.innerHTML = `<tr>${columns.map((c) => `<th>${c}</th>`).join("")}</tr>`;
  tbody.innerHTML = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${r[c] ?? ""}</td>`).join("")}</tr>`)
    .join("");
}

/* ---------------------------------------------------------------------
   START AI ANALYSIS: clean -> analyze -> chart data, with animated steps
--------------------------------------------------------------------- */
document.getElementById("startAnalysisBtn").onclick = runFullAnalysis;
document.getElementById("reportBtn").onclick = downloadReport;

async function downloadReport() {
  const btn = document.getElementById("reportBtn");
  const originalText = btn.textContent;
  btn.textContent = "Generating...";
  btn.disabled = true;

  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/report`, {}, 30000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Could not generate report. Upload a dataset first.");
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    // Try to use the filename the server suggested, otherwise fall back
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    a.download = match ? match[1] : "AI_Report.pdf";

    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function setProgress(pct, label) {
  document.getElementById("progressFill").style.width = `${pct}%`;
  document.getElementById("progressLabel").textContent = label;
}

function markStep(id, text) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = "pill pill-done";
}

let analysisInFlight = false;

async function runFullAnalysis() {
  if (analysisInFlight) return; // ignore double-clicks / overlapping runs
  analysisInFlight = true;

  const startBtn = document.getElementById("startAnalysisBtn");
  const reportBtn = document.getElementById("reportBtn");
  startBtn.disabled = true;
  reportBtn.disabled = true;

  document.getElementById("aiStatus").textContent = "Running";

  try {
    await setProgress(10, "Cleaning dataset...");
    const cleanRes = await fetchWithTimeout(`${API_BASE}/api/clean`, { method: "POST" });
    if (!cleanRes.ok) throw new Error((await cleanRes.json()).detail || "Cleaning failed");
    const cleanData = await cleanRes.json();

    markStep("stepUploaded", "Done");
    markStep("stepMissing", cleanData.steps.missing_values.detail);
    markStep("stepDup", cleanData.steps.duplicate_check.detail);
    markStep("stepOutlier", cleanData.steps.outlier_detection.detail);
    markStep("stepFeature", cleanData.steps.feature_engineering.detail);
    markStep("stepReady", "Ready");

    // ML training (silhouette search + Random Forest) can take longer on
    // big datasets, so this step gets a longer timeout than the others.
    await setProgress(50, "Training models...");
    const analyzeRes = await fetchWithTimeout(
      `${API_BASE}/api/analyze`,
      { method: "POST" },
      120000
    );
    if (!analyzeRes.ok) throw new Error((await analyzeRes.json()).detail || "Analysis failed");
    const ml = await analyzeRes.json();

    document.getElementById("mlKmeans").textContent = ml.kmeans.status === "done" ? `${ml.kmeans.clusters} clusters` : "Skipped";
    document.getElementById("mlDT").textContent = `${ml.decision_tree.accuracy}%`;
    document.getElementById("mlRF").textContent = `${ml.random_forest.accuracy}%`;
    document.getElementById("mlSegments").textContent = ml.customer_segments;
    document.getElementById("bestModel").textContent = ml.best_model;
    document.getElementById("bestAccuracy").textContent = `${ml.best_accuracy}%`;
    document.getElementById("aiConfidence").textContent = `${ml.best_accuracy}%`;

    const skipNote = document.getElementById("mlSkipNote");
    if (ml.ml_skip_reason) {
      skipNote.textContent = `ℹ️ ${ml.ml_skip_reason}`;
      skipNote.style.display = "block";
    } else {
      skipNote.style.display = "none";
    }

    renderCorrelationHeatmap(ml.correlation);
    renderFeatureImportance(ml.feature_importance);

    await setProgress(80, "Building charts...");
    const chartRes = await fetchWithTimeout(`${API_BASE}/api/chart-data`);
    const chartData = await chartRes.json();
    renderCharts(chartData);

    await setProgress(100, "Analysis complete");
    document.getElementById("aiStatus").textContent = "Complete";

    insightsGenerated++;
    document.getElementById("statInsights").textContent = insightsGenerated;
    updateLatestHistoryEntry(ml);
  } catch (err) {
    document.getElementById("aiStatus").textContent = "Error";
    alert(err.message);
  } finally {
    analysisInFlight = false;
    startBtn.disabled = false;
    reportBtn.disabled = false;
  }
}

/* ---------------------------------------------------------------------
   CHARTS
--------------------------------------------------------------------- */
let pieChartInstance, barChartInstance;

function renderCharts(data) {
  const pieCtx = document.getElementById("pieChart");
  const barCtx = document.getElementById("barChart");

  if (pieChartInstance) pieChartInstance.destroy();
  if (barChartInstance) barChartInstance.destroy();

  if (data.pie && data.pie.data) {
    pieChartInstance = new Chart(pieCtx, {
      type: "doughnut",
      data: {
        labels: Object.keys(data.pie.data),
        datasets: [{
          data: Object.values(data.pie.data),
          backgroundColor: ["#38bdf8", "#22d3ee", "#34d399", "#fbbf24", "#f87171", "#a78bfa"],
        }],
      },
      options: { plugins: { legend: { labels: { color: "#e8f1ff" } } } },
    });
  }

  if (data.bar && data.bar.counts) {
    barChartInstance = new Chart(barCtx, {
      type: "bar",
      data: {
        labels: data.bar.bins,
        datasets: [{ label: data.bar.label, data: data.bar.counts, backgroundColor: "#38bdf8" }],
      },
      options: {
        scales: {
          x: { ticks: { color: "#94a3b8" } },
          y: { ticks: { color: "#94a3b8" } },
        },
        plugins: { legend: { labels: { color: "#e8f1ff" } } },
      },
    });
  }
}

/* ---------------------------------------------------------------------
   CHAT (agent)
--------------------------------------------------------------------- */
const chatWindow = document.getElementById("chatWindow");
const chatInput = document.getElementById("chatInput");

document.getElementById("chatSendBtn").onclick = sendChat;
chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

function addBubble(text, cls) {
  const div = document.createElement("div");
  div.className = `chat-bubble ${cls}`;
  div.textContent = text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return div;
}

let chatChartCounter = 0;

function addChartBubble(chart) {
  const wrap = document.createElement("div");
  wrap.className = "chat-chart-wrap";
  const canvasId = `chatChart${chatChartCounter++}`;
  wrap.innerHTML = `<canvas id="${canvasId}"></canvas>`;
  chatWindow.appendChild(wrap);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  const ctx = document.getElementById(canvasId);
  const colors = ["#38bdf8", "#22d3ee", "#34d399", "#fbbf24", "#f87171", "#a78bfa", "#fb923c", "#f472b6"];
  new Chart(ctx, {
    type: chart.type === "pie" ? "doughnut" : chart.type,
    data: {
      labels: chart.labels,
      datasets: [
        {
          label: chart.label,
          data: chart.values,
          backgroundColor: chart.type === "line" ? "rgba(56,189,248,0.2)" : colors,
          borderColor: "#38bdf8",
        },
      ],
    },
    options: {
      plugins: { legend: { display: chart.type !== "bar", labels: { color: "#e8f1ff" } } },
      scales: chart.type === "pie" ? {} : { x: { ticks: { color: "#94a3b8" } }, y: { ticks: { color: "#94a3b8" } } },
    },
  });
}

async function sendChat() {
  const question = chatInput.value.trim();
  if (!question) return;
  addBubble(question, "user");
  chatInput.value = "";
  addBubble("Thinking...", "bot");

  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      },
      45000
    );
    chatWindow.removeChild(chatWindow.lastChild); // remove "Thinking..."

    if (!res.ok) {
      addBubble((await res.json()).detail || "Something went wrong.", "bot");
      return;
    }
    const data = await res.json();
    if (data.trace && data.trace.length) {
      addBubble(`🔧 Ran ${data.trace.length} pandas quer${data.trace.length > 1 ? "ies" : "y"} to find the answer.`, "trace");
    }
    addBubble(data.answer, "bot");
    if (data.chart && data.chart.labels) {
      addChartBubble(data.chart);
    }
  } catch (err) {
    chatWindow.removeChild(chatWindow.lastChild);
    addBubble("Could not reach the backend. Is the server running?", "bot");
  }
}

/* ---------------------------------------------------------------------
   ANOMALY EXPLAINER
--------------------------------------------------------------------- */
document.getElementById("explainAnomalyBtn").onclick = async () => {
  const btn = document.getElementById("explainAnomalyBtn");
  btn.disabled = true;
  addBubble("🔎 Picking a row and analyzing why it stands out...", "bot");

  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/explain-anomaly`, { method: "POST" }, 45000);
    chatWindow.removeChild(chatWindow.lastChild);

    if (!res.ok) {
      addBubble((await res.json()).detail || "Couldn't check for anomalies.", "bot");
      return;
    }
    const data = await res.json();
    addBubble(`Row ${data.row_index}: ${data.answer}`, "bot");
  } catch (err) {
    chatWindow.removeChild(chatWindow.lastChild);
    addBubble("Could not reach the backend for the anomaly check.", "bot");
  } finally {
    btn.disabled = false;
  }
};

/* ---------------------------------------------------------------------
   CLEAR CHAT (also clears server-side memory so old context isn't reused)
--------------------------------------------------------------------- */
document.getElementById("clearChatBtn").onclick = async () => {
  chatWindow.innerHTML =
    '<div class="chat-bubble bot">👋 Chat cleared. Ask me anything about your dataset.</div>';
  try {
    await fetchWithTimeout(`${API_BASE}/api/chat/clear`, { method: "POST" }, 10000);
  } catch (err) {
    // non-critical if this fails — worst case old history lingers server-side
  }
};

/* ---------------------------------------------------------------------
   VOICE INPUT (Web Speech API — Chrome/Edge only, gracefully hides
   the mic button on unsupported browsers instead of erroring)
--------------------------------------------------------------------- */
const micBtn = document.getElementById("micBtn");
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognitionAPI) {
  micBtn.style.display = "none";
} else {
  const recognition = new SpeechRecognitionAPI();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  let isListening = false;

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add("listening");
    micBtn.textContent = "🔴";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    chatInput.value = transcript;
  };

  recognition.onerror = () => {
    addBubble("Couldn't hear that clearly — try again or type your question.", "bot");
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove("listening");
    micBtn.textContent = "🎤";
  };

  micBtn.onclick = () => {
    if (isListening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  };
}

/* ---------------------------------------------------------------------
   UPLOAD HISTORY (session-only — resets on page reload, no backend/DB)
--------------------------------------------------------------------- */
let uploadHistory = [];

function addHistoryEntry(uploadData) {
  uploadHistory.unshift({
    filename: uploadData.filename,
    sizeKb: uploadData.size_kb,
    rows: uploadData.rows,
    columns: uploadData.columns,
    time: new Date(),
    analysis: null, // filled in later if "Start AI Analysis" is run
  });
  renderHistory();
}

function updateLatestHistoryEntry(mlResult) {
  if (uploadHistory.length === 0) return;
  uploadHistory[0].analysis = {
    bestModel: mlResult.best_model,
    bestAccuracy: mlResult.best_accuracy,
    clusters: mlResult.customer_segments,
  };
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById("historyList");
  const empty = document.getElementById("historyEmpty");

  if (uploadHistory.length === 0) {
    list.innerHTML = '<p class="muted" id="historyEmpty">No datasets uploaded yet this session.</p>';
    return;
  }

  list.innerHTML = uploadHistory
    .map((entry) => {
      const timeStr = entry.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const badge = entry.analysis
        ? `<div class="history-badge done">✓ ${entry.analysis.bestModel} · ${entry.analysis.bestAccuracy}%</div>`
        : `<div class="history-badge pending">Not analyzed yet</div>`;

      return `
        <div class="history-item">
          <div class="history-icon">📄</div>
          <div class="history-info">
            <div class="history-filename">${escapeHtml(entry.filename)}</div>
            <div class="history-meta">${entry.rows.toLocaleString()} rows · ${entry.columns} columns · ${entry.sizeKb} KB · ${timeStr}</div>
          </div>
          ${badge}
        </div>`;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById("clearHistoryBtn").onclick = () => {
  uploadHistory = [];
  renderHistory();
};

/* ---------------------------------------------------------------------
   DATA AUTHENTICITY CHECK
--------------------------------------------------------------------- */
const AUTH_SIGNAL_LABELS = {
  benford_law: "Benford's Law fit (numeric leading digits)",
  numeric_distribution: "Numeric distribution shape",
  categorical_distribution: "Category frequency balance",
  sequential_ids: "Sequential ID columns",
};

async function checkAuthenticity() {
  const circle = document.getElementById("authScoreCircle");
  const number = document.getElementById("authScoreNumber");
  const verdict = document.getElementById("authVerdict");
  const subtext = document.getElementById("authSubtext");
  const signalsEl = document.getElementById("authSignals");

  number.textContent = "…";
  verdict.textContent = "Checking...";
  subtext.textContent = "Running statistical signal checks on the uploaded data.";
  signalsEl.innerHTML = "";
  circle.className = "auth-score-circle";

  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/authenticity`, {}, 20000);
    if (!res.ok) throw new Error((await res.json()).detail || "Authenticity check failed");
    const data = await res.json();

    number.textContent = `${Math.round(data.authenticity_score)}%`;
    verdict.textContent = data.verdict;
    subtext.textContent = `Estimated ${data.synthetic_likelihood}% likelihood of synthetic/generated patterns.`;

    circle.className =
      "auth-score-circle " + (data.authenticity_score >= 70 ? "high" : data.authenticity_score >= 45 ? "mid" : "low");

    signalsEl.innerHTML = Object.entries(data.components)
      .map(([key, val]) => {
        const label = AUTH_SIGNAL_LABELS[key] || key;
        const pct = Math.round(val.score * 100);
        let detail = "";
        if (key === "sequential_ids") {
          detail = val.sequential_columns.length
            ? `Found in: ${val.sequential_columns.join(", ")}`
            : "No gapless sequential ID columns found";
        } else if (val.columns_checked) {
          detail = `Checked: ${val.columns_checked.slice(0, 4).join(", ")}${val.columns_checked.length > 4 ? "…" : ""}`;
        }
        return `
          <div class="auth-signal-row">
            <div>
              <div class="auth-signal-label">${label}</div>
              <div class="auth-signal-detail">${detail}</div>
            </div>
            <div class="pill ${pct >= 70 ? "pill-done" : pct >= 45 ? "" : "pill-warn"}">${pct}%</div>
          </div>`;
      })
      .join("");
  } catch (err) {
    verdict.textContent = "Check failed";
    subtext.textContent = err.message;
    number.textContent = "?";
  }
}

/* ---------------------------------------------------------------------
   CORRELATION HEATMAP + FEATURE IMPORTANCE
--------------------------------------------------------------------- */
function correlationColor(value) {
  // -1 (red) -> 0 (dark neutral) -> +1 (blue/teal)
  if (value >= 0) {
    const alpha = Math.abs(value);
    return `rgba(56, 189, 248, ${0.15 + alpha * 0.75})`;
  }
  const alpha = Math.abs(value);
  return `rgba(248, 113, 113, ${0.15 + alpha * 0.75})`;
}

function renderCorrelationHeatmap(correlation) {
  const wrap = document.getElementById("correlationHeatmap");
  if (!correlation || !correlation.columns || correlation.columns.length < 2) {
    wrap.innerHTML = '<p class="muted">Not enough numeric columns for a correlation heatmap.</p>';
    return;
  }

  const { columns, matrix } = correlation;
  let html = '<table class="heatmap-table"><thead><tr><th></th>';
  columns.forEach((c) => (html += `<th>${escapeHtml(c)}</th>`));
  html += "</tr></thead><tbody>";

  matrix.forEach((row, i) => {
    html += `<tr><th>${escapeHtml(columns[i])}</th>`;
    row.forEach((val) => {
      html += `<td><div class="heatmap-cell" style="background:${correlationColor(val)}; padding:6px 10px;">${val.toFixed(2)}</div></td>`;
    });
    html += "</tr>";
  });
  html += "</tbody></table>";
  wrap.innerHTML = html;
}

function renderFeatureImportance(importanceList) {
  const list = document.getElementById("featureImportanceList");
  if (!importanceList || importanceList.length === 0) {
    list.innerHTML = '<p class="muted">Feature importance needs a trained classifier — check the ML Dashboard above for status.</p>';
    return;
  }

  const maxImportance = Math.max(...importanceList.map((f) => f.importance));
  list.innerHTML = importanceList
    .map((f) => {
      const pct = maxImportance > 0 ? (f.importance / maxImportance) * 100 : 0;
      return `
        <div class="importance-row">
          <div class="importance-label" title="${escapeHtml(f.feature)}">${escapeHtml(f.feature)}</div>
          <div class="importance-bar-track"><div class="importance-bar-fill" style="width:${pct}%"></div></div>
          <div class="importance-pct">${(f.importance * 100).toFixed(1)}%</div>
        </div>`;
    })
    .join("");
}