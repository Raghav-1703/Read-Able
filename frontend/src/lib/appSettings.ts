/**
 * appSettings.ts
 *
 * Centralized settings and reading statistics manager for ReadAble.
 * Handles persistence, restoration, and real-time synchronization of:
 * - Reading Preferences (font, size, contrast, spacing, view mode)
 * - Accessibility (dyslexia font, high contrast, reduced motion)
 * - Read Aloud (voice, speed, pitch, auto-read)
 * - Appearance (light/dark theme)
 * - Notifications (reading reminders, document updates, product updates)
 * - Daily Reading Goals & Reading Streak (daily target, completed minutes, consecutive days, weekdays)
 *
 * All settings are user-scoped where possible and stored in localStorage.
 * Synchronizes with readerSettings.ts and backend reading statistics.
 */

import { loadReaderSettings, saveReaderSettings, type ReaderFont, type ReaderTheme, type ReaderViewMode } from "./readerSettings";
import { readingApi, type ReadingStats, type WeekDayStat } from "./api";

export interface ReadingPreferencesSettings {
  fontFamily: ReaderFont;
  fontSize: number; // 14 to 32
  contrast: "Standard" | "High contrast" | "Cream background";
  lineSpacing: 1.5 | 1.8 | 2.0;
  comfortableSpacing: boolean;
  viewMode: ReaderViewMode; // 'text' | 'pdf'
}

export interface AccessibilitySettings {
  dyslexiaFont: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
}

export interface ReadAloudSettings {
  voice: string;
  speed: number; // 0.5 to 2.0
  pitch: number; // 0.5 to 1.5
  autoRead: boolean;
}

export interface NotificationSettings {
  readingReminders: boolean;
  documentUpdates: boolean;
  productUpdates: boolean;
}

export interface ReadingGoalSettings {
  goalMinutes: number; // Daily reading goal target in minutes
  completedMinutes: number; // Today's completed reading minutes
  date: string; // YYYY-MM-DD
  streak?: number;
}

export interface UserSettings {
  reading: ReadingPreferencesSettings;
  accessibility: AccessibilitySettings;
  readAloud: ReadAloudSettings;
  appearance: {
    theme: "light" | "dark";
  };
  notifications: NotificationSettings;
  goal: ReadingGoalSettings;
}

export const SETTINGS_EVENT = "readable_settings_changed";
export const GOAL_EVENT = "readable_goal_changed";
export const STATS_EVENT = "readable_stats_changed";

export function getTodayString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const DEFAULT_SETTINGS: UserSettings = {
  reading: {
    fontFamily: "OpenDyslexic",
    fontSize: 18,
    contrast: "Standard",
    lineSpacing: 1.5,
    comfortableSpacing: true,
    viewMode: "text",
  },
  accessibility: {
    dyslexiaFont: true,
    highContrast: false,
    reducedMotion: false,
  },
  readAloud: {
    voice: "",
    speed: 1.0,
    pitch: 1.0,
    autoRead: false,
  },
  appearance: {
    theme: "light",
  },
  notifications: {
    readingReminders: true,
    documentUpdates: true,
    productUpdates: false,
  },
  goal: {
    goalMinutes: 50,
    completedMinutes: 0,
    date: getTodayString(),
  },
};

function getStorageKey(userId?: number | string): string {
  return userId ? `readable_user_settings_${userId}` : "readable_user_settings_default";
}

function getActivityStorageKey(userId?: number | string): string {
  return userId ? `readable_reading_activity_${userId}` : "readable_reading_activity_default";
}

export function loadUserReadingActivity(userId?: number | string): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(getActivityStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveUserReadingActivity(activity: Record<string, number>, userId?: number | string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getActivityStorageKey(userId), JSON.stringify(activity));
  } catch {}
}

/**
 * Calculates consecutive reading streak from daily records.
 * A day is a reading day if minutes >= 1.
 */
