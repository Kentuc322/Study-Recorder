import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_CONFIG } from "./config.js";

const settings = {
  weeklyGoalMinutes: createDefaultWeeklyGoals(SUPABASE_CONFIG.dailyGoalMinutes || 120),
  signedInEmail: ""
};

const elements = {
  authScreen: document.querySelector("#auth-screen"),
  appShell: document.querySelector("#app-shell"),
  loginButton: document.querySelector("#login-button"),
  logoutButton: document.querySelector("#logout-button"),
  setupWarning: document.querySelector("#setup-warning"),
  signedInUser: document.querySelector("#signed-in-user"),
  todayLabel: document.querySelector("#today-label"),
  recordForm: document.querySelector("#record-form"),
  userInput: document.querySelector("#user-input"),
  minutesInput: document.querySelector("#minutes-input"),
  dateInput: document.querySelector("#date-input"),
  qualityForm: document.querySelector("#quality-form"),
  qualityScoreInput: document.querySelector("#quality-score-input"),
  qualityNoteInput: document.querySelector("#quality-note-input"),
  todayTotal: document.querySelector("#today-total"),
  todayProgress: document.querySelector("#today-progress"),
  weekTotal: document.querySelector("#week-total"),
  weekAverage: document.querySelector("#week-average"),
  streakDays: document.querySelector("#streak-days"),
  entryCount: document.querySelector("#entry-count"),
  allTimeTotal: document.querySelector("#all-time-total"),
  weekChangeValue: document.querySelector("#week-change-value"),
  weekChangeDetail: document.querySelector("#week-change-detail"),
  goalRing: document.querySelector("#goal-ring"),
  goalPercent: document.querySelector("#goal-percent"),
  goalCopy: document.querySelector("#goal-copy"),
  rankingList: document.querySelector("#ranking-list"),
  recordsTable: document.querySelector("#records-table"),
  chart: document.querySelector("#trend-chart"),
  outcomeChart: document.querySelector("#outcome-chart"),
  distributionChart: document.querySelector("#distribution-chart"),
  chartRange: document.querySelector("#chart-range"),
  grassGrid: document.querySelector("#grass-grid"),
  chartTooltip: document.querySelector("#chart-tooltip"),
  goalWeekdayInput: document.querySelector("#goal-weekday-input"),
  goalMinutesInput: document.querySelector("#goal-minutes-input"),
  goalSaveButton: document.querySelector("#goal-save-button"),
  weeklyGoalSummary: document.querySelector("#weekly-goal-summary"),
  clearButton: document.querySelector("#clear-button"),
  exportButton: document.querySelector("#export-button"),
  importInput: document.querySelector("#import-input"),
  emptyRowTemplate: document.querySelector("#empty-row-template")
};

const hasSupabaseConfig = Boolean(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey);
const supabase = hasSupabaseConfig
  ? createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

let records = [];
let qualityRatings = [];
let currentUser = null;
let chartState = {
  trend: [],
  outcomeTrend: [],
  range: 14,
  donutSegments: []
};

initialize();

async function initialize() {
  const today = getDateKey(new Date());
  elements.todayLabel.textContent = today;
  elements.dateInput.value = today;
  elements.setupWarning.hidden = hasSupabaseConfig;
  elements.loginButton.disabled = !hasSupabaseConfig;
  elements.goalWeekdayInput.value = String(new Date().getDay());
  elements.goalMinutesInput.value = String(SUPABASE_CONFIG.dailyGoalMinutes || 120);

  bindEvents();

  if (!hasSupabaseConfig) {
    showAuth();
    return;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showError(error.message);
  }

  currentUser = data.session?.user || null;
  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    await syncAuthState();
  });

  await syncAuthState();
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  elements.loginButton.addEventListener("click", signInWithGoogle);
  elements.logoutButton.addEventListener("click", signOut);
  elements.goalSaveButton.addEventListener("click", saveWeeklyGoal);

  elements.recordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await addRecord();
  });

  elements.qualityForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await addQualityRating();
  });

  elements.chartRange.addEventListener("change", renderDashboard);
  elements.clearButton.addEventListener("click", clearOwnDashboardRecords);
  elements.exportButton.addEventListener("click", exportRecords);
  elements.importInput.addEventListener("change", importRecords);
  window.addEventListener("resize", renderDashboard);
  elements.chart.addEventListener("mousemove", handleTrendChartHover);
  elements.chart.addEventListener("mouseleave", hideChartTooltip);
  elements.outcomeChart.addEventListener("mousemove", handleOutcomeChartHover);
  elements.outcomeChart.addEventListener("mouseleave", hideChartTooltip);
  elements.distributionChart.addEventListener("mousemove", handleDistributionChartHover);
  elements.distributionChart.addEventListener("mouseleave", hideChartTooltip);
  elements.grassGrid.addEventListener("mousemove", handleGrassHover);
  elements.grassGrid.addEventListener("mouseleave", hideChartTooltip);
}

