/**
 * MedLens — Proactive Hypoglycaemia Decision Support
 * Core Frontend Controller & AI Assistant Engine
 */

// API Base URL: checks if hosted alongside backend or on separate port
const API_BASE = window.location.origin.includes(':5000') 
  ? '' 
  : (window.location.protocol === 'file:' ? 'http://127.0.0.1:5000' : 'http://127.0.0.1:5000');

// Global Application State
let appState = {
  currentContext: {
    glucose: 82,
    current_glucose: 82,
    trend: 'falling',
    insulin_taken: 'yes',
    insulin_dose: 4.0,
    time_since_insulin: 45,
    recent_meal: 'no',
    carb_intake: 0,
    activity_level: 'moderate',
    time_of_day: 'afternoon'
  },
  activeAnalysis: null,
  activeAction: null,
  actionStatus: 'pending', // 'pending' | 'approved' | 'dismissed'
  backendOnline: false,
  chatMessages: [
    {
      sender: 'assistant',
      text: 'Hello! I am your <strong>MedLens AI Information Assistant</strong>. I provide health information and explain your glycemic metrics.<br><br><em>Note: The MedLens Agent autonomously analyzes risks and proposes actions; I help you understand the decisions!</em>',
      time: 'Just now'
    }
  ]
};

// ==============================================================================
// INITIALIZATION
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
  checkBackendHealth();
  // Perform initial analysis with Scenario A default
  triggerAnalysis();
});

// Check Flask Backend Connectivity
async function checkBackendHealth() {
  const statusTag = document.getElementById('apiStatusTag');
  try {
    const res = await fetch(`${API_BASE}/api/health`, { method: 'GET', signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = await res.json();
      appState.backendOnline = true;
      if (statusTag) {
        statusTag.innerHTML = `<span class="api-dot"></span> Backend Active (${data.status})`;
        statusTag.style.color = 'var(--accent-green)';
      }
      // Also fetch longitudinal pattern recommendations
      fetchPatternRecommendation();
    } else {
      throw new Error('Non-200 response');
    }
  } catch (err) {
    appState.backendOnline = false;
    if (statusTag) {
      statusTag.innerHTML = `<span class="api-dot" style="background:#f59e0b;box-shadow:0 0 6px #f59e0b"></span> Client Simulation Mode`;
      statusTag.style.color = 'var(--accent-amber)';
    }
    console.warn('Flask backend not reachable. Utilizing built-in clinical fallback engine.', err);
  }
}

// ==============================================================================
// SCENARIOS & PRESETS (FOR JUDGES)
// ==============================================================================
const SCENARIOS = {
  high: {
    glucose: 82,
    trend: 'falling',
    insulin_taken: 'yes',
    insulin_dose: 4.0,
    time_since_insulin: 45,
    recent_meal: 'no',
    carb_intake: 0,
    activity_level: 'moderate',
    btnId: 'presetScenarioHigh'
  },
  moderate: {
    glucose: 92,
    trend: 'falling',
    insulin_taken: 'yes',
    insulin_dose: 2.0,
    time_since_insulin: 90,
    recent_meal: 'no',
    carb_intake: 0,
    activity_level: 'low',
    btnId: 'presetScenarioMod'
  },
  low: {
    glucose: 115,
    trend: 'stable',
    insulin_taken: 'no',
    insulin_dose: 0.0,
    time_since_insulin: 0,
    recent_meal: 'yes',
    carb_intake: 45,
    activity_level: 'none',
    btnId: 'presetScenarioLow'
  }
};

function loadScenario(type) {
  const scenario = SCENARIOS[type];
  if (!scenario) return;

  // Update preset buttons active state
  document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(scenario.btnId);
  if (activeBtn) activeBtn.classList.add('active');

  // Populate form fields
  document.getElementById('inputGlucose').value = scenario.glucose;
  document.getElementById('inputTrend').value = scenario.trend;
  document.getElementById('inputInsulinTaken').value = scenario.insulin_taken;
  document.getElementById('inputInsulinDose').value = scenario.insulin_dose;
  document.getElementById('inputTimeSinceInsulin').value = scenario.time_since_insulin;
  document.getElementById('inputRecentMeal').value = scenario.recent_meal;
  document.getElementById('inputCarbIntake').value = scenario.carb_intake;
  document.getElementById('inputActivity').value = scenario.activity_level;

  toggleInsulinFields();
  triggerAnalysis();
}

function toggleInsulinFields() {
  const taken = document.getElementById('inputInsulinTaken').value === 'yes';
  const doseGroup = document.getElementById('groupInsulinDose');
  const timeGroup = document.getElementById('groupInsulinTime');
  if (doseGroup) doseGroup.style.opacity = taken ? '1' : '0.4';
  if (timeGroup) timeGroup.style.opacity = taken ? '1' : '0.4';
}

// ==============================================================================
// FORM SUBMISSION & AGENT ANALYSIS
// ==============================================================================
function handleAnalyzeSubmit(e) {
  if (e) e.preventDefault();
  triggerAnalysis();
}

async function triggerAnalysis() {
  const btn = document.getElementById('analyzeBtn');
  const btnText = document.getElementById('analyzeBtnText');
  const statusPill = document.getElementById('agentStatusPill');
  const statusText = document.getElementById('agentStatusText');

  // Read Form Inputs
  const glucose = parseFloat(document.getElementById('inputGlucose').value) || 100;
  const trend = document.getElementById('inputTrend').value;
  const insulin_taken = document.getElementById('inputInsulinTaken').value;
  const insulin_dose = parseFloat(document.getElementById('inputInsulinDose').value) || 0;
  const time_since_insulin = parseFloat(document.getElementById('inputTimeSinceInsulin').value) || 0;
  const recent_meal = document.getElementById('inputRecentMeal').value;
  const carb_intake = parseFloat(document.getElementById('inputCarbIntake').value) || 0;
  const activity_level = document.getElementById('inputActivity').value;

  const payload = {
    glucose: glucose,
    current_glucose: glucose,
    trend: trend,
    insulin_taken: insulin_taken,
    insulin_dose: insulin_dose,
    time_since_insulin: time_since_insulin,
    recent_meal: recent_meal,
    carb_intake: carb_intake,
    activity_level: activity_level,
    time_of_day: 'afternoon'
  };

  appState.currentContext = payload;

  // UI Loading State
  if (btn) {
    btn.classList.add('loading');
    btn.disabled = true;
  }
  if (btnText) btnText.textContent = 'MedLens Agent is analyzing your context...';
  if (statusPill) {
    statusPill.className = 'agent-status-pill analyzing';
    statusText.textContent = '● Analyzing context...';
  }

  let result = null;

  try {
    // Attempt Live Flask POST
    const res = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3500)
    });

    if (res.ok) {
      result = await res.json();
      appState.backendOnline = true;
    } else {
      throw new Error(`Server returned status ${res.status}`);
    }
  } catch (err) {
    console.warn('Calling fallback simulation logic:', err.message);
    result = runFallbackAnalysis(payload);
  }

  // Artificial slight delay for smooth aesthetic if API was instantaneous
  setTimeout(() => {
    appState.activeAnalysis = result;
    appState.activeAction = result.proposed_action;
    appState.actionStatus = 'pending';

    renderDashboard(result);

    // Reset Button
    if (btn) {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
    if (btnText) btnText.textContent = 'Analyze with MedLens Agent';

    // Update Agent Status Indicator
    if (result.proposed_action && result.proposed_action.requires_approval) {
      statusPill.className = 'agent-status-pill awaiting';
      statusText.textContent = '⚠ Action awaiting approval';
    } else {
      statusPill.className = 'agent-status-pill';
      statusText.textContent = '✓ Analysis complete';
    }

    // Refresh context in AI Chatbot
    updateChatContextPill();
  }, 400);
}

