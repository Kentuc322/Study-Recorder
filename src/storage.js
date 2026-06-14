import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { addDays, getDateRange } from "./time.js";

const INITIAL_DATA = {
  version: 2,
  users: {},
  entries: [],
  qualityRatings: []
};

export class AccountNotLinkedError extends Error {
  constructor(discordUserId) {
    super(`Discord user ${discordUserId} is not linked to a Google email.`);
    this.name = "AccountNotLinkedError";
    this.code = "ACCOUNT_NOT_LINKED";
  }
}

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
        version: 2,
        users: parsed.users || {},
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        qualityRatings: Array.isArray(parsed.qualityRatings) ? parsed.qualityRatings : []
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

  async linkDiscordAccount(userId, username, email) {
    const user = this.ensureUser(userId, username);
    user.googleEmail = normalizeEmail(email);
    user.updatedAt = new Date().toISOString();
    await this.save();
    return user;
  }

  async getLinkedAccount(userId) {
    return this.data.users[userId]?.googleEmail
      ? { googleEmail: this.data.users[userId].googleEmail, username: this.data.users[userId].username }
      : null;
  }

  async addEntry({ userId, username, email, minutes, dateKey, channelId, messageId, source }) {
    const googleEmail = normalizeEmail(email || this.data.users[userId]?.googleEmail);
    if (!googleEmail) {
      throw new AccountNotLinkedError(userId);
    }

    const entry = {
      id: randomUUID(),
      userId,
      googleEmail,
      username: googleEmail,
      minutes,
      date: dateKey,
      channelId,
      messageId,
      source,
      createdAt: new Date().toISOString()
    };

    this.data.entries.push(entry);
    this.ensureUser(userId, username).googleEmail = googleEmail;
    await this.save();
    return entry;
  }

  async addQualityRating({ userId, username, email, score, note, dateKey, source }) {
    const googleEmail = normalizeEmail(email || this.data.users[userId]?.googleEmail);
    if (!googleEmail) {
      throw new AccountNotLinkedError(userId);
    }

    const rating = {
      id: randomUUID(),
      userId,
      googleEmail,
      username: googleEmail,
      score,
      note,
      date: dateKey,
      source,
      createdAt: new Date().toISOString()
    };

    this.data.qualityRatings.push(rating);
    this.ensureUser(userId, username).googleEmail = googleEmail;
    await this.save();
    return rating;
  }

  async setWeeklyGoal(userId, username, weekday, goalMinutes) {
    const user = this.ensureUser(userId, username);
    user.weeklyGoalMinutes = normalizeWeeklyGoals(user.weeklyGoalMinutes);
    user.weeklyGoalMinutes[String(weekday)] = goalMinutes;
    user.updatedAt = new Date().toISOString();
    await this.save();
    return user;
  }

  ensureUser(userId, username) {
    if (!this.data.users[userId]) {
      this.data.users[userId] = {
        username,
        googleEmail: null,
        weeklyGoalMinutes: normalizeWeeklyGoals(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    } else if (username && this.data.users[userId].username !== username) {
      this.data.users[userId].username = username;
      this.data.users[userId].updatedAt = new Date().toISOString();
    }

    return this.data.users[userId];
  }

  async getUserGoal(userId, dateKey, defaultWeeklyGoals) {
    const goals = normalizeWeeklyGoals(this.data.users[userId]?.weeklyGoalMinutes, defaultWeeklyGoals);
    return getGoalForDate(dateKey, goals);
  }

  async getDayTotal(dateKey, userId = null) {
    const googleEmail = userId ? this.data.users[userId]?.googleEmail : null;
    return this.data.entries
      .filter((entry) => entry.date === dateKey && (!googleEmail || entry.googleEmail === googleEmail))
      .reduce((sum, entry) => sum + entry.minutes, 0);
  }

  async getUserDayTotal(userId, dateKey) {
    return this.getDayTotal(dateKey, userId);
  }

  async getTrend(endDateKey, days, userId = null) {
    const googleEmail = userId ? this.data.users[userId]?.googleEmail : null;
    return getDateRange(endDateKey, days).map((dateKey) => ({
      date: dateKey,
      minutes: this.data.entries
        .filter((entry) => entry.date === dateKey && (!googleEmail || entry.googleEmail === googleEmail))
        .reduce((sum, entry) => sum + entry.minutes, 0)
    }));
  }

  async getUserTrend(userId, endDateKey, days) {
    return this.getTrend(endDateKey, days, userId);
  }

  async getOutcomeTrend(endDateKey, days, userId = null) {
    const googleEmail = userId ? this.data.users[userId]?.googleEmail : null;
    return buildOutcomeTrend(
      endDateKey,
      days,
      this.data.entries.filter((entry) => !googleEmail || entry.googleEmail === googleEmail),
      this.data.qualityRatings.filter((rating) => !googleEmail || rating.googleEmail === googleEmail)
    );
  }

  async getRanking(endDateKey, days) {
    const startDateKey = addDays(endDateKey, -days + 1);
    const totals = new Map();

    for (const entry of this.data.entries) {
      if (entry.date < startDateKey || entry.date > endDateKey) {
        continue;
      }

      const current = totals.get(entry.googleEmail) || {
        userId: entry.googleEmail,
        username: entry.googleEmail,
        minutes: 0
      };
      current.minutes += entry.minutes;
      totals.set(entry.googleEmail, current);
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

  async linkDiscordAccount(userId, username, email) {
    const googleEmail = normalizeEmail(email);
    const profile = await this.getProfileByGoogleEmail(googleEmail);
    const payload = {
      auth_user_id: profile?.auth_user_id || null,
      discord_user_id: userId,
      google_email: googleEmail,
      username: googleEmail,
      weekly_goal_minutes: normalizeWeeklyGoals(profile?.weekly_goal_minutes),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await this.client
      .from("study_user_profiles")
      .upsert(payload, { onConflict: "google_email" })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async getLinkedAccount(userId) {
    const { data, error } = await this.client
      .from("study_user_profiles")
      .select("google_email, username")
      .eq("discord_user_id", userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data?.google_email ? { googleEmail: data.google_email, username: data.username } : null;
  }

  async addEntry({ userId, email, minutes, dateKey, channelId, messageId, source }) {
    const account = email
      ? { googleEmail: normalizeEmail(email) }
      : await this.requireLinkedAccount(userId);

    const payload = {
      discord_user_id: userId,
      google_email: account.googleEmail,
      username: account.googleEmail,
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

  async addQualityRating({ userId, email, score, note, dateKey, source }) {
    const account = email
      ? { googleEmail: normalizeEmail(email) }
      : await this.requireLinkedAccount(userId);

    const payload = {
      discord_user_id: userId,
      google_email: account.googleEmail,
      username: account.googleEmail,
      score,
      note,
      study_date: dateKey,
      source
    };

    const { data, error } = await this.client.from("study_quality_ratings").insert(payload).select().single();
    if (error) {
      throw error;
    }

    return data;
  }

  async setWeeklyGoal(userId, username, weekday, goalMinutes) {
    const account = await this.requireLinkedAccount(userId);
    const profile = await this.getProfileByGoogleEmail(account.googleEmail);
    const weeklyGoals = normalizeWeeklyGoals(profile?.weekly_goal_minutes);
    weeklyGoals[String(weekday)] = goalMinutes;

    const { data, error } = await this.client
      .from("study_user_profiles")
      .upsert(
        {
          auth_user_id: profile?.auth_user_id || null,
          discord_user_id: userId,
          google_email: account.googleEmail,
          username: account.googleEmail,
          weekly_goal_minutes: weeklyGoals,
          updated_at: new Date().toISOString()
        },
        { onConflict: "google_email" }
      )
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async getUserGoal(userId, dateKey, defaultWeeklyGoals) {
    const account = await this.getLinkedAccount(userId);
    if (!account) {
      return getGoalForDate(dateKey, defaultWeeklyGoals);
    }

    const profile = await this.getProfileByGoogleEmail(account.googleEmail);
    return getGoalForDate(
      dateKey,
      normalizeWeeklyGoals(profile?.weekly_goal_minutes, defaultWeeklyGoals)
    );
  }

  async getDayTotal(dateKey, userId = null) {
    let query = this.client.from("study_entries").select("minutes").eq("study_date", dateKey);
    if (userId) {
      const account = await this.requireLinkedAccount(userId);
      query = query.eq("google_email", account.googleEmail);
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
      const account = await this.requireLinkedAccount(userId);
      query = query.eq("google_email", account.googleEmail);
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

  async getOutcomeTrend(endDateKey, days, userId = null) {
    const startDateKey = addDays(endDateKey, -days + 1);
    let entryQuery = this.client
      .from("study_entries")
      .select("study_date, google_email, minutes")
      .gte("study_date", startDateKey)
      .lte("study_date", endDateKey);
    let ratingQuery = this.client
      .from("study_quality_ratings")
      .select("study_date, google_email, score")
      .gte("study_date", startDateKey)
      .lte("study_date", endDateKey);

    if (userId) {
      const account = await this.requireLinkedAccount(userId);
      entryQuery = entryQuery.eq("google_email", account.googleEmail);
      ratingQuery = ratingQuery.eq("google_email", account.googleEmail);
    }

    const [{ data: entries, error: entryError }, { data: ratings, error: ratingError }] =
      await Promise.all([entryQuery, ratingQuery]);
    if (entryError) {
      throw entryError;
    }
    if (ratingError) {
      throw ratingError;
    }

    return buildOutcomeTrend(endDateKey, days, entries.map(fromSupabaseTrendEntry), ratings.map(fromSupabaseRating));
  }

  async getRanking(endDateKey, days) {
    const startDateKey = addDays(endDateKey, -days + 1);
    const { data, error } = await this.client
      .from("study_entries")
      .select("google_email, minutes")
      .gte("study_date", startDateKey)
      .lte("study_date", endDateKey);

    if (error) {
      throw error;
    }

    const totals = new Map();
    for (const entry of data) {
      const current = totals.get(entry.google_email) || {
        userId: entry.google_email,
        username: entry.google_email,
        minutes: 0
      };
      current.minutes += entry.minutes;
      totals.set(entry.google_email, current);
    }

    return [...totals.values()].sort((a, b) => b.minutes - a.minutes);
  }

  async requireLinkedAccount(userId) {
    const account = await this.getLinkedAccount(userId);
    if (!account) {
      throw new AccountNotLinkedError(userId);
    }
    return account;
  }

  async getProfileByGoogleEmail(email) {
    const { data, error } = await this.client
      .from("study_user_profiles")
      .select("auth_user_id, discord_user_id, google_email, username, weekly_goal_minutes")
      .eq("google_email", normalizeEmail(email))
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  }
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizeWeeklyGoals(source = null, fallback = null) {
  const fallbackValue = Number.isInteger(fallback) ? fallback : 120;
  const fallbackGoals =
    fallback && typeof fallback === "object"
      ? fallback
      : { 0: fallbackValue, 1: fallbackValue, 2: fallbackValue, 3: fallbackValue, 4: fallbackValue, 5: fallbackValue, 6: fallbackValue };
  const goals = source && typeof source === "object" ? source : fallbackGoals;

  return Object.fromEntries(
    Array.from({ length: 7 }, (_, weekday) => [
      String(weekday),
      clampInteger(goals[String(weekday)] ?? goals[weekday] ?? fallbackGoals[String(weekday)] ?? fallbackValue, 1, 1440)
    ])
  );
}

export function getGoalForDate(dateKey, weeklyGoals) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return normalizeWeeklyGoals(weeklyGoals)[String(weekday)];
}

function buildOutcomeTrend(endDateKey, days, entries, ratings) {
  const minutesByDate = new Map();
  const ratingsByDate = new Map();

  for (const entry of entries) {
    minutesByDate.set(entry.date, (minutesByDate.get(entry.date) || 0) + entry.minutes);
  }
  for (const rating of ratings) {
    const current = ratingsByDate.get(rating.date) || [];
    current.push(rating.score);
    ratingsByDate.set(rating.date, current);
  }

  return getDateRange(endDateKey, days).map((dateKey) => {
    const minutes = minutesByDate.get(dateKey) || 0;
    const scores = ratingsByDate.get(dateKey) || [];
    const qualityAverage =
      scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
    return {
      date: dateKey,
      minutes,
      qualityAverage,
      outcomeIndex: Math.round(minutes * ((qualityAverage || 0) / 5))
    };
  });
}

function fromSupabaseEntry(entry) {
  return {
    id: entry.id,
    userId: entry.google_email,
    googleEmail: entry.google_email,
    username: entry.google_email,
    minutes: entry.minutes,
    date: entry.study_date,
    channelId: entry.channel_id,
    messageId: entry.message_id,
    source: entry.source,
    createdAt: entry.created_at
  };
}

function fromSupabaseTrendEntry(entry) {
  return {
    googleEmail: entry.google_email,
    minutes: entry.minutes,
    date: entry.study_date
  };
}

function fromSupabaseRating(rating) {
  return {
    googleEmail: rating.google_email,
    score: rating.score,
    date: rating.study_date
  };
}

function sumMinutes(entries) {
  return entries.reduce((sum, entry) => sum + entry.minutes, 0);
}

function clampInteger(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(Math.max(Math.round(parsed), min), max);
}