async function syncAuthState() {
  if (!currentUser) {
    records = [];
    showAuth();
    return;
  }

  showApp();
  await loadUserProfile();
  await loadRecords();
  await loadQualityRatings();
  renderDashboard();
}

async function signInWithGoogle() {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });

  if (error) {
    showError(error.message);
  }
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    showError(error.message);
  }
}

function showAuth() {
  elements.authScreen.hidden = false;
  elements.appShell.hidden = true;
}

function showApp() {
  elements.authScreen.hidden = true;
  elements.appShell.hidden = false;
  const signedInEmail = getSignedInEmail();
  elements.signedInUser.textContent = signedInEmail;
  elements.userInput.value = signedInEmail;
  elements.goalMinutesInput.value = String(SUPABASE_CONFIG.dailyGoalMinutes || 120);
}

function setView(view) {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === view);
  });
}

async function loadRecords() {
  const { data, error } = await supabase
    .from("study_entries")
    .select("id, auth_user_id, discord_user_id, google_email, username, minutes, study_date, source, created_at")
    .order("study_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    showError(error.message);
    return;
  }

  records = normalizeEntries(data);
}

async function loadQualityRatings() {
  const { data, error } = await supabase
    .from("study_quality_ratings")
    .select("id, auth_user_id, discord_user_id, google_email, username, study_date, score, note, source, created_at")
    .order("study_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    showError(error.message);
    return;
  }

  qualityRatings = normalizeQualityRatings(data);
}

async function loadUserProfile() {
  const email = getSignedInEmail();
  const { data, error } = await supabase
    .from("study_user_profiles")
    .select("google_email, weekly_goal_minutes")
    .eq("google_email", email)
    .maybeSingle();

  if (error) {
    showError(error.message);
    return;
  }

  settings.signedInEmail = email;
  settings.weeklyGoalMinutes = createDefaultWeeklyGoals(SUPABASE_CONFIG.dailyGoalMinutes || 120);
  if (data?.weekly_goal_minutes) {
    settings.weeklyGoalMinutes = normalizeWeeklyGoals(data.weekly_goal_minutes, SUPABASE_CONFIG.dailyGoalMinutes || 120);
  }

  elements.userInput.value = email;
  elements.goalMinutesInput.value = String(settings.weeklyGoalMinutes[String(elements.goalWeekdayInput.value)]);
  renderWeeklyGoalSummary();
}