// ==============================================================================
// DASHBOARD RENDERING
// ==============================================================================
function renderDashboard(data) {
  const ctx = data.context_received || appState.currentContext;
  const prediction = data.prediction;
  const riskLevel = (data.risk_level || 'LOW').toUpperCase();
  const riskScore = data.risk_score || 0;
  const factors = data.factors || [];
  const proposedAction = data.proposed_action;

  // 1. Render Current Glucose Card
  renderCurrentGlucoseCard(ctx.glucose, ctx.trend);

  // 2. Render Hypoglycaemia Risk Card
  renderRiskCard(riskScore, riskLevel, factors);

  // 3. Render 30-Minute Glucose Prediction Card
  renderPredictionCard(prediction);

  // 4. Render Agent Reasoning Card
  renderReasoningCard(factors, data.explanation, ctx);

  // 5. Render Smart Action Card
  renderActionCard(proposedAction);

  // 6. Refresh Pattern Card
  fetchPatternRecommendation();
}

// Render Card 1: Current Glucose
function renderCurrentGlucoseCard(glucoseVal, trend) {
  const numElem = document.getElementById('displayGlucoseVal');
  const badge = document.getElementById('displayTrendBadge');
  const icon = document.getElementById('displayTrendIcon');
  const text = document.getElementById('displayTrendText');
  const pin = document.getElementById('glucoseRangePin');
  const footnote = document.getElementById('glucoseStatusFootnote');

  if (numElem) numElem.textContent = Math.round(glucoseVal);

  const t = (trend || 'stable').toLowerCase();
  badge.className = `glucose-trend-badge ${t}`;

  if (t === 'falling') {
    icon.textContent = '↓';
    text.textContent = 'Falling';
  } else if (t === 'rising') {
    icon.textContent = '↑';
    text.textContent = 'Rising';
  } else {
    icon.textContent = '→';
    text.textContent = 'Stable';
  }

  // Calculate position on range bar (0 to 200 mg/dL mapped to 0-100%)
  const clamped = Math.max(40, Math.min(200, glucoseVal));
  const pct = ((clamped - 40) / (200 - 40)) * 100;
  if (pin) pin.style.left = `${pct}%`;

  if (footnote) {
    if (glucoseVal < 70) {
      footnote.textContent = '⚠️ Hypoglycaemic threshold crossed (<70 mg/dL)';
      footnote.style.color = '#f87171';
    } else if (glucoseVal <= 85) {
      footnote.textContent = 'Approaching hypoglycaemia threshold (70 mg/dL)';
      footnote.style.color = '#fbbf24';
    } else if (glucoseVal <= 140) {
      footnote.textContent = 'Within target physiological range (70–140 mg/dL)';
      footnote.style.color = '#34d399';
    } else {
      footnote.textContent = 'Elevated post-prandial range (>140 mg/dL)';
      footnote.style.color = '#fbbf24';
    }
  }
}

// Render Card 2: Risk Card
function renderRiskCard(score, level, factors) {
  const badge = document.getElementById('riskLevelBadge');
  const scoreDisp = document.getElementById('riskScoreDisplay');
  const gaugeBar = document.getElementById('gaugeCircleBar');
  const factorsList = document.getElementById('riskFactorsList');

  // Gauge circumference = 2 * PI * 66 ≈ 414.69
  const circumference = 414.69;
  const offset = circumference - (score / 100) * circumference;

  if (scoreDisp) scoreDisp.innerHTML = `${score}<small>%</small>`;

  const levelClass = level === 'HIGH' ? 'risk-high' : (level === 'MODERATE' ? 'risk-moderate' : 'risk-low');

  if (badge) {
    badge.className = `risk-level-badge ${levelClass}`;
    badge.textContent = `${level} RISK`;
  }

  if (gaugeBar) {
    gaugeBar.className = `gauge-bar ${levelClass}`;
    gaugeBar.style.strokeDashoffset = offset;
  }

  // Factor chips
  if (factorsList) {
    factorsList.innerHTML = '';
    const displayFactors = factors.length > 0 
      ? factors 
      : ['Physiological baseline stable', 'No compounding peak'];
    displayFactors.forEach(factor => {
      const chip = document.createElement('span');
      chip.className = 'factor-chip';
      chip.innerHTML = `<span class="chip-dot" style="background:${level === 'HIGH' ? '#ef4444' : (level === 'MODERATE' ? '#f59e0b' : '#10b981')}"></span> ${factor}`;
      factorsList.appendChild(chip);
    });
  }
}

