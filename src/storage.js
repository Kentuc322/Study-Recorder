import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { addDays, getDateRange } from "./time.js";

const INITIAL_DATA = {
  version: 1,
  users: {},
  entries: []
};

export function createStudyStore(config) {
  if (config.storageDriver === "supabase") {
    return new SupabaseStudyStore({
      url: config.supabaseUrl,
      serviceRoleKey: config.supabaseServiceRoleKey
    });
  }

  return new FileStudyStore(config.dataFile);
}

export class FileStudyStore {
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

  async getUserGoal(userId, defaultGoalMinutes) {
    return this.data.users[userId]?.goalMinutes || defaultGoalMinutes;
  }

  async getDayTotal(dateKey, userId = null) {
    return this.data.entries
      .filter((entry) => entry.date === dateKey && (!userId || entry.userId === userId))
      .reduce((sum, entry) => sum + entry.minutes, 0);
  }

  async getUserDayTotal(userId, dateKey) {
    return this.getDayTotal(dateKey, userId);
  }

  async getTrend(endDateKey, days, userId = null) {
    return getDateRange(endDateKey, days).map((dateKey) => ({
      date: dateKey,
      minutes: this.data.entries
        .filter((entry) => entry.date === dateKey && (!userId || entry.userId === userId))
        .reduce((sum, entry) => sum + entry.minutes, 0)
    }));
  }

  async getUserTrend(userId, endDateKey, days) {
    return this.getTrend(endDateKey, days, userId);
  }

  async getRanking(endDateKey, days) {
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
}

export class SupabaseStudyStore {
  constructor({ url, serviceRoleKey }) {
    if (!url || !serviceRoleKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase storage.");
    }

    this.client = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  async load() {
    const { error } = await this.client.from("study_entries").select("id").limit(1);
    if (error) {
      throw error;
    }
  }

  async addEntry({ userId, username, minutes, dateKey, channelId, messageId, source }) {
    const payload = {
      discord_user_id: userId,
      username,
      minutes,
      study_date: dateKey,
      channel_id: channelId,
      message_id: messageId,
      source
    };

    const { data, error } = await this.client.from("study_entries").insert(payload).select().single();
    if (error) {
      throw error;
    }

    return fromSupabaseEntry(data);
  }

  async setGoal(userId, username, goalMinutes) {
    const payload = {
      discord_user_id: userId,
      username,
      goal_minutes: goalMinutes,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await this.client
      .from("study_user_profiles")
      .upsert(payload, { onConflict: "discord_user_id" })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async getUserGoal(userId, defaultGoalMinutes) {
    const { data, error } = await this.client
      .from("study_user_profiles")
      .select("goal_minutes")
      .eq("discord_user_id", userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data?.goal_minutes || defaultGoalMinutes;
  }

  async getDayTotal(dateKey, userId = null) {
    let query = this.client.from("study_entries").select("minutes").eq("study_date", dateKey);
    if (userId) {
      query = query.eq("discord_user_id", userId);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return sumMinutes(data);
  }

  async getUserDayTotal(userId, dateKey) {
    return this.getDayTotal(dateKey, userId);
  }

  async getTrend(endDateKey, days, userId = null) {
    const startDateKey = addDays(endDateKey, -days + 1);
    let query = this.client
      .from("study_entries")
      .select("study_date, minutes")
      .gte("study_date", startDateKey)
      .lte("study_date", endDateKey);

    if (userId) {
      query = query.eq("discord_user_id", userId);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const totals = new Map();
    for (const entry of data) {
      totals.set(entry.study_date, (totals.get(entry.study_date) || 0) + entry.minutes);
    }

    return getDateRange(endDateKey, days).map((dateKey) => ({
      date: dateKey,
      minutes: totals.get(dateKey) || 0
    }));
  }

  async getUserTrend(userId, endDateKey, days) {
    return this.getTrend(endDateKey, days, userId);
  }

  async getRanking(endDateKey, days) {
    const startDateKey = addDays(endDateKey, -days + 1);
    const { data, error } = await this.client
      .from("study_entries")
      .select("auth_user_id, discord_user_id, username, minutes")
      .gte("study_date", startDateKey)
      .lte("study_date", endDateKey);

    if (error) {
      throw error;
    }

    const totals = new Map();
    for (const entry of data) {
      const userId = entry.auth_user_id || entry.discord_user_id || entry.username;
      const current = totals.get(userId) || {
        userId,
        username: entry.username,
        minutes: 0
      };
      current.minutes += entry.minutes;
      current.username = entry.username || current.username;
      totals.set(userId, current);
    }

    return [...totals.values()].sort((a, b) => b.minutes - a.minutes);
  }
}

function fromSupabaseEntry(entry) {
  return {
    id: entry.id,
    userId: entry.discord_user_id || entry.auth_user_id,
    username: entry.username,
    minutes: entry.minutes,
    date: entry.study_date,
    channelId: entry.channel_id,
    messageId: entry.message_id,
    source: entry.source,
    createdAt: entry.created_at
  };
}

function sumMinutes(entries) {
  return entries.reduce((sum, entry) => sum + entry.minutes, 0);
}