async function saveUserProfile() {
  if (!currentUser) {
    return;
  }

  const email = getSignedInEmail();

  const payload = {
    auth_user_id: currentUser.id,
    google_email: email,
    username: email,
    weekly_goal_minutes: settings.weeklyGoalMinutes,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from("study_user_profiles")
    .upsert(payload, { onConflict: "google_email" });

  if (error) {
    showError(error.message);
  }
}

async function saveWeeklyGoal() {
  const weekday = clampNumber(Number(elements.goalWeekdayInput.value), 0, 6);
  const minutes = clampNumber(Number(elements.goalMinutesInput.value), 1, 1440);
  settings.weeklyGoalMinutes[String(weekday)] = minutes;
  await saveUserProfile();
  renderDashboard();
}

async function addRecord() {
  const email = getSignedInEmail();
  const minutes = clampNumber(Number(elements.minutesInput.value), 1, 1440);
  const date = elements.dateInput.value || getDateKey(new Date());

  const payload = {
    auth_user_id: currentUser.id,
    google_email: email,
    username: email,
    minutes,
    study_date: date,
    source: "dashboard"
  };

  const { error } = await supabase.from("study_entries").insert(payload);
  if (error) {
    showError(error.message);
    return;
  }

  await saveUserProfile();
  elements.minutesInput.value = "";
  elements.minutesInput.focus();
  await loadRecords();
  renderDashboard();
}

async function addQualityRating() {
  const email = getSignedInEmail();
  const score = clampNumber(Number(elements.qualityScoreInput.value), 1, 5);
  const note = elements.qualityNoteInput.value.trim();
  const date = elements.dateInput.value || getDateKey(new Date());

  const payload = {
    auth_user_id: currentUser.id,
    google_email: email,
    username: email,
    study_date: date,
    score,
    note: note || null,
    source: "dashboard"
  };

  const { error } = await supabase.from("study_quality_ratings").insert(payload);
  if (error) {
    showError(error.message);
    return;
  }

  elements.qualityNoteInput.value = "";
  await loadQualityRatings();
  renderDashboard();
}

async function clearOwnDashboardRecords() {
  if (!window.confirm("自分がWebから登録した記録だけを削除しますか？Discordの記録は残ります。")) {
    return;
  }

  const { error } = await supabase
    .from("study_entries")
    .delete()
    .eq("auth_user_id", currentUser.id)
    .eq("source", "dashboard");

  if (error) {
    showError(error.message);
    return;
  }

  await loadRecords();
  renderDashboard();
}

function exportRecords() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: records
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `study-records-${getDateKey(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importRecords(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const text = await file.text();
  const parsed = JSON.parse(text);
  const importedEntries = normalizeEntries(Array.isArray(parsed) ? parsed : parsed.entries || []);
  if (importedEntries.length === 0) {
    window.alert("インポートできる記録がありません。");
    return;
  }

  const email = getSignedInEmail();

  const payload = importedEntries.map((entry) => ({
    auth_user_id: currentUser.id,
    google_email: email,
    username: email,
    minutes: entry.minutes,
    study_date: entry.date,
    source: "dashboard-import"
  }));

  const { error } = await supabase.from("study_entries").insert(payload);
  if (error) {
    showError(error.message);
    return;
  }

  await loadRecords();
  renderDashboard();
  event.target.value = "";
}

function renderDashboard() {
  const today = getDateKey(new Date());
  const goal = getGoalForDate(today, settings.weeklyGoalMinutes);
  const todayTotal = sumForDate(today);
  const weekTrend = buildTrend(today, 7);
  const prevWeekTrend = buildTrend(addDays(today, -7), 7);
  const weekTotal = sum(weekTrend.map((item) => item.minutes));
  const previousWeekTotal = sum(prevWeekTrend.map((item) => item.minutes));
  const allTimeTotal = sum(records.map((item) => item.minutes));
  const percent = Math.min(Math.round((todayTotal / goal) * 100), 999);
  const remaining = Math.max(goal - todayTotal, 0);
  const weekChange = calculateChangePercent(weekTotal, previousWeekTotal);
  const outcomeTrend = buildOutcomeTrend(today, 14);

  elements.todayTotal.textContent = formatMinutes(todayTotal);
  elements.todayProgress.textContent = `目標 ${formatMinutes(goal)} / ${percent}%`;
  elements.weekTotal.textContent = formatMinutes(weekTotal);
  elements.weekAverage.textContent = `平均 ${formatMinutes(Math.round(weekTotal / 7))}`;
  elements.streakDays.textContent = `${calculateStreak(today)}日`;
  elements.entryCount.textContent = `${records.length}件`;
  elements.allTimeTotal.textContent = `合計 ${formatMinutes(allTimeTotal)}`;
  elements.goalRing.style.setProperty("--percent", Math.min(percent, 100));
  elements.goalPercent.textContent = `${percent}%`;
  elements.goalCopy.textContent = remaining === 0 ? "今日の目標を達成済み" : `目標まで ${formatMinutes(remaining)}`;
  elements.weekChangeValue.textContent = `${weekChange >= 0 ? "+" : ""}${weekChange}%`;
  elements.weekChangeDetail.textContent =
    previousWeekTotal === 0
      ? "先週の記録がないため、今週の合計を表示しています"
      : weekChange >= 0
        ? `先週より勉強時間が${Math.abs(weekChange)}%向上しています`
        : `先週より勉強時間が${Math.abs(weekChange)}%減少しています`;

  renderGrassGraph();
  renderRanking();
  renderRecordsTable();
  renderWeeklyGoalSummary();
  renderCharts({ trend: weekTrend, outcomeTrend });
}

function renderGrassGraph() {
  const today = getDateKey(new Date());
  const days = 371;
  const trend = buildTrend(today, days);
  const max = Math.max(...trend.map((item) => item.minutes), 1);
  elements.grassGrid.innerHTML = "";

  for (const item of trend) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "grass-cell";
    cell.dataset.level = getGrassLevel(item.minutes, max);
    cell.dataset.date = item.date;
    cell.dataset.minutes = String(item.minutes);
    cell.title = `${item.date}: ${formatMinutes(item.minutes)}`;
    cell.setAttribute("aria-label", cell.title);
    elements.grassGrid.append(cell);
  }
}

function renderRanking() {
  const totals = new Map();
  for (const record of records) {
    const username = record.googleEmail || record.username;
    totals.set(username, (totals.get(username) || 0) + record.minutes);
  }

  const ranking = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  elements.rankingList.innerHTML = "";

  if (ranking.length === 0) {
    const row = document.createElement("li");
    row.innerHTML = "<b>記録なし</b><span>0分</span>";
    elements.rankingList.append(row);
    return;
  }

  ranking.forEach(([username, minutes], index) => {
    const row = document.createElement("li");
    row.innerHTML = `<b>${index + 1}. ${escapeHtml(username)}</b><span>${formatMinutes(minutes)}</span>`;
    elements.rankingList.append(row);
  });
}

function renderRecordsTable() {
  elements.recordsTable.innerHTML = "";

  if (records.length === 0) {
    elements.recordsTable.append(elements.emptyRowTemplate.content.cloneNode(true));
    return;
  }

  const sorted = [...records].sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
  for (const record of sorted) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(record.date)}</td>
      <td>${escapeHtml(record.googleEmail || record.username)}</td>
      <td>${formatMinutes(record.minutes)}</td>
      <td>${escapeHtml(record.source || "dashboard")}</td>
    `;
    elements.recordsTable.append(row);
  }
}