// Render Card 3: 30-Minute Glucose Prediction Card
function renderPredictionCard(prediction) {
  if (!prediction || !prediction.trajectory) return;

  const trajectory = prediction.trajectory; // array of {minute, glucose}
  const deltaBadge = document.getElementById('predictionDeltaBadge');
  const svg = document.getElementById('trajectoryChartSvg');
  const areaPath = document.getElementById('chartAreaPath');
  const strokePath = document.getElementById('chartStrokePath');
  const nodesGroup = document.getElementById('chartNodesGroup');

  const curr = prediction.current_glucose;
  const pred = prediction.predicted_glucose;
  const delta = pred - curr;

  if (deltaBadge) {
    deltaBadge.textContent = `Predicted: ${pred} mg/dL (${delta >= 0 ? '+' : ''}${delta}m)`;
    if (pred < 70) {
      deltaBadge.className = 'badge badge-predictive';
      deltaBadge.style.background = 'rgba(239, 68, 68, 0.2)';
      deltaBadge.style.color = '#f87171';
      deltaBadge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    } else {
      deltaBadge.className = 'badge badge-predictive';
      deltaBadge.style.background = 'rgba(245, 158, 11, 0.12)';
      deltaBadge.style.color = 'var(--accent-amber)';
      deltaBadge.style.borderColor = 'rgba(245, 158, 11, 0.25)';
    }
  }

  // Update X-axis label values
  const n0 = trajectory.find(t => t.minute === 0);
  const n10 = trajectory.find(t => t.minute === 10);
  const n20 = trajectory.find(t => t.minute === 20);
  const n30 = trajectory.find(t => t.minute === 30);

  if (n0 && document.getElementById('nodeValNow')) document.getElementById('nodeValNow').textContent = n0.glucose;
  if (n10 && document.getElementById('nodeVal10')) document.getElementById('nodeVal10').textContent = n10.glucose;
  if (n20 && document.getElementById('nodeVal20')) document.getElementById('nodeVal20').textContent = n20.glucose;
  if (n30 && document.getElementById('nodeVal30')) document.getElementById('nodeVal30').textContent = n30.glucose;

  // Chart Coordinate Mapping:
  // ViewBox: 0 0 460 180
  // X range: 50 to 410 (width 360)
  // Y range: 40 mg/dL (Y=150) to 160 mg/dL (Y=20)
  const minG = 35;
  const maxG = 165;
  const yRange = 130;
  const topY = 20;

  function getY(g) {
    const clamped = Math.max(minG, Math.min(maxG, g));
    const normalized = (clamped - minG) / (maxG - minG);
    return Math.round(topY + (1 - normalized) * yRange);
  }

  const xPositions = [50, 170, 290, 410];
  const points = trajectory.map((item, idx) => ({
    x: xPositions[idx] || 50,
    y: getY(item.glucose),
    glucose: item.glucose,
    minute: item.minute
  }));

  // Build SVG Path
  let dStroke = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    // Smooth cubic curve
    const prev = points[i - 1];
    const currPt = points[i];
    const cpX1 = prev.x + (currPt.x - prev.x) / 2;
    const cpY1 = prev.y;
    const cpX2 = prev.x + (currPt.x - prev.x) / 2;
    const cpY2 = currPt.y;
    dStroke += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${currPt.x} ${currPt.y}`;
  }

  const dArea = `${dStroke} L ${points[points.length - 1].x} 165 L ${points[0].x} 165 Z`;

  if (strokePath) {
    strokePath.setAttribute('d', dStroke);
    strokePath.style.stroke = pred < 70 ? '#ef4444' : (delta < -5 ? '#f59e0b' : '#10b981');
  }
  if (areaPath) areaPath.setAttribute('d', dArea);

  // Position Hypo Threshold Line (70 mg/dL)
  const hypoY = getY(70);
  const hypoLine = document.getElementById('hypoThresholdLine');
  const hypoLabel = document.querySelector('.hypo-alert-label');
  if (hypoLine) {
    hypoLine.setAttribute('y1', hypoY);
    hypoLine.setAttribute('y2', hypoY);
  }
  if (hypoLabel) {
    hypoLabel.setAttribute('y', hypoY - 5);
  }

  // Render Interactive Nodes
  if (nodesGroup) {
    nodesGroup.innerHTML = '';
    points.forEach(pt => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pt.x);
      circle.setAttribute('cy', pt.y);
      circle.setAttribute('r', '5.5');
      circle.setAttribute('class', 'trajectory-node');
      circle.style.stroke = pt.glucose < 70 ? '#ef4444' : (pt.glucose < 85 ? '#f59e0b' : '#10b981');

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `+${pt.minute}m: ${pt.glucose} mg/dL`;
      circle.appendChild(title);

      nodesGroup.appendChild(circle);
    });
  }
}

// Render Card 4: Agent Reasoning
function renderReasoningCard(factors, explanation, ctx) {
  const f1 = document.getElementById('reasonFactor1');
  const f2 = document.getElementById('reasonFactor2');
  const f3 = document.getElementById('reasonFactor3');
  const summary = document.getElementById('reasoningSummaryText');

  if (f1) {
    if (ctx.trend === 'falling') {
      f1.textContent = 'Glucose is currently falling with notable downward momentum.';
    } else if (ctx.trend === 'rising') {
      f1.textContent = 'Glucose is rising, counteracting near-term hypoglycaemia risk.';
    } else {
      f1.textContent = 'Glucose trajectory is stable across current measurement intervals.';
    }
  }

  if (f2) {
    if (ctx.insulin_taken === 'yes' || ctx.insulin_taken === true) {
      f2.textContent = `Recent insulin dose (${ctx.insulin_dose || 3.0} U administered ${ctx.time_since_insulin || 45}m ago) continues active metabolic uptake.`;
    } else {
      f2.textContent = 'No active bolus insulin on board; metabolic clearance is at resting baseline.';
    }
  }

  if (f3) {
    if (ctx.activity_level === 'high' || ctx.activity_level === 'moderate') {
      f3.textContent = `${ctx.activity_level.charAt(0).toUpperCase() + ctx.activity_level.slice(1)} physical activity markedly accelerates peripheral muscle glucose disposal.`;
    } else if (ctx.recent_meal === 'yes') {
      f3.textContent = `Recent meal with ~${ctx.carb_intake || 30}g carbohydrates provides buffering against sudden drops.`;
    } else {
      f3.textContent = 'Fasting context with resting activity maintains steady-state liver output.';
    }
  }

  if (summary) {
    summary.textContent = explanation || 'Agent synthesis: The model projects near-term trajectory based on insulin, velocity, and exercise factors.';
  }
}

// Render Card 5: Smart Action Card
function renderActionCard(action) {
  if (!action) return;

  const statusBadge = document.getElementById('actionStatusBadge');
  const actionTitle = document.getElementById('actionTitle');
  const actionRec = document.getElementById('actionRecommendationText');
  const actionSubtext = document.getElementById('actionSubtext');
  const stepsList = document.getElementById('actionStepsList');
  const btnGroup = document.getElementById('actionButtonsGroup');
  const resultBanner = document.getElementById('actionResultBanner');

  // Reset UI elements
  btnGroup.classList.remove('hidden');
  resultBanner.classList.add('hidden');
  resultBanner.classList.remove('dismissed-banner');

  statusBadge.className = 'action-status-badge pending';
  statusBadge.textContent = 'Awaiting Approval';

  const isHighRisk = (appState.activeAnalysis?.risk_level || '').toUpperCase() === 'HIGH';
  const interval = action.recommended_interval_minutes || (isHighRisk ? 15 : 30);

  if (actionRec) {
    actionRec.textContent = isHighRisk 
      ? `Set a ${interval}-minute rapid glucose re-check reminder.`
      : `Schedule a ${interval}-minute follow-up glucose re-check.`;
  }

  if (actionSubtext) {
    actionSubtext.textContent = action.message || 'The Agent detected elevated near-term risk and recommends a follow-up check.';
  }

  if (stepsList && action.suggested_steps) {
    stepsList.innerHTML = '';
    action.suggested_steps.forEach(step => {
      const li = document.createElement('li');
      li.textContent = step;
      stepsList.appendChild(li);
    });
  }
}

// ==============================================================================
// ACTION APPROVAL / DISMISSAL FLOW
// ==============================================================================
let reminderTimerInterval = null;

async function handleApproveAction() {
  const action = appState.activeAction;
  const statusBadge = document.getElementById('actionStatusBadge');
  const btnGroup = document.getElementById('actionButtonsGroup');
  const resultBanner = document.getElementById('actionResultBanner');
  const resultIcon = document.getElementById('resultIconWrap');
  const resultHeadline = document.getElementById('resultHeadline');
  const resultDetail = document.getElementById('resultDetail');
  const statusPill = document.getElementById('agentStatusPill');
  const statusText = document.getElementById('agentStatusText');

  const actionId = action ? (action.id || action.action_id) : 'act_demo';
  const interval = action?.recommended_interval_minutes || 15;

  let executionDetails = null;

  try {
    const res = await fetch(`${API_BASE}/api/action/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_id: actionId }),
      signal: AbortSignal.timeout(3000)
    });

    if (res.ok) {
      const data = await res.json();
      executionDetails = data.execution_details;
    } else {
      throw new Error('Approval endpoint returned non-200');
    }
  } catch (err) {
    console.warn('Backend approve fallback:', err.message);
    const now = new Date();
    const scheduled = new Date(now.getTime() + interval * 60000);
    executionDetails = {
      scheduled_reminder_time: scheduled.toTimeString().split(' ')[0],
      interval_minutes: interval,
      confirmation_message: `Action confirmed. Glucose re-check reminder scheduled for ${scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${interval} minutes from now).`
    };
  }

  appState.actionStatus = 'approved';

  // Smooth UI Transition
  btnGroup.classList.add('hidden');
  resultBanner.classList.remove('hidden');
  resultBanner.classList.remove('dismissed-banner');

  resultIcon.textContent = '✓';
  resultIcon.style.background = 'var(--accent-green)';
  resultHeadline.textContent = '✓ Action approved';
  
  // Start dynamic countdown timer
  let remainingSeconds = interval * 60;
  if (reminderTimerInterval) clearInterval(reminderTimerInterval);

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  resultDetail.innerHTML = `Glucose re-check reminder created.<br><strong>Target: ${executionDetails.scheduled_reminder_time || 'In ' + interval + 'm'}</strong> &bull; <span style="color:#34d399;font-weight:700">Timer: <span id="reminderCountdown">${formatTime(remainingSeconds)}</span></span>`;

  reminderTimerInterval = setInterval(() => {
    remainingSeconds--;
    const countElem = document.getElementById('reminderCountdown');
    if (countElem) {
      if (remainingSeconds > 0) {
        countElem.textContent = formatTime(remainingSeconds);
      } else {
        countElem.textContent = '00:00 (Check Glucose Now!)';
        clearInterval(reminderTimerInterval);
      }
    }
  }, 1000);

  statusBadge.className = 'action-status-badge approved';
  statusBadge.textContent = 'Approved & Active';

  if (statusPill) {
    statusPill.className = 'agent-status-pill';
    statusText.textContent = '✓ Reminder timer running';
  }
}

