import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_CONFIG } from "./config.js";

const settings = {
  dailyGoalMinutes: SUPABASE_CONFIG.dailyGoalMinutes || 120,
  lastUser: ""
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
  goalInput: document.querySelector("#goal-input"),
  todayTotal: document.querySelector("#today-total"),
  todayProgress: document.querySelector("#today-progress"),
  weekTotal: document.querySelector("#week-total"),
  weekAverage: document.querySelector("#week-average"),
  streakDays: document.querySelector("#streak-days"),
  entryCount: document.querySelector("#entry-count"),
  allTimeTotal: document.querySelector("#all-time-total"),
  goalRing: document.querySelector("#goal-ring"),
  goalPercent: document.querySelector("#goal-percent"),
  goalCopy: document.querySelector("#goal-copy"),
  rankingList: document.querySelector("#ranking-list"),
  recordsTable: document.querySelector("#records-table"),
  chart: document.querySelector("#trend-chart"),
  chartRange: document.querySelector("#chart-range"),
  grassGrid: document.querySelector("#grass-grid"),
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
let currentUser = null;

initialize();

async function initialize() {
  const today = getDateKey(new Date());
  elements.todayLabel.textContent = today;
  elements.dateInput.value = today;
  elements.goalInput.value = settings.dailyGoalMinutes;
  elements.setupWarning.hidden = hasSupabaseConfig;
  elements.loginButton.disabled = !hasSupabaseConfig;

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

  elements.recordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await addRecord();
  });

  elements.goalInput.addEventListener("change", async () => {
    settings.dailyGoalMinutes = clampNumber(Number(elements.goalInput.value), 1, 1440);
    await saveUserProfile();
    render();
  });

  elements.chartRange.addEventListener("change", render);
  elements.clearButton.addEventListener("click", clearOwnDashboardRecords);
  elements.exportButton.addEventListener("click", exportRecords);
  elements.importInput.addEventListener("change", importRecords);
  window.addEventListener("resize", renderChart);
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
  render();
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
  const displayName = getDisplayName();
  elements.signedInUser.textContent = displayName;
  elements.userInput.value = settings.lastUser || displayName;
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
    .select("id, auth_user_id, discord_user_id, username, minutes, study_date, source, created_at")
    .order("study_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    showError(error.message);
    return;
  }

  records = normalizeEntries(data);
}

async function loadUserProfile() {
  const { data, error } = await supabase
    .from("study_user_profiles")
    .select("username, goal_minutes")
    .eq("auth_user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    showError(error.message);
    return;
  }

  settings.lastUser = data?.username || getDisplayName();
  settings.dailyGoalMinutes = data?.goal_minutes || SUPABASE_CONFIG.dailyGoalMinutes || 120;
  elements.goalInput.value = settings.dailyGoalMinutes;
  elements.userInput.value = settings.lastUser;
}