function renderCharts({ trend, outcomeTrend }) {
  chartState = {
    trend,
    outcomeTrend,
    range: Number(elements.chartRange.value || 14),
    donutSegments: trend.map((item, index) => ({ ...item, index }))
  };
  renderTrendChart(trend);
  renderOutcomeChart(outcomeTrend);
  renderDistributionChart(trend);
}

function renderTrendChart(trend) {
  const canvas = elements.chart;
  const context = prepareCanvas(canvas);
  const { width, height } = getCanvasMetrics(canvas);
  const padding = { top: 18, right: 18, bottom: 34, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(...trend.map((item) => item.minutes), getGoalForDate(getDateKey(new Date()), settings.weeklyGoalMinutes), 1);

  clearCanvas(context, width, height);
  drawGrid(context, width, height, padding, plotHeight, "#dbe3dd");

  const goalY = padding.top + plotHeight - (getGoalForDate(getDateKey(new Date()), settings.weeklyGoalMinutes) / max) * plotHeight;
  context.strokeStyle = "#c7841d";
  context.setLineDash([6, 6]);
  context.beginPath();
  context.moveTo(padding.left, goalY);
  context.lineTo(width - padding.right, goalY);
  context.stroke();
  context.setLineDash([]);

  const barGap = 5;
  const step = plotWidth / trend.length;
  const barWidth = Math.max(4, step - barGap);
  trend.forEach((item, index) => {
    const x = padding.left + index * step + barGap / 2;
    const barHeight = (item.minutes / max) * plotHeight;
    const y = padding.top + plotHeight - barHeight;
    context.fillStyle = item.minutes >= getGoalForDate(item.date, settings.weeklyGoalMinutes) ? "#2f8f63" : "#3366cc";
    context.fillRect(x, y, barWidth, Math.max(barHeight, 2));
    if (trend.length <= 14 || index === 0 || index === trend.length - 1) {
      context.fillStyle = "#66736c";
      context.font = "12px system-ui, sans-serif";
      context.fillText(item.date.slice(5), x, height - 10);
    }
  });

  context.fillStyle = "#66736c";
  context.font = "12px system-ui, sans-serif";
  context.fillText(`${max}分`, 8, padding.top + 4);
  context.fillText("0分", 14, padding.top + plotHeight);
}

function renderOutcomeChart(outcomeTrend) {
  const canvas = elements.outcomeChart;
  const context = prepareCanvas(canvas);
  const { width, height } = getCanvasMetrics(canvas);
  const padding = { top: 18, right: 18, bottom: 34, left: 52 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(...outcomeTrend.map((item) => item.outcomeIndex), 1);

  clearCanvas(context, width, height);
  drawGrid(context, width, height, padding, plotHeight, "#dbe3dd");

  const pointStep = plotWidth / Math.max(outcomeTrend.length - 1, 1);
  context.strokeStyle = "#8e44ad";
  context.fillStyle = "#8e44ad";
  context.lineWidth = 3;
  context.beginPath();
  outcomeTrend.forEach((item, index) => {
    const x = padding.left + index * pointStep;
    const y = padding.top + plotHeight - (item.outcomeIndex / max) * plotHeight;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.stroke();

  outcomeTrend.forEach((item, index) => {
    const x = padding.left + index * pointStep;
    const y = padding.top + plotHeight - (item.outcomeIndex / max) * plotHeight;
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fill();
    if (outcomeTrend.length <= 14 || index === 0 || index === outcomeTrend.length - 1) {
      context.fillStyle = "#66736c";
      context.font = "12px system-ui, sans-serif";
      context.fillText(item.date.slice(5), x - 12, height - 10);
      context.fillStyle = "#8e44ad";
    }
  });

  context.fillStyle = "#66736c";
  context.font = "12px system-ui, sans-serif";
  context.fillText(`${max} / 成果指数`, 8, padding.top + 4);
  context.fillText("0", 14, padding.top + plotHeight);
}

function renderDistributionChart(trend) {
  const canvas = elements.distributionChart;
  const context = prepareCanvas(canvas);
  const { width, height } = getCanvasMetrics(canvas);
  const centerX = width * 0.34;
  const centerY = height * 0.5;
  const outerRadius = Math.min(width, height) * 0.28;
  const innerRadius = outerRadius * 0.62;
  const total = sum(trend.map((item) => item.minutes));

  clearCanvas(context, width, height);

  if (total <= 0) {
    context.fillStyle = "#66736c";
    context.font = "14px system-ui, sans-serif";
    context.fillText("記録はまだありません。", width * 0.34, height * 0.52);
    return;
  }

  let startAngle = -Math.PI / 2;
  trend.forEach((item, index) => {
    const slice = (item.minutes / total) * Math.PI * 2;
    const endAngle = startAngle + slice;
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.arc(centerX, centerY, outerRadius, startAngle, endAngle);
    context.closePath();
    context.fillStyle = donutColor(index);
    context.fill();
    startAngle = endAngle;
  });

  context.beginPath();
  context.fillStyle = "#ffffff";
  context.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#17201c";
  context.font = "20px system-ui, sans-serif";
  context.fillText(`${total}分`, centerX + outerRadius + 28, centerY - 10);
  context.font = "12px system-ui, sans-serif";
  context.fillStyle = "#66736c";
  context.fillText("直近期間の配分", centerX + outerRadius + 28, centerY + 14);
}

function renderWeeklyGoalSummary() {
  if (!elements.weeklyGoalSummary) {
    return;
  }

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  elements.weeklyGoalSummary.innerHTML = weekdays
    .map((label, weekday) => {
      const minutes = settings.weeklyGoalMinutes[String(weekday)] ?? 120;
      return `<div class="weekly-goal-item"><span>${label}</span><strong>${formatMinutes(minutes)}</strong></div>`;
    })
    .join("");
}

function buildOutcomeTrend(endDateKey, days) {
  const entriesByDate = new Map();
  const ratingsByDate = new Map();

  for (const record of records) {
    entriesByDate.set(record.date, (entriesByDate.get(record.date) || 0) + record.minutes);
  }

  for (const rating of qualityRatings) {
    const current = ratingsByDate.get(rating.date) || [];
    current.push(rating.score);
    ratingsByDate.set(rating.date, current);
  }

  return getDateRange(endDateKey, days).map((date) => {
    const minutes = entriesByDate.get(date) || 0;
    const qualitySamples = ratingsByDate.get(date) || [];
    const qualityAverage = qualitySamples.length > 0 ? sum(qualitySamples) / qualitySamples.length : null;
    const outcomeIndex = Math.round(minutes * (0.5 + ((qualityAverage || 0) / 10)));

    return {
      date,
      minutes,
      qualityAverage,
      outcomeIndex
    };
  });
}

function getDateRange(endDateKey, days) {
  return Array.from({ length: days }, (_, index) => addDays(endDateKey, index - days + 1));
}

function getGoalForDate(dateKey, weeklyGoals) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return normalizeWeeklyGoals(weeklyGoals)[String(weekday)];
}

function normalizeWeeklyGoals(source = null, fallback = 120) {
  const base = createDefaultWeeklyGoals(fallback);
  if (!source || typeof source !== "object") {
    return base;
  }

  return Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [
      String(weekday),
      clampNumber(source[String(weekday)] ?? source[weekday] ?? base[String(weekday)], 1, 1440)
    ])
  );
}

function createDefaultWeeklyGoals(minutes) {
  const clamped = clampNumber(minutes, 1, 1440);
  return {
    0: clamped,
    1: clamped,
    2: clamped,
    3: clamped,
    4: clamped,
    5: clamped,
    6: clamped
  };
}

function calculateChangePercent(current, previous) {
  if (previous <= 0) {
    return current > 0 ? 100 : 0;
  }

  return Math.round(((current - previous) / previous) * 100);
}

function getSignedInEmail() {
  return String(currentUser?.email || currentUser?.user_metadata?.email || "").trim().toLowerCase();
}

function prepareCanvas(canvas) {
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

function getCanvasMetrics(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  return { width: rect.width, height: rect.height, ratio };
}

function clearCanvas(context, width, height) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
}

function drawGrid(context, width, height, padding, plotHeight, color) {
  context.strokeStyle = color;
  context.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (plotHeight / 4) * i;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
  }
}