async function handleDismissAction() {
  const action = appState.activeAction;
  const statusBadge = document.getElementById('actionStatusBadge');
  const btnGroup = document.getElementById('actionButtonsGroup');
  const resultBanner = document.getElementById('actionResultBanner');
  const resultIcon = document.getElementById('resultIconWrap');
  const resultHeadline = document.getElementById('resultHeadline');
  const resultDetail = document.getElementById('resultDetail');
  const statusPill = document.getElementById('agentStatusPill');
  const statusText = document.getElementById('agentStatusText');

  const actionId = action ? (action.id || action.action_id) : 'act_demo';

  try {
    await fetch(`${API_BASE}/api/action/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action_id: actionId }),
      signal: AbortSignal.timeout(3000)
    });
  } catch (err) {
    console.warn('Backend dismiss fallback:', err.message);
  }

  appState.actionStatus = 'dismissed';

  btnGroup.classList.add('hidden');
  resultBanner.classList.remove('hidden');
  resultBanner.classList.add('dismissed-banner');

  resultIcon.textContent = '✕';
  resultIcon.style.background = 'var(--text-muted)';
  resultHeadline.textContent = 'Action proposal dismissed';
  resultDetail.textContent = 'No reminder will be created. Standard continuous glucose tracking remains active.';

  statusBadge.className = 'action-status-badge dismissed';
  statusBadge.textContent = 'Dismissed';

  if (statusPill) {
    statusPill.className = 'agent-status-pill';
    statusText.textContent = '● Monitoring active';
  }
}

// ==============================================================================
// ADAPTIVE PATTERN RECOMMENDATION
// ==============================================================================
async function fetchPatternRecommendation() {
  const msgElem = document.getElementById('patternMessage');
  const recElem = document.getElementById('patternRecommendation');
  const badgeElem = document.getElementById('patternStatusBadge');
  const countElem = document.getElementById('patternRecordsCount');

  try {
    const res = await fetch(`${API_BASE}/api/recommendation`, { method: 'GET', signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const data = await res.json();
      if (data.pattern_detected) {
        if (msgElem) msgElem.textContent = data.message;
        if (recElem) recElem.textContent = data.recommendation;
        if (badgeElem) {
          badgeElem.textContent = 'Pattern Identified';
          badgeElem.className = 'badge badge-pattern';
        }
        if (countElem) countElem.textContent = `Analyzed historical sessions: ${data.total_records_analyzed || 5} entries`;
      } else {
        if (msgElem) msgElem.textContent = data.message || 'Keep logging to unlock personalized patterns.';
        if (recElem) recElem.textContent = data.recommendation || 'MedLens needs at least 3 entries to identify recurring patterns.';
        if (badgeElem) badgeElem.textContent = 'Collecting Baseline';
      }
    }
  } catch (err) {
    // Default fallback pattern if backend is offline
    if (msgElem && !msgElem.textContent) {
      msgElem.textContent = 'Similar elevated-risk situations have occurred after physical activity following insulin administration.';
    }
    if (recElem && !recElem.textContent) {
      recElem.textContent = 'Continue logging glucose around activity so MedLens can better understand your pattern profile. Consider reviewing pre-exercise carbohydrate buffering with your doctor.';
    }
  }
}

// ==============================================================================
// FLOATING AI INFORMATION ASSISTANT CHATBOT
// ==============================================================================
function toggleChatWindow() {
  const chatWindow = document.getElementById('aiChatWindow');
  if (chatWindow) {
    chatWindow.classList.toggle('hidden');
    if (!chatWindow.classList.contains('hidden')) {
      const input = document.getElementById('chatInputText');
      if (input) input.focus();
      scrollToChatBottom();
      updateChatContextPill();
    }
  }
}

// Helper to extract safe current context without undefined or null values
function getSafeCurrentContext() {
  const ctx = appState.currentContext || {};
  let glucose = null;
  if (ctx.glucose !== undefined && ctx.glucose !== null && !isNaN(Number(ctx.glucose))) {
    glucose = Math.round(Number(ctx.glucose));
  } else if (ctx.current_glucose !== undefined && ctx.current_glucose !== null && !isNaN(Number(ctx.current_glucose))) {
    glucose = Math.round(Number(ctx.current_glucose));
  }

  const trend = (ctx.trend && typeof ctx.trend === 'string' && ctx.trend.trim()) 
    ? ctx.trend.trim().toLowerCase() 
    : null;

  const insulinTaken = ctx.insulin_taken === 'yes' || ctx.insulin_taken === true;
  const insulinDose = ctx.insulin_dose !== undefined && ctx.insulin_dose !== null ? Number(ctx.insulin_dose) : 0;
  const timeSinceInsulin = ctx.time_since_insulin !== undefined && ctx.time_since_insulin !== null ? Number(ctx.time_since_insulin) : 0;
  const activityLevel = (ctx.activity_level && typeof ctx.activity_level === 'string') ? ctx.activity_level.trim().toLowerCase() : 'none';

  const analysis = appState.activeAnalysis;
  const riskLevel = (analysis && analysis.risk_level) ? analysis.risk_level : null;
  const riskScore = (analysis && analysis.risk_score !== undefined && analysis.risk_score !== null) ? analysis.risk_score : null;
  const predGlucose = (analysis && analysis.prediction && analysis.prediction.predicted_glucose !== undefined && analysis.prediction.predicted_glucose !== null) 
    ? Math.round(Number(analysis.prediction.predicted_glucose)) 
    : null;

  const hasContext = glucose !== null && !isNaN(glucose);

  return {
    glucose,
    trend,
    insulinTaken,
    insulinDose,
    timeSinceInsulin,
    activityLevel,
    analysis,
    riskLevel,
    riskScore,
    predGlucose,
    hasContext,
    ctx
  };
}

function updateChatContextPill() {
  const pill = document.getElementById('chatContextSummary');
  if (!pill) return;
  const context = getSafeCurrentContext();
  if (context.hasContext && context.riskLevel) {
    const trendDisplay = context.trend ? (context.trend.charAt(0).toUpperCase() + context.trend.slice(1)) : 'Stable';
    pill.textContent = `Context aware: ${context.glucose} mg/dL • ${trendDisplay} • ${context.riskLevel} Risk`;
  } else if (context.hasContext) {
    const trendDisplay = context.trend ? (context.trend.charAt(0).toUpperCase() + context.trend.slice(1)) : 'Stable';
    pill.textContent = `Context aware: ${context.glucose} mg/dL • ${trendDisplay}`;
  } else {
    pill.textContent = 'Current glucose data is not available';
  }
}

function askPresetQuestion(question) {
  const input = document.getElementById('chatInputText');
  if (input) {
    input.value = question;
    handleChatSubmit();
  }
}

function handleChatSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('chatInputText');
  const userText = input ? input.value.trim() : '';
  if (!userText) return;

  // Append user message
  appendChatMessage('user', userText);
  input.value = '';

  // Show typing indicator
  const typing = document.getElementById('chatTypingIndicator');
  if (typing) typing.classList.remove('hidden');
  scrollToChatBottom();

  // Generate contextual AI Assistant response
  setTimeout(() => {
    if (typing) typing.classList.add('hidden');
    const reply = generateAssistantAnswer(userText);
    appendChatMessage('assistant', reply);
    scrollToChatBottom();
  }, 500);
}

function appendChatMessage(sender, text) {
  const container = document.getElementById('chatMessagesBody');
  if (!container) return;

  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${sender}`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = text;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'msg-time';
  timeSpan.textContent = timeStr;

  msgDiv.appendChild(bubble);
  msgDiv.appendChild(timeSpan);
  container.appendChild(msgDiv);
}

function scrollToChatBottom() {
  const container = document.getElementById('chatMessagesBody');
  if (container) container.scrollTop = container.scrollHeight;
}

// Context-Aware Educational AI Assistant Logic
function generateAssistantAnswer(prompt) {
  const query = prompt.toLowerCase();
  const cleanPrompt = query.trim();
  const stripped = cleanPrompt.replace(/[?!.,;:~`]/g, '').trim();

  // --------------------------------------------------------------------------
  // 1. GREETINGS (e.g. "hi", "hello", "hey", "good morning")
  // Return friendly greeting and DO NOT reference glucose, risk, or context.
  // --------------------------------------------------------------------------
  const pureGreetingWords = ['hi', 'hello', 'hey', 'greetings', 'howdy', 'sup', 'yo', 'good morning', 'good afternoon', 'good evening'];
  const isGreetingPattern = pureGreetingWords.includes(stripped) ||
    /^(hi|hello|hey|greetings|howdy|sup|yo)(\s+(there|assistant|bot|medlens))?$/i.test(stripped) ||
    /^good\s*(morning|afternoon|evening|day)$/i.test(stripped);

  // Check if message also contains an explicit medical question
  const medicalQuestionKeywords = ['hypo', 'glucose', 'sugar', 'insulin', 'trend', 'falling', 'rising', 'food', 'carb', 'eat', 'prediction', 'why', 'trajectory', 'risk', 'dose', 'symptom'];
  const hasMedicalQuestion = medicalQuestionKeywords.some(kw => cleanPrompt.includes(kw));

  if (isGreetingPattern && !hasMedicalQuestion) {
    return `Hello! I am your <strong>MedLens AI Assistant</strong>.
    <br><br>
    How can I help you today? You can ask me general diabetes questions (e.g., <em>"What is hypoglycaemia?"</em> or <em>"What is the Rule of 15?"</em>) or ask about your active metrics (e.g., <em>"Why is my risk high?"</em> or <em>"Explain my 30-minute prediction"</em>).`;
  }

  // --------------------------------------------------------------------------
  // 2. GENERAL HEALTH-INFORMATION QUESTIONS
  // Educational responses explaining diabetes concepts without forcing patient data
  // --------------------------------------------------------------------------
  if (query.includes('what is hypoglycaemia') || query.includes('hypoglycemia') || query.includes('what is hypo') || query.includes('define hypo') || query.includes('symptom')) {
    return `<strong>Hypoglycaemia</strong> occurs when blood glucose drops below the safe physiological threshold, clinically defined as <strong>&lt; 70 mg/dL</strong>.
    <br><br>
    Common early symptoms include shakiness, sweating, lightheadedness, fast heartbeat, and sudden hunger. If left unaddressed, severe hypoglycemia can cause confusion or loss of consciousness. Standard clinical guidance suggests taking 15g of fast-acting carbohydrates (e.g., 4oz fruit juice or 3–4 glucose tablets) and re-checking in 15 minutes.`;
  }

  if (query.includes('what should i eat') || query.includes('rule of 15') || query.includes('fast-acting') || query.includes('rescue carb') || (query.includes('food') && !query.includes('risk'))) {
    return `When treating near-term low glucose (&lt; 70 mg/dL), clinical guidelines commonly recommend the <strong>Rule of 15</strong>:
    <ul style="margin: 0.5rem 0 0.5rem 1.2rem; padding: 0;">
      <li>Consume <strong>15 grams</strong> of fast-acting carbohydrates (e.g., 4 oz / 120 ml fruit juice, 3–4 glucose tablets, or 5–6 jelly beans).</li>
      <li>Wait <strong>15 minutes</strong> and re-check your blood glucose.</li>
      <li>If still below 70 mg/dL, repeat with another 15g of fast-acting carbs.</li>
    </ul>
    Avoid high-fat snacks (like chocolate or pastry) for immediate recovery because dietary fats delay carbohydrate absorption.`;
  }

  if (query.includes('difference between agent and assistant') || (query.includes('agent') && query.includes('assistant'))) {
    return `Great question! Here is how we complement each other:
    <br><br>
    • <strong>MedLens Agent:</strong> Autonomous decision engine that continuously computes risk scores, simulates 30-minute trajectories, and proposes actionable safety interventions requiring your explicit approval.
    <br><br>
    • <strong>MedLens AI Assistant (Me):</strong> Conversational knowledge companion here to answer health questions, explain the Agent's reasoning, and translate glycemic data into clear concepts.`;
  }

  if (query.includes('what does falling mean') || query.includes('falling trend') || (query.includes('trend') && !query.includes('my'))) {
    return `A <strong>falling glucose trend (↓)</strong> indicates that your blood sugar is decreasing by more than ~2 mg/dL per minute.
    <br><br>
    When combined with active insulin or physical exertion, falling trends create negative glycemic momentum and require closer monitoring to avoid sudden dips into hypoglycaemia.`;
  }

  if (query.includes('how does insulin work') || (query.includes('insulin') && !query.includes('my') && !query.includes('risk') && !query.includes('dose'))) {
    return `<strong>Rapid-acting insulin</strong> typically begins lowering blood glucose within 15 minutes, reaches peak activity between <strong>45 and 90 minutes</strong> after administration, and remains metabolically active for 3 to 4 hours.
    <br><br>
    During the peak window, downward pressure on glucose is highest, especially if unbuffered by carbohydrates or accelerated by physical exercise.`;
  }

  // --------------------------------------------------------------------------
  // 3. QUESTIONS ABOUT USER'S CURRENT MEDLENS RISK / PREDICTION / CONTEXT
  // --------------------------------------------------------------------------
  const context = getSafeCurrentContext();

  if (query.includes('why is my risk high') || query.includes('why risk') || query.includes('why is my risk') || query.includes('my risk') || query.includes('risk high') || query.includes('why high')) {
    if (!context.hasContext) {
      return `Current glucose data is not available. Please enter your metrics and click 'Analyze with MedLens Agent' on the dashboard to calculate your risk.`;
    }

    const riskDisplay = context.riskLevel 
      ? `${context.riskLevel}${context.riskScore !== null ? ` (Score: ${context.riskScore}/100)` : ''}` 
      : 'evaluated based on your current inputs';

    let reasons = [];
    if (context.glucose <= 85) {
      reasons.push(`Current glucose (${context.glucose} mg/dL) is approaching or in the low threshold range`);
    }
    if (context.trend === 'falling') {
      reasons.push('Glucose velocity is currently negative (falling trend)');
    }
    if (context.insulinTaken) {
      reasons.push(`Active insulin (${context.insulinDose} U taken ${context.timeSinceInsulin}m ago) is within its peak absorption window`);
    }
    if (context.activityLevel === 'moderate' || context.activityLevel === 'high') {
      reasons.push(`${context.activityLevel.charAt(0).toUpperCase() + context.activityLevel.slice(1)} physical activity markedly accelerates muscle glucose uptake`);
    }
    if (reasons.length === 0) {
      reasons.push(`Glucose level of ${context.glucose} mg/dL with ${context.trend || 'stable'} trend`);
    }

    return `Your risk is evaluated as <strong>${riskDisplay}</strong> because:
    <ul style="margin: 0.5rem 0 0.5rem 1.2rem; padding: 0;">
      ${reasons.map(r => `<li>${r}</li>`).join('')}
    </ul>
    The <strong>MedLens Agent</strong> detects these compounding factors before an acute low occurs, allowing you to prepare proactively.`;
  }

  if (query.includes('explain my prediction') || query.includes('my prediction') || query.includes('trajectory') || query.includes('predicted')) {
    if (!context.hasContext) {
      return `Current glucose data is not available. Please enter your metrics and click 'Analyze with MedLens Agent' on the dashboard to view your 30-minute prediction trajectory.`;
    }

    const predTarget = context.predGlucose !== null 
      ? `reach approximately <strong>${context.predGlucose} mg/dL</strong>` 
      : 'continue along its projected path';

    return `Based on your current glucose (${context.glucose} mg/dL) and metabolic trend (${context.trend || 'stable'}), the model predicts your glucose will ${predTarget} within the next 30 minutes.
    <br><br>
    The <strong>MedLens Agent</strong> utilizes this forward simulation to propose proactive check reminders before symptomatic lows occur.`;
  }

  if (query.includes('what is my glucose') || query.includes('my current glucose') || query.includes('my status') || query.includes('how am i')) {
    if (!context.hasContext) {
      return `Current glucose data is not available. Please enter your values in the dashboard to review your status.`;
    }
    const trendText = context.trend ? (context.trend.charAt(0).toUpperCase() + context.trend.slice(1)) : 'Stable';
    const riskText = context.riskLevel || 'Pending analysis';
    return `Your current logged glucose is <strong>${context.glucose} mg/dL</strong> with a <strong>${trendText}</strong> trend. Current evaluated risk level: <strong>${riskText}</strong>.`;
  }

  // --------------------------------------------------------------------------
  // 4. FALLBACK GENERAL RESPONSE
  // Safe handling whether context exists or is unavailable
  // --------------------------------------------------------------------------
  if (context.hasContext) {
    const trendDisplay = context.trend ? context.trend : 'stable';
    const riskDisplay = context.riskLevel ? context.riskLevel : 'calculated';
    return `Regarding your question about <em>"${escapeHtml(prompt)}"</em>:
    <br><br>
    In your active session (Glucose: <strong>${context.glucose} mg/dL</strong>, Trend: <strong>${trendDisplay}</strong>, Risk: <strong>${riskDisplay}</strong>), maintaining glycemic stability is the primary focus.
    <br><br>
    <em>Disclaimer: MedLens provides prototype educational decision-support and is not a substitute for professional medical advice.</em>`;
  } else {
    return `Regarding your question about <em>"${escapeHtml(prompt)}"</em>:
    <br><br>
    Current glucose data is not available. You can enter your values in the dashboard and click 'Analyze with MedLens Agent' to evaluate your near-term glycemic trends.
    <br><br>
    <em>Disclaimer: MedLens provides prototype educational decision-support and is not a substitute for professional medical advice.</em>`;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==============================================================================
// CLIENT CLINICAL FALLBACK ENGINE (IF BACKEND OFFLINE)
// Mirrors the exact Python algorithm from backend/agent.py
// ==============================================================================
function runFallbackAnalysis(ctx) {
  const glucose = parseFloat(ctx.glucose) || 100;
  const trend = ctx.trend || 'stable';
  const insulinTaken = ctx.insulin_taken === 'yes' || ctx.insulin_taken === true;
  const insulinDose = parseFloat(ctx.insulin_dose) || 0;
  const timeSince = parseFloat(ctx.time_since_insulin) || 0;
  const recentMeal = ctx.recent_meal === 'yes' || ctx.recent_meal === true;
  const carbIntake = parseFloat(ctx.carb_intake) || 0;
  const activity = ctx.activity_level || 'none';

  // 1. Risk Assessment
  let score = 0;
  let factors = [];

  if (glucose <= 70) { score += 50; factors.push('Glucose in hypoglycaemic range (<=70 mg/dL)'); }
  else if (glucose <= 80) { score += 40; factors.push('Low glucose baseline (<=80 mg/dL)'); }
  else if (glucose <= 90) { score += 25; factors.push('Borderline low glucose (<=90 mg/dL)'); }
  else if (glucose <= 100) { score += 10; factors.push('Mildly low normal glucose'); }

  if (trend === 'falling') { score += 25; factors.push('Rapidly falling trend'); }
  else if (trend === 'rising') { score -= 15; }

  if (insulinTaken) {
    if (timeSince <= 60) { score += 25; factors.push(`Active insulin peak window (${insulinDose} U at ${timeSince}m)`); }
    else if (timeSince <= 120) { score += 15; factors.push(`Active insulin lingering (${insulinDose} U)`); }
  }

  if (activity === 'high') { score += 25; factors.push('High intensity physical activity'); }
  else if (activity === 'moderate') { score += 15; factors.push('Moderate physical activity'); }
  else if (activity === 'low') { score += 5; }

  if (recentMeal && carbIntake >= 20) {
    score -= 20;
    factors.push(`Carbohydrate absorption buffer (~${carbIntake}g carbs)`);
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 70 ? 'HIGH' : (score >= 35 ? 'MODERATE' : 'LOW');

  // 2. Trajectory Calculation
  let velocity = 0.0;
  if (trend === 'falling') velocity -= 1.3;
  else if (trend === 'rising') velocity += 1.0;

  if (insulinTaken && timeSince <= 120) {
    const decay = Math.max(0.2, 1.0 - (timeSince / 120.0));
    velocity -= (insulinDose * 0.28 * decay);
  }

  if (activity === 'high') velocity -= 0.9;
  else if (activity === 'moderate') velocity -= 0.5;

  if (recentMeal && carbIntake > 0) {
    velocity += Math.min(1.2, carbIntake * 0.025);
  }

  const trajectory = [0, 10, 20, 30].map(minute => {
    if (minute === 0) return { minute: 0, glucose: Math.round(glucose) };
    const proj = Math.max(38, Math.min(380, glucose + velocity * minute));
    return { minute: minute, glucose: Math.round(proj) };
  });

  const predGlucose = trajectory[trajectory.length - 1].glucose;

  // 3. Proposed Action
  let actionType = 'routine_monitoring';
  let message = 'Current glycemic context is stable.';
  let interval = 120;
  let steps = ['Maintain regular routine', 'Next scheduled check in approx 2 hours'];

  if (level === 'HIGH' || predGlucose < 75) {
    actionType = 'glucose_recheck_reminder';
    interval = 15;
    message = `High risk detected (Score: ${score}, predicted ${predGlucose} mg/dL). Would you like MedLens to set a 15-minute glucose re-check reminder and keep fast-acting carbs ready?`;
    steps = [
      'Set a 15-minute timer for rapid glucose re-check',
      'Keep 15g of fast-acting carbohydrates accessible (e.g. 4oz fruit juice)',
      'Pause strenuous physical activity while glucose stabilizes'
    ];
  } else if (level === 'MODERATE' || predGlucose < 90) {
    actionType = 'scheduled_recheck_reminder';
    interval = 30;
    message = `Moderate risk identified (Score: ${score}). Would you like MedLens to set a 30-minute follow-up glucose re-check reminder?`;
    steps = [
      'Set a 30-minute follow-up re-check timer',
      'Monitor for subtle symptoms such as shakiness, sweating, or lightheadedness'
    ];
  }

  return {
    success: true,
    risk_level: level,
    risk_score: score,
    factors: factors,
    explanation: `Agent synthesis: Analysis of glucose (${glucose} mg/dL), ${trend} trend, and active context factors produces ${score}% hypoglycaemic risk.`,
    prediction: {
      current_glucose: Math.round(glucose),
      predicted_glucose: predGlucose,
      direction: predGlucose < glucose - 4 ? 'falling' : (predGlucose > glucose + 4 ? 'rising' : 'stable'),
      trajectory: trajectory
    },
    proposed_action: {
      id: `act_${Math.random().toString(36).substring(2, 9)}`,
      action: actionType,
      message: message,
      requires_approval: true,
      status: 'pending',
      recommended_interval_minutes: interval,
      suggested_steps: steps
    },
    context_received: ctx
  };
}