async function saveUserProfile() {
  if (!currentUser) {
    return;
  }

  const payload = {
    auth_user_id: currentUser.id,
    username: elements.userInput.value.trim() || getDisplayName(),
    goal_minutes: settings.dailyGoalMinutes,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from("study_user_profiles")
    .upsert(payload, { onConflict: "auth_user_id" });

  if (error) {
    showError(error.message);
  }
}

async function addRecord() {
  const username = elements.userInput.value.trim() || getDisplayName();
  const minutes = clampNumber(Number(elements.minutesInput.value), 1, 1440);
  const date = elements.dateInput.value || getDateKey(new Date());

  const payload = {
    auth_user_id: currentUser.id,
    username,
    minutes,
    study_date: date,
    source: "dashboard"
  };

  const { error } = await supabase.from("study_entries").insert(payload);
  if (error) {
    showError(error.message);
    return;
  }

  settings.lastUser = username;
  await saveUserProfile();
  elements.minutesInput.value = "";
  elements.minutesInput.focus();
  await loadRecords();
  render();
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
  render();
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

  const payload = importedEntries.map((entry) => ({
    auth_user_id: currentUser.id,
    username: entry.username || getDisplayName(),
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
  render();
  event.target.value = "";
}

function render() {
  const today = getDateKey(new Date());
  const goal = settings.dailyGoalMinutes;
  const todayTotal = sumForDate(today);
  const weekTrend = buildTrend(today, 7);
  const weekTotal = sum(weekTrend.map((item) => item.minutes));
  const allTimeTotal = sum(records.map((item) => item.minutes));
  const percent = Math.min(Math.round((todayTotal / goal) * 100), 999);
  const remaining = Math.max(goal - todayTotal, 0);

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

  renderGrassGraph();
  renderRanking();
  renderRecordsTable();
  renderChart();
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
    cell.title = `${item.date}: ${formatMinutes(item.minutes)}`;
    cell.setAttribute("aria-label", cell.title);
    elements.grassGrid.append(cell);
  }
}

function renderRanking() {
  const totals = new Map();
  for (const record of records) {
    totals.set(record.username, (totals.get(record.username) || 0) + record.minutes);
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
      <td>${escapeHtml(record.username)}</td>
      <td>${formatMinutes(record.minutes)}</td>
      <td>${escapeHtml(record.source || "dashboard")}</td>
    `;
    elements.recordsTable.append(row);
  }
}

function renderChart() {
  const range = Number(elements.chartRange.value || 14);
  const trend = buildTrend(getDateKey(new Date()), range);
  const canvas = elements.chart;
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  context.scale(ratio, ratio);

  const width = rect.width;
  const height = rect.height;
  const padding = { top: 18, right: 18, bottom: 34, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(...trend.map((item) => item.minutes), settings.dailyGoalMinutes, 1);

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#dbe3dd";
  context.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (plotHeight / 4) * i;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
  }

  const goalY = padding.top + plotHeight - (settings.dailyGoalMinutes / max) * plotHeight;
  context.strokeStyle = "#c7841d";
  context.setLineDash([6, 6]);
  context.beginPath();
  context.moveTo(padding.left, goalY);
  context.lineTo(width - padding.right, goalY);
  context.stroke();
  context.setLineDash([]);

  const barGap = 5;
  const barWidth = Math.max(4, plotWidth / trend.length - barGap);
  trend.forEach((item, index) => {
    const x = padding.left + index * (plotWidth / trend.length) + barGap / 2;
    const barHeight = (item.minutes / max) * plotHeight;
    const y = padding.top + plotHeight - barHeight;
    context.fillStyle = item.minutes >= settings.dailyGoalMinutes ? "#2f8f63" : "#3366cc";
    context.fillRect(x, y, barWidth, barHeight || 2);
  });

  context.fillStyle = "#66736c";
  context.font = "12px system-ui, sans-serif";
  context.fillText(`${max}分`, 8, padding.top + 4);
  context.fillText("0分", 14, padding.top + plotHeight);
  context.fillText(trend[0]?.date.slice(5) || "", padding.left, height - 10);
  context.fillText(trend.at(-1)?.date.slice(5) || "", width - padding.right - 36, height - 10);
}

function normalizeEntries(entries) {
  return entries
    .map((entry) => ({
      id: entry.id || crypto.randomUUID(),
      authUserId: entry.auth_user_id || entry.authUserId || null,
      discordUserId: entry.discord_user_id || entry.discordUserId || null,
      username: entry.username || entry.user || "Guest",
      minutes: clampNumber(Number(entry.minutes), 1, 1440),
      date: entry.study_date || entry.date || getDateKey(new Date(entry.created_at || entry.createdAt || Date.now())),
      source: entry.source || "import",
      createdAt: entry.created_at || entry.createdAt || new Date().toISOString()
    }))
    .filter((entry) => entry.date && Number.isFinite(entry.minutes));
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

function getDisplayName() {
  return (
    currentUser?.user_metadata?.full_name ||
    currentUser?.user_metadata?.name ||
    currentUser?.email ||
    "Guest"
  );
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