function handleTrendChartHover(event) {
  const hit = getChartHit(event, chartState.trend, elements.chart);
  if (!hit) {
    hideChartTooltip();
    return;
  }

  showChartTooltip(event, [
    hit.date,
    `${formatMinutes(hit.minutes)}`,
    `目標: ${formatMinutes(getGoalForDate(hit.date, settings.weeklyGoalMinutes))}`
  ]);
}

function handleOutcomeChartHover(event) {
  const hit = getChartHit(event, chartState.outcomeTrend, elements.outcomeChart, "outcomeIndex");
  if (!hit) {
    hideChartTooltip();
    return;
  }

  showChartTooltip(event, [
    hit.date,
    `成果指数: ${hit.outcomeIndex}`,
    `勉強時間: ${formatMinutes(hit.minutes)}`,
    `質平均: ${formatQuality(hit.qualityAverage)}`
  ]);
}

function handleDistributionChartHover(event) {
  const segments = chartState.donutSegments;
  if (!segments.length) {
    hideChartTooltip();
    return;
  }

  const canvas = elements.distributionChart;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left - rect.width * 0.34;
  const y = event.clientY - rect.top - rect.height * 0.5;
  const angle = Math.atan2(y, x);
  const distance = Math.hypot(x, y);
  const outerRadius = Math.min(rect.width, rect.height) * 0.28;
  const innerRadius = outerRadius * 0.62;

  if (distance < innerRadius || distance > outerRadius) {
    hideChartTooltip();
    return;
  }

  let startAngle = -Math.PI / 2;
  for (const segment of segments) {
    const slice = (segment.minutes / sum(segments.map((item) => item.minutes))) * Math.PI * 2;
    const endAngle = startAngle + slice;
    if (isAngleWithin(angle, startAngle, endAngle)) {
      showChartTooltip(event, [segment.date, formatMinutes(segment.minutes)]);
      return;
    }
    startAngle = endAngle;
  }

  hideChartTooltip();
}