export function calculateClientReadingStreak(
  dailyRecords: Record<string, number> = {},
  todayStr: string = getTodayString()
): number {
  const todayMinutes = Number(dailyRecords[todayStr]) || 0;
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const todayDate = new Date(ty, tm - 1, td);

  let checkDate: Date;
  if (todayMinutes >= 1) {
    checkDate = new Date(todayDate);
  } else {
    const yesterday = new Date(todayDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = getTodayString(yesterday);
    if ((Number(dailyRecords[yStr]) || 0) >= 1) {
      checkDate = yesterday;
    } else {
      return 0;
    }
  }

  let streak = 0;
  const cursor = new Date(checkDate);
  while (true) {
    const curStr = getTodayString(cursor);
    const mins = Number(dailyRecords[curStr]) || 0;
    if (mins >= 1) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Generates 7 weekday objects for the current calendar week (Monday to Sunday).
 */
export function calculateClientWeekDays(
  dailyRecords: Record<string, number> = {},
  referenceDate: Date = new Date()
): WeekDayStat[] {
  const ref = new Date(referenceDate);
  const dayOfWeek = ref.getDay();
  const mondayOffset = (dayOfWeek + 6) % 7;

  const monday = new Date(ref);
  monday.setDate(ref.getDate() - mondayOffset);
  monday.setHours(0, 0, 0, 0);

  const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];
  const todayStr = getTodayString(ref);

  const week: WeekDayStat[] = [];
  for (let i = 0; i < 7; i++) {
    const current = new Date(monday);
    current.setDate(monday.getDate() + i);
    const dateStr = getTodayString(current);
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
}

/**
 * Loads user settings from persistent storage.
 */
export function loadUserSettings(userId?: number | string): UserSettings {
  if (typeof window === "undefined") {
    return {
      ...DEFAULT_SETTINGS,
      goal: { ...DEFAULT_SETTINGS.goal, date: getTodayString() },
    };
  }

  try {
    const key = getStorageKey(userId);
    const raw = localStorage.getItem(key);
    const existingReader = loadReaderSettings();
    const storedTheme = localStorage.getItem("readable_theme") as "light" | "dark" | null;

    if (!raw) {
      const initial: UserSettings = {
        ...DEFAULT_SETTINGS,
        reading: {
          ...DEFAULT_SETTINGS.reading,
          fontFamily: existingReader.fontFamily || DEFAULT_SETTINGS.reading.fontFamily,
          fontSize: existingReader.fontSize || DEFAULT_SETTINGS.reading.fontSize,
          contrast:
            existingReader.theme === "dark"
              ? "High contrast"
              : existingReader.theme === "sepia"
              ? "Cream background"
              : "Standard",
          viewMode: existingReader.viewMode || DEFAULT_SETTINGS.reading.viewMode,
        },
        accessibility: {
          ...DEFAULT_SETTINGS.accessibility,
          dyslexiaFont: existingReader.fontFamily === "OpenDyslexic",
          highContrast: existingReader.theme === "dark",
        },
        appearance: {
          theme: storedTheme || (existingReader.theme === "dark" ? "dark" : "light"),
        },
        goal: {
          ...DEFAULT_SETTINGS.goal,
          date: getTodayString(),
        },
      };

      saveUserSettings(initial, userId);
      return initial;
    }

    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    const today = getTodayString();

    const goalData: ReadingGoalSettings = {
      goalMinutes: Number(parsed.goal?.goalMinutes) || DEFAULT_SETTINGS.goal.goalMinutes,
      completedMinutes: parsed.goal?.date === today ? Number(parsed.goal?.completedMinutes) || 0 : 0,
      date: today,
      streak: parsed.goal?.streak,
    };

    const settings: UserSettings = {
      reading: {
        fontFamily: parsed.reading?.fontFamily ?? existingReader.fontFamily ?? DEFAULT_SETTINGS.reading.fontFamily,
        fontSize: parsed.reading?.fontSize ?? existingReader.fontSize ?? DEFAULT_SETTINGS.reading.fontSize,
        contrast: parsed.reading?.contrast ?? DEFAULT_SETTINGS.reading.contrast,
        lineSpacing: parsed.reading?.lineSpacing ?? DEFAULT_SETTINGS.reading.lineSpacing,
        comfortableSpacing:
          parsed.reading?.comfortableSpacing ?? existingReader.comfortableSpacing ?? DEFAULT_SETTINGS.reading.comfortableSpacing,
        viewMode: parsed.reading?.viewMode ?? existingReader.viewMode ?? DEFAULT_SETTINGS.reading.viewMode,
      },
      accessibility: {
        dyslexiaFont: parsed.accessibility?.dyslexiaFont ?? DEFAULT_SETTINGS.accessibility.dyslexiaFont,
        highContrast: parsed.accessibility?.highContrast ?? DEFAULT_SETTINGS.accessibility.highContrast,
        reducedMotion: parsed.accessibility?.reducedMotion ?? DEFAULT_SETTINGS.accessibility.reducedMotion,
      },
      readAloud: {
        voice: parsed.readAloud?.voice ?? DEFAULT_SETTINGS.readAloud.voice,
        speed: parsed.readAloud?.speed ?? DEFAULT_SETTINGS.readAloud.speed,
        pitch: parsed.readAloud?.pitch ?? DEFAULT_SETTINGS.readAloud.pitch,
        autoRead: parsed.readAloud?.autoRead ?? DEFAULT_SETTINGS.readAloud.autoRead,
      },
      appearance: {
        theme: storedTheme || parsed.appearance?.theme || (existingReader.theme === "dark" ? "dark" : "light"),
      },
      notifications: {
        readingReminders: parsed.notifications?.readingReminders ?? DEFAULT_SETTINGS.notifications.readingReminders,
        documentUpdates: parsed.notifications?.documentUpdates ?? DEFAULT_SETTINGS.notifications.documentUpdates,
        productUpdates: parsed.notifications?.productUpdates ?? DEFAULT_SETTINGS.notifications.productUpdates,
      },
      goal: goalData,
    };

    return settings;
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      goal: { ...DEFAULT_SETTINGS.goal, date: getTodayString() },
    };
  }
}

/**
 * Saves all user settings to persistent storage.
 */
export function saveUserSettings(settings: UserSettings, userId?: number | string): void {
  try {
    const key = getStorageKey(userId);
    localStorage.setItem(key, JSON.stringify(settings));

    localStorage.setItem("readable_theme", settings.appearance.theme);

    const readerTheme: ReaderTheme =
      settings.accessibility.highContrast || settings.reading.contrast === "High contrast"
        ? "dark"
        : settings.reading.contrast === "Cream background"
        ? "sepia"
        : settings.appearance.theme === "dark"
        ? "dark"
        : "light";

    saveReaderSettings({
      theme: readerTheme,
      zoom: 100,
      viewMode: settings.reading.viewMode,
      fontSize: settings.reading.fontSize,
      fontFamily: settings.accessibility.dyslexiaFont ? "OpenDyslexic" : settings.reading.fontFamily,
      comfortableSpacing: settings.reading.comfortableSpacing,
    });

    applyReducedMotion(settings.accessibility.reducedMotion);

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: settings }));
      window.dispatchEvent(new CustomEvent(GOAL_EVENT, { detail: settings.goal }));
    }
  } catch {}
}

