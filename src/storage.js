import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { addDays, getDateRange } from "./time.js";

const INITIAL_DATA = {
  version: 1,
  users: {},
  entries: []
};

export class StudyStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = structuredClone(INITIAL_DATA);
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.data = {
        version: 1,
        users: parsed.users || {},
        entries: Array.isArray(parsed.entries) ? parsed.entries : []
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      await this.save();
    }
  }

  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.filePath);
  }

  async addEntry({ userId, username, minutes, dateKey, channelId, messageId, source }) {
    const entry = {
      id: randomUUID(),
      userId,
      username,
      minutes,
      date: dateKey,
      channelId,
      messageId,
      source,
      createdAt: new Date().toISOString()
    };

    this.data.entries.push(entry);
    this.ensureUser(userId, username);
    await this.save();
    return entry;
  }

  async setGoal(userId, username, goalMinutes) {
    const user = this.ensureUser(userId, username);
    user.goalMinutes = goalMinutes;
    user.updatedAt = new Date().toISOString();
    await this.save();
    return user;
  }

  ensureUser(userId, username) {
    if (!this.data.users[userId]) {
      this.data.users[userId] = {
        username,
        goalMinutes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    } else if (username && this.data.users[userId].username !== username) {
      this.data.users[userId].username = username;
      this.data.users[userId].updatedAt = new Date().toISOString();
    }

    return this.data.users[userId];
  }

  getUserGoal(userId, defaultGoalMinutes) {
    return this.data.users[userId]?.goalMinutes || defaultGoalMinutes;
  }

  getDayTotal(dateKey, userId = null) {
    return this.data.entries
      .filter((entry) => entry.date === dateKey && (!userId || entry.userId === userId))
      .reduce((sum, entry) => sum + entry.minutes, 0);
  }

  getUserDayTotal(userId, dateKey) {
    return this.getDayTotal(dateKey, userId);
  }

  getTrend(endDateKey, days, userId = null) {
    return getDateRange(endDateKey, days).map((dateKey) => ({
      date: dateKey,
      minutes: this.getDayTotal(dateKey, userId)
    }));
  }

  getUserTrend(userId, endDateKey, days) {
    return this.getTrend(endDateKey, days, userId);
  }

  getRanking(endDateKey, days) {
    const startDateKey = addDays(endDateKey, -days + 1);
    const totals = new Map();

    for (const entry of this.data.entries) {
      if (entry.date < startDateKey || entry.date > endDateKey) {
        continue;
      }

      const current = totals.get(entry.userId) || {
        userId: entry.userId,
        username: entry.username,
        minutes: 0
      };
      current.minutes += entry.minutes;
      current.username = entry.username || current.username;
      totals.set(entry.userId, current);
    }

    return [...totals.values()].sort((a, b) => b.minutes - a.minutes);
  }

  getActiveUsersForDate(dateKey) {
    const userIds = new Set(
      this.data.entries.filter((entry) => entry.date === dateKey).map((entry) => entry.userId)
    );

    return [...userIds].map((userId) => ({
      userId,
      username: this.data.users[userId]?.username || userId,
      goalMinutes: this.data.users[userId]?.goalMinutes
    }));
  }
}