function handleGrassHover(event) {
  const cell = event.target.closest(".grass-cell");
  if (!cell) {
    hideChartTooltip();
    return;
  }

  showChartTooltip(event, [cell.dataset.date || "", formatMinutes(Number(cell.dataset.minutes || 0))]);
}

function showChartTooltip(event, lines) {
  if (!elements.chartTooltip) {
    return;
  }

  elements.chartTooltip.innerHTML = lines.filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  elements.chartTooltip.hidden = false;
  elements.chartTooltip.style.left = `${event.clientX + 14}px`;
  elements.chartTooltip.style.top = `${event.clientY + 14}px`;
}

function hideChartTooltip() {
  if (elements.chartTooltip) {
    elements.chartTooltip.hidden = true;
  }
}

function getChartHit(event, points, canvas, valueKey = "minutes") {
  if (!points.length) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();
  const padding = valueKey === "outcomeIndex" ? { left: 52, right: 18, top: 18, bottom: 34 } : { left: 46, right: 18, top: 18, bottom: 34 };
  const plotWidth = rect.width - padding.left - padding.right;
  const step = plotWidth / Math.max(points.length - 1, 1);
  const x = event.clientX - rect.left;
  const index = Math.round((x - padding.left) / Math.max(step, 1));
  if (index < 0 || index >= points.length) {
    return null;
  }

  const point = points[index];
  const pointX = padding.left + index * step;
  const pointY = valueKey === "outcomeIndex"
    ? padding.top + (rect.height - padding.top - padding.bottom) - (point[valueKey] / Math.max(...points.map((item) => item[valueKey]), 1)) * (rect.height - padding.top - padding.bottom)
    : null;

  if (valueKey === "outcomeIndex") {
    const distance = Math.hypot(x - pointX, event.clientY - rect.top - pointY);
    if (distance > 14) {
      return null;
    }
  }

  return point;
}

