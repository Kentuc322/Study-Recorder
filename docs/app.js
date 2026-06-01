const STORAGE_KEY = "study-recorder-dashboard:v1";
const SETTINGS_KEY = "study-recorder-settings:v1";

const elements = {
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
  clearButton: document.querySelector("#clear-button"),
  exportButton: document.querySelector("#export-button"),
  importInput: document.querySelector("#import-input"),
  emptyRowTemplate: document.querySelector("#empty-row-template")
};

let records = loadRecords();
let settings = loadSettings();

initialize();

function initialize() {
  const today = getDateKey(new Date());
  elements.todayLabel.textContent = today;
  elements.dateInput.value = today;
  elements.goalInput.value = settings.dailyGoalMinutes;
  elements.userInput.value = settings.lastUser || "";

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  elements.recordForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addRecord();
  });

  elements.goalInput.addEventListener("change", () => {
    settings.dailyGoalMinutes = clampNumber(Number(elements.goalInput.value), 1, 1440);
    saveSettings();
    render();
  });

  elements.chartRange.addEventListener("change", render);
  elements.clearButton.addEventListener("click", clearRecords);
  elements.exportButton.addEventListener("click", exportRecords);
  elements.importInput.addEventListener("change", importRecords);

  render();
}

function setView(view) {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === view);
  });
}

function addRecord() {
  const username = elements.userInput.value.trim() || "Guest";
  const minutes = clampNumber(Number(elements.minutesInput.value), 1, 1440);
  const date = elements.dateInput.value || getDateKey(new Date());

  records.push({
    id: crypto.randomUUID(),
    username,
    minutes,
    date,
    source: "dashboard",
    createdAt: new Date().toISOString()
  });

  settings.lastUser = username;
  saveRecords();
  saveSettings();
  elements.minutesInput.value = "";
  elements.minutesInput.focus();
  render();
}

function clearRecords() {
  if (!window.confirm("すべての記録を削除しますか？")) {
    return;
  }
  records = [];
  saveRecords();
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
  const importedEntries = Array.isArray(parsed) ? parsed : parsed.entries;
  if (!Array.isArray(importedEntries)) {
    window.alert("entries 配列を含む JSON を選択してください。");
    return;
  }

  records = normalizeEntries(importedEntries);
  saveRecords();
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

  renderRanking();
  renderRecordsTable();
  renderChart();
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

function loadRecords() {
  try {
    return normalizeEntries(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function loadSettings() {
  try {
    return {
      dailyGoalMinutes: 120,
      lastUser: "",
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
    };
  } catch {
    return { dailyGoalMinutes: 120, lastUser: "" };
  }
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function normalizeEntries(entries) {
  return entries
    .map((entry) => ({
      id: entry.id || crypto.randomUUID(),
      username: entry.username || entry.user || "Guest",
      minutes: clampNumber(Number(entry.minutes), 1, 1440),
      date: entry.date || getDateKey(new Date(entry.createdAt || Date.now())),
      source: entry.source || "import",
      createdAt: entry.createdAt || new Date().toISOString()
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

window.addEventListener("resize", renderChart);