export function applyReducedMotion(enabled: boolean): void {
  if (typeof document === "undefined") return;
  if (enabled) {
    document.documentElement.setAttribute("data-reduced-motion", "true");
    document.documentElement.classList.add("reduce-motion");
  } else {
    document.documentElement.removeAttribute("data-reduced-motion");
    document.documentElement.classList.remove("reduce-motion");
  }
}

export function resetUserSettingsToDefaults(userId?: number | string): UserSettings {
  const defaults: UserSettings = {
    ...DEFAULT_SETTINGS,
    goal: {
      ...DEFAULT_SETTINGS.goal,
      date: getTodayString(),
    },
  };
  saveUserSettings(defaults, userId);
  return defaults;
}

/**
 * Records valid reading minutes for the authenticated user and document.
 * Accumulates on calendar day, persists locally and syncs with backend.
 */
export function recordReadingMinutes(
  minutesToAdd: number,
  userId?: number | string,
  documentId?: number | string
): ReadingGoalSettings {
  const current = loadUserSettings(userId);
  const today = getTodayString();
  const mins = Math.max(0, Math.round(minutesToAdd));

  // Update daily activity map
  const activity = loadUserReadingActivity(userId);
  const currentTodayMins = Number(activity[today]) || 0;
  activity[today] = currentTodayMins + mins;
  saveUserReadingActivity(activity, userId);

  const streak = calculateClientReadingStreak(activity, today);

  let completed = current.goal.completedMinutes;
  if (current.goal.date !== today) {
    completed = 0;
  }
  completed += mins;

  const updatedGoal: ReadingGoalSettings = {
    goalMinutes: current.goal.goalMinutes,
    completedMinutes: Math.round(completed),
    date: today,
    streak,
  };

  const nextSettings: UserSettings = {
    ...current,
    goal: updatedGoal,
  };

  saveUserSettings(nextSettings, userId);

  // Sync to backend API if authenticated
  if (typeof window !== "undefined" && localStorage.getItem("readable_token") && mins >= 1) {
    readingApi
      .logActivity({
        documentId: documentId ? String(documentId) : undefined,
        minutes: mins,
      })
      .then((res: any) => {
        if (res.data?.success && res.data?.data) {
          const stats = res.data.data;
          window.dispatchEvent(new CustomEvent(STATS_EVENT, { detail: stats }));
        }
      })
      .catch(() => {
        // Fallback kept in local state
      });
  }

  return updatedGoal;
}