function isAngleWithin(angle, start, end) {
  const normalized = angle < -Math.PI / 2 ? angle + Math.PI * 2 : angle;
  const normalizedStart = start < -Math.PI / 2 ? start + Math.PI * 2 : start;
  const normalizedEnd = end < -Math.PI / 2 ? end + Math.PI * 2 : end;
  return normalized >= normalizedStart && normalized <= normalizedEnd;
}

function donutColor(index) {
  const palette = ["#2f8f63", "#3366cc", "#8e44ad", "#c7841d", "#1abc9c", "#b44747", "#5d6d7e"];
  return palette[index % palette.length];
}

function formatQuality(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "未評価";
  }

  return `${Math.round(value * 10) / 10} / 5`;
}

function normalizeEntries(entries) {
  return entries
    .map((entry) => ({
      id: entry.id || crypto.randomUUID(),
      authUserId: entry.auth_user_id || entry.authUserId || null,
      discordUserId: entry.discord_user_id || entry.discordUserId || null,
      googleEmail: entry.google_email || entry.googleEmail || entry.username || entry.user || "",
      username: entry.username || entry.google_email || entry.googleEmail || entry.user || "Guest",
      minutes: clampNumber(Number(entry.minutes), 1, 1440),
      date: entry.study_date || entry.date || getDateKey(new Date(entry.created_at || entry.createdAt || Date.now())),
      source: entry.source || "import",
      createdAt: entry.created_at || entry.createdAt || new Date().toISOString(),
      qualityScore: entry.quality_score || entry.qualityScore || null
    }))
    .filter((entry) => entry.date && Number.isFinite(entry.minutes));
}

function normalizeQualityRatings(entries) {
  return entries
    .map((entry) => ({
      id: entry.id || crypto.randomUUID(),
      authUserId: entry.auth_user_id || entry.authUserId || null,
      discordUserId: entry.discord_user_id || entry.discordUserId || null,
      googleEmail: entry.google_email || entry.googleEmail || entry.username || "",
      username: entry.username || entry.google_email || entry.googleEmail || "Guest",
      date: entry.study_date || entry.date || getDateKey(new Date(entry.created_at || entry.createdAt || Date.now())),
      score: clampNumber(Number(entry.score), 1, 5),
      note: entry.note || "",
      source: entry.source || "import",
      createdAt: entry.created_at || entry.createdAt || new Date().toISOString()
    }))
    .filter((entry) => entry.date && Number.isFinite(entry.score));
}

function buildTrend(endDateKey, days) {
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(endDateKey, index - days + 1);
    return { date, minutes: sumForDate(date) };
  });
}

function sumForDate(date) {
  return sum(records.filter((record) => record.date === date).map((record) => record.minutes));
}

function calculateStreak(today) {
  let streak = 0;
  let current = today;
  while (sumForDate(current) > 0) {
    streak += 1;
    current = addDays(current, -1);
  }
  return streak;
}

function getGrassLevel(minutes, max) {
  if (minutes <= 0) {
    return 0;
  }
  const ratio = minutes / max;
  if (ratio <= 0.25) {
    return 1;
  }
  if (ratio <= 0.5) {
    return 2;
  }
  if (ratio <= 0.75) {
    return 3;
  }
  return 4;
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function getDateKey(date) {
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}

function formatMinutes(minutes) {
  return `${minutes}分`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showError(message) {
  window.alert(`エラー: ${message}`);
}
