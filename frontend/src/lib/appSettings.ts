/**
 * appSettings.ts
 *
 * Centralized settings manager for ReadAble.
 * Handles persistence, restoration, and real-time synchronization of:
 * - Reading Preferences (font, size, contrast, spacing, view mode)
 * - Accessibility (dyslexia font, high contrast, reduced motion)
 * - Read Aloud (voice, speed, pitch, auto-read)
 * - Appearance (light/dark theme)
 * - Notifications (reading reminders, document updates, product updates)
 * - Daily Reading Goals (daily target, today's completed time, automatic midnight reset)
 *
 * All settings are user-scoped where possible and stored in localStorage.
 * Synchronizes with readerSettings.ts so existing Reader interfaces remain unified.
 */

import { loadReaderSettings, saveReaderSettings, type ReaderFont, type ReaderTheme, type ReaderViewMode } from "./readerSettings";

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

const SETTINGS_EVENT = "readable_settings_changed";
const GOAL_EVENT = "readable_goal_changed";

function getTodayString(): string {
  const d = new Date();
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

/**
 * Loads all user settings, merging saved state with safe defaults.
 * Automatically checks and resets daily reading progress if the calendar day changed.
 */
export function loadUserSettings(userId?: number | string): UserSettings {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    const parsed: Partial<UserSettings> = raw ? JSON.parse(raw) : {};

    // Also consult existing readerSettings and theme for backward compatibility
    const existingReader = loadReaderSettings();
    const storedTheme = (localStorage.getItem("readable_theme") as "light" | "dark") || null;

    const today = getTodayString();
    let goalData: ReadingGoalSettings = {
      goalMinutes: parsed.goal?.goalMinutes ?? DEFAULT_SETTINGS.goal.goalMinutes,
      completedMinutes: parsed.goal?.completedMinutes ?? 0,
      date: parsed.goal?.date ?? today,
    };

    // If day rolled over, reset today's completed reading minutes
    if (goalData.date !== today) {
      goalData = {
        goalMinutes: goalData.goalMinutes,
        completedMinutes: 0,
        date: today,
      };
    }

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
 * Saves all user settings to persistent storage and syncs relevant keys:
 * - `readable_theme`
 * - `readable_reader_settings` (via saveReaderSettings)
 * - Emits a custom window event so listeners update immediately
 */
export function saveUserSettings(settings: UserSettings, userId?: number | string): void {
  try {
    const key = getStorageKey(userId);
    localStorage.setItem(key, JSON.stringify(settings));

    // Sync theme
    localStorage.setItem("readable_theme", settings.appearance.theme);

    // Sync reader settings for PDFReader.tsx
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

    // Apply reduced motion to document root
    applyReducedMotion(settings.accessibility.reducedMotion);

    // Notify other components
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: settings }));
      window.dispatchEvent(new CustomEvent(GOAL_EVENT, { detail: settings.goal }));
    }
  } catch {
    // Fail silently if localStorage is restricted
  }
}

/**
 * Applies or removes reduced motion styles on document.documentElement
 */
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

/**
 * Resets preferences to safe default values without deleting user data.
 */
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
 * Adds reading activity in minutes to today's completed goal.
 * Automatically handles midnight reset if the date has changed.
 */
export function recordReadingMinutes(minutesToAdd: number, userId?: number | string): ReadingGoalSettings {
  const current = loadUserSettings(userId);
  const today = getTodayString();

  let completed = current.goal.completedMinutes;
  if (current.goal.date !== today) {
    completed = 0;
  }
  completed += Math.max(0, minutesToAdd);

  const updatedGoal: ReadingGoalSettings = {
    goalMinutes: current.goal.goalMinutes,
    completedMinutes: Math.round(completed),
    date: today,
  };

  const nextSettings: UserSettings = {
    ...current,
    goal: updatedGoal,
  };

  saveUserSettings(nextSettings, userId);
  return updatedGoal;
}

/**
 * Subscribes to settings changes across components.
 */
export function subscribeToUserSettings(callback: (settings: UserSettings) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const customEvent = e as CustomEvent<UserSettings>;
    callback(customEvent.detail);
  };
  window.addEventListener(SETTINGS_EVENT, handler);
  return () => window.removeEventListener(SETTINGS_EVENT, handler);
}

/**
 * Subscribes specifically to reading goal changes.
 */
export function subscribeToReadingGoal(callback: (goal: ReadingGoalSettings) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const customEvent = e as CustomEvent<ReadingGoalSettings>;
    callback(customEvent.detail);
  };
  window.addEventListener(GOAL_EVENT, handler);
  return () => window.removeEventListener(GOAL_EVENT, handler);
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
  } catch {
    // Ignore browser speech errors
  }
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
