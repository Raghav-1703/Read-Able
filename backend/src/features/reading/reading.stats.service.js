/**
 * reading.stats.service.js
 *
 * Persistence and calculation engine for user reading streaks, daily goals,
 * and weekday reading activity without modifying database schema.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ValidationError } from "../../shared/utils/errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store stats in backend/data/reading_stats/
const DATA_DIR = path.resolve(__dirname, "../../../data/reading_stats");

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const getStatsFilePath = (userId) => {
  ensureDataDir();
  return path.join(DATA_DIR, `user_${userId}.json`);
};

/**
 * Format a Date to YYYY-MM-DD string in local time.
 */
export const formatDateString = (date = new Date()) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Safely parse date string YYYY-MM-DD into a local Date object.
 */
export const parseDateString = (dateStr) => {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
};

/**
 * Calculate consecutive reading streak.
 * A day counts as a reading day if minutes >= 1.
 *
 * @param {Record<string, number>} dailyRecords - Map of date string to minutes
 * @param {string} todayStr - YYYY-MM-DD string for today
 * @returns {number} Current streak in days
 */
export const calculateReadingStreak = (dailyRecords = {}, todayStr = formatDateString()) => {
  if (!dailyRecords || typeof dailyRecords !== "object") {
    return 0;
  }

  const todayMinutes = Number(dailyRecords[todayStr]) || 0;
  const todayDate = parseDateString(todayStr);

  // Determine starting point for streak check
  let checkDate;
  if (todayMinutes >= 1) {
    // User read today, streak starts with today
    checkDate = new Date(todayDate);
  } else {
    // User hasn't read today yet; check if they read yesterday
    const yesterday = new Date(todayDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatDateString(yesterday);
    const yesterdayMinutes = Number(dailyRecords[yesterdayStr]) || 0;

    if (yesterdayMinutes >= 1) {
      checkDate = yesterday;
    } else {
      // Neither today nor yesterday had valid reading; streak is broken
      return 0;
    }
  }

  let streak = 0;
  const cursor = new Date(checkDate);

  // Traverse backwards consecutively as long as daily reading >= 1 minute
  while (true) {
    const curStr = formatDateString(cursor);
    const minutes = Number(dailyRecords[curStr]) || 0;
    if (minutes >= 1) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
};

/**
 * Generate 7 weekday objects for the current calendar week (Monday to Sunday).
 *
 * @param {Date} referenceDate - Reference date (defaults to today)
 * @param {Record<string, number>} dailyRecords - Map of date string to minutes
 */
export const calculateWeekDays = (referenceDate = new Date(), dailyRecords = {}) => {
  const ref = new Date(referenceDate);
  const dayOfWeek = ref.getDay(); // 0 is Sunday, 1 is Monday, ... 6 is Saturday
  const mondayOffset = (dayOfWeek + 6) % 7; // Distance back to Monday (0 for Mon, 6 for Sun)

  const monday = new Date(ref);
  monday.setDate(ref.getDate() - mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];
  const todayStr = formatDateString(ref);

  const week = [];
  for (let i = 0; i < 7; i++) {
    const current = new Date(monday);
    current.setDate(monday.getDate() + i);
    const dateStr = formatDateString(current);
    const minutes = Number(dailyRecords[dateStr]) || 0;

    week.push({
      day: dayLabels[i],
      date: dateStr,
      minutes,
      completed: minutes >= 1,
      isToday: dateStr === todayStr,
    });
  }

  return week;
};

/**
 * Load raw stats data from disk for a user.
 */
const loadRawUserStats = (userId) => {
  const filePath = getStatsFilePath(userId);
  if (!fs.existsSync(filePath)) {
    return {
      userId,
      dailyGoalMinutes: 50,
      dailyRecords: {},
      sessions: [],
    };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      userId,
      dailyGoalMinutes: Number(parsed.dailyGoalMinutes) || 50,
      dailyRecords: parsed.dailyRecords && typeof parsed.dailyRecords === "object" ? parsed.dailyRecords : {},
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    };
  } catch {
    return {
      userId,
      dailyGoalMinutes: 50,
      dailyRecords: {},
      sessions: [],
    };
  }
};

/**
 * Save raw stats data atomically for a user.
 */
const saveRawUserStats = (userId, data) => {
  const filePath = getStatsFilePath(userId);
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
};

/**
 * Get aggregated reading stats for the authenticated user.
 */
export const getUserReadingStats = async (userId) => {
  const raw = loadRawUserStats(userId);
  const todayStr = formatDateString();

  const todayMinutes = Number(raw.dailyRecords[todayStr]) || 0;
  const goalMinutes = raw.dailyGoalMinutes || 50;
  const goalPercentage = Math.min(100, Math.round((todayMinutes / goalMinutes) * 100) || 0);
  const streak = calculateReadingStreak(raw.dailyRecords, todayStr);
  const weekDays = calculateWeekDays(new Date(), raw.dailyRecords);

  return {
    userId,
    todayMinutes,
    goalMinutes,
    goalPercentage,
    streak,
    dailyRecords: raw.dailyRecords,
    weekDays,
  };
};

/**
 * Log a valid reading session for the authenticated user.
 */
export const logUserReadingActivity = async (userId, { documentId, minutes = 1, date }) => {
  const mins = Math.max(1, Math.round(Number(minutes) || 1));
  const targetDateStr = date ? formatDateString(date) : formatDateString();

  const raw = loadRawUserStats(userId);

  // Accumulate minutes for target calendar day
  const existingDayMinutes = Number(raw.dailyRecords[targetDateStr]) || 0;
  raw.dailyRecords[targetDateStr] = existingDayMinutes + mins;

  // Append session history record
  raw.sessions.push({
    documentId: documentId ? String(documentId) : null,
    date: targetDateStr,
    minutes: mins,
    timestamp: new Date().toISOString(),
  });

  // Limit session log to last 1000 entries
  if (raw.sessions.length > 1000) {
    raw.sessions = raw.sessions.slice(-1000);
  }

  saveRawUserStats(userId, raw);

  return getUserReadingStats(userId);
};

/**
 * Update daily reading goal for the authenticated user.
 */
export const updateUserDailyGoal = async (userId, goalMinutes) => {
  const goal = Number(goalMinutes);
  if (isNaN(goal) || goal < 5 || !Number.isInteger(goal)) {
    throw new ValidationError("Daily reading goal must be an integer >= 5 minutes.");
  }

  const raw = loadRawUserStats(userId);
  raw.dailyGoalMinutes = goal;
  saveRawUserStats(userId, raw);

  return getUserReadingStats(userId);
};