/**
 * Fetches latest reading stats from backend and syncs with local storage.
 */
export async function syncReadingStatsWithBackend(userId?: number | string): Promise<ReadingStats | null> {
  if (typeof window === "undefined" || !localStorage.getItem("readable_token")) {
    return null;
  }
  try {
    const res = await readingApi.getStats();
    if (res.data?.success && res.data?.data) {
      const stats = res.data.data;
      const today = getTodayString();

      // Merge records with local activity
      const localActivity = loadUserReadingActivity(userId);
      const merged = { ...localActivity, ...stats.dailyRecords };
      saveUserReadingActivity(merged, userId);

      const current = loadUserSettings(userId);
      const nextSettings: UserSettings = {
        ...current,
        goal: {
          goalMinutes: stats.goalMinutes || current.goal.goalMinutes,
          completedMinutes: stats.todayMinutes,
          date: today,
          streak: stats.streak,
        },
      };
      saveUserSettings(nextSettings, userId);

      window.dispatchEvent(new CustomEvent(STATS_EVENT, { detail: stats }));
      return stats;
    }
  } catch {}
  return null;
}

export function subscribeToUserSettings(callback: (settings: UserSettings) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const customEvent = e as CustomEvent<UserSettings>;
    callback(customEvent.detail);
  };
  window.addEventListener(SETTINGS_EVENT, handler);
  return () => window.removeEventListener(SETTINGS_EVENT, handler);
}

export function subscribeToReadingGoal(callback: (goal: ReadingGoalSettings) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const customEvent = e as CustomEvent<ReadingGoalSettings>;
    callback(customEvent.detail);
  };
  window.addEventListener(GOAL_EVENT, handler);
  return () => window.removeEventListener(GOAL_EVENT, handler);
}

export function subscribeToReadingStats(callback: (stats: ReadingStats) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const customEvent = e as CustomEvent<ReadingStats>;
    callback(customEvent.detail);
  };
  window.addEventListener(STATS_EVENT, handler);
  return () => window.removeEventListener(STATS_EVENT, handler);
}

// ---------------------------------------------------------------------------
// Text-to-Speech (TTS) Helpers using window.speechSynthesis
// ---------------------------------------------------------------------------

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function getBrowserVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSupported()) return [];
  return window.speechSynthesis.getVoices();
}

let activeUtterance: SpeechSynthesisUtterance | null = null;

export function stopSpeech(): void {
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.cancel();
    activeUtterance = null;
  } catch {}
}

export function speakText(
  text: string,
  options?: Partial<ReadAloudSettings>,
  onEnd?: () => void,
  onError?: (err: any) => void
): boolean {
  if (!isSpeechSupported() || !text?.trim()) {
    return false;
  }

  try {
    stopSpeech();

    const utterance = new SpeechSynthesisUtterance(text.trim());
    if (options?.speed) utterance.rate = Math.max(0.5, Math.min(2.0, options.speed));
    if (options?.pitch) utterance.pitch = Math.max(0.5, Math.min(1.5, options.pitch));

    if (options?.voice) {
      const voices = getBrowserVoices();
      const chosen = voices.find((v) => v.name === options.voice || v.voiceURI === options.voice);
      if (chosen) utterance.voice = chosen;
    }

    utterance.onend = () => {
      activeUtterance = null;
      if (onEnd) onEnd();
    };

    utterance.onerror = (e) => {
      activeUtterance = null;
      if (onError) onError(e);
    };

    activeUtterance = utterance;
    window.speechSynthesis.speak(utterance);
    return true;
  } catch (err) {
    if (onError) onError(err);
    return false;
  }
}

export function isCurrentlySpeaking(): boolean {
  return isSpeechSupported() && (window.speechSynthesis.speaking || activeUtterance !== null);
}
