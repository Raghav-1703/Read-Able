/**
 * SettingsPage.tsx
 *
 * Fully functional Settings Page for ReadAble.
 * Implements:
 * 1. Account / Profile (Name, Email, verified status, account details)
 * 2. Reading Preferences (Font, Text size, Contrast, Line spacing, View mode, Live preview)
 * 3. Accessibility (Dyslexia-friendly font, High contrast mode, Reduced motion)
 * 4. Read Aloud (Voice picker, Speed, Pitch, Auto-read toggle, Live audio test)
 * 5. Appearance (Light mode, Dark mode, synced with Dashboard toggle)
 * 6. Notifications (Reading reminders, Document updates, Product updates)
 * 7. Reading Goals (Daily target minutes, today's completed time, progress %, synced with Dashboard)
 * 8. Data & Privacy (Export Data JSON, Clear Reading History with confirmation, Delete Account notice)
 * 9. Reset to Defaults (Restores all preferences to safe defaults with confirmation)
 * 10. Save Changes (Auto-saved reactively + explicit Save Changes action with toast feedback)
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  User,
  SlidersHorizontal,
  Eye,
  Headphones,
  Moon,
  Sun,
  Bell,
  Target,
  Shield,
  RotateCcw,
  Save,
  CheckCircle2,
  AlertTriangle,
  Download,
  Trash2,
  Volume2,
  KeyRound,
  Edit3,
  VolumeX,
  Minus,
  Plus,
  Loader2,
} from "lucide-react";
import { documentApi, readingApi, userApi, type DocumentItem } from "@/lib/api";
import {
  loadUserSettings,
  saveUserSettings,
  resetUserSettingsToDefaults,
  getBrowserVoices,
  speakText,
  stopSpeech,
  isSpeechSupported,
  isCurrentlySpeaking,
  type UserSettings,
} from "@/lib/appSettings";
import { type ReaderFont } from "@/lib/readerSettings";

interface SettingsPageProps {
  currentUser?: { id?: number; name?: string; email?: string | null; phone?: string | null; createdAt?: string } | null;
  onThemeChange?: (theme: "light" | "dark") => void;
}

export default function SettingsPage({ currentUser, onThemeChange }: SettingsPageProps) {
  const [settings, setSettings] = useState<UserSettings>(() => loadUserSettings(currentUser?.id));
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("saved");
  const [toastMsg, setToastMsg] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  // Modals / Confirmations
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);

  // User profile & security state
  const [profileName, setProfileName] = useState(currentUser?.name || "");
  const [profilePhone, setProfilePhone] = useState(currentUser?.phone || "");
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Active section scroll state
  const [activeSection, setActiveSection] = useState<string>("account");

  const toastTimerRef = useRef<any>(null);
  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    setToastMsg({ text, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 3000);
  };

  // Sync settings when currentUser changes
  useEffect(() => {
    if (currentUser?.id) {
      setSettings(loadUserSettings(currentUser.id));
    }
  }, [currentUser?.id]);

  // Load available browser voices for speech synthesis
  useEffect(() => {
    if (!isSpeechSupported()) return;

    const updateVoices = () => {
      const v = getBrowserVoices();
      if (v.length > 0) setVoices(v);
    };

    updateVoices();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }

    return () => {
      stopSpeech();
    };
  }, []);

  // Check speech state interval
  useEffect(() => {
    const interval = setInterval(() => {
      setIsSpeaking(isCurrentlySpeaking());
    }, 250);
    return () => clearInterval(interval);
  }, []);

  // Update a slice of settings with immediate reactive save
  const updateSettings = (updater: (prev: UserSettings) => UserSettings) => {
    setSettings((prev) => {
      const next = updater(prev);
      saveUserSettings(next, currentUser?.id);
      if (onThemeChange && next.appearance.theme !== prev.appearance.theme) {
        onThemeChange(next.appearance.theme);
      }
      return next;
    });
    setSaveStatus("saved");
  };

  // Explicit save action
  const handleManualSave = () => {
    setSaveStatus("saving");
    saveUserSettings(settings, currentUser?.id);
    if (onThemeChange) {
      onThemeChange(settings.appearance.theme);
    }
    setTimeout(() => {
      setSaveStatus("saved");
      showToast("All settings saved successfully!", "success");
    }, 200);
  };

  // Reset to Defaults
  const handleResetToDefaults = () => {
    stopSpeech();
    const defaults = resetUserSettingsToDefaults(currentUser?.id);
    setSettings(defaults);
    if (onThemeChange) {
      onThemeChange(defaults.appearance.theme);
    }
    setShowResetConfirm(false);
    showToast("Preferences restored to default values.", "info");
  };

  // Read Aloud sample test
  const handleToggleVoiceTest = () => {
    if (isSpeaking) {
      stopSpeech();
      setIsSpeaking(false);
    } else {
      const sampleText =
        "Welcome to ReadAble. This is a preview of your speech settings. You can adjust the voice, speed, and pitch to match your preference.";
      const started = speakText(
        sampleText,
        settings.readAloud,
        () => setIsSpeaking(false),
        () => {
          setIsSpeaking(false);
          showToast("Speech synthesis is unavailable in this browser.", "error");
        }
      );
      if (started) {
        setIsSpeaking(true);
      } else {
        showToast("Speech synthesis is unavailable in this browser.", "error");
      }
    }
  };

  // Export User Data as JSON
  const handleExportData = async () => {
    try {
      setIsExporting(true);
      const [docsRes, bookmarksRes, notesRes] = await Promise.all([
        documentApi.getAll().catch(() => ({ data: { data: [] } })),
        readingApi.getBookmarks().catch(() => ({ data: { data: [] } })),
        readingApi.getNotes().catch(() => ({ data: { data: [] } })),
      ]);

      const exportPayload = {
        exportedAt: new Date().toISOString(),
        user: {
          id: currentUser?.id,
          name: currentUser?.name,
          email: currentUser?.email,
          phone: currentUser?.phone,
        },
        settings,
        documents: docsRes.data?.data || [],
        readingProgress: bookmarksRes.data?.data || [],
        notes: notesRes.data?.data || [],
      };

      const jsonStr = JSON.stringify(exportPayload, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `readable-export-${currentUser?.id || "data"}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast("Data export downloaded successfully!", "success");
    } catch {
      showToast("Failed to export data. Please try again.", "error");
    } finally {
      setIsExporting(false);
    }
  };

  // Clear Reading History
  const handleSaveProfile = async () => {
    if (!profileName.trim() || profileName.trim().length < 2) {
      showToast("Name must be at least 2 characters.", "error");
      return;
    }
    setSavingProfile(true);
    try {
      const res = await userApi.updateProfile({
        name: profileName.trim(),
        phone: profilePhone.trim() || undefined,
      });
      if (res.data?.success) {
        showToast("Profile updated successfully.", "success");
        setIsEditingProfile(false);
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || "Failed to update profile.";
      showToast(msg, "error");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      showToast("Current password is required.", "error");
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      showToast("New password must be at least 8 characters.", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast("New passwords do not match.", "error");
      return;
    }
    setSavingPassword(true);
    try {
      const res = await userApi.changePassword({ currentPassword, newPassword });
      if (res.data?.success) {
        showToast("Password updated successfully.", "success");
        setShowPasswordModal(false);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || "Failed to update password.";
      showToast(msg, "error");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      showToast("Please enter your password to confirm.", "error");
      return;
    }
    setDeletingAccount(true);
    try {
      await userApi.deleteAccount({ password: deletePassword });
      localStorage.clear();
      showToast("Account deleted successfully.", "success");
      window.location.href = "/";
    } catch (err: any) {
      const msg = err.response?.data?.message || "Incorrect password.";
      showToast(msg, "error");
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleClearHistory = async () => {
    try {
      setIsClearingHistory(true);
      const docsRes = await documentApi.getAll().catch(() => ({ data: { data: [] } }));
      const docs: DocumentItem[] = docsRes.data?.data || [];

      // Reset progress on all user documents
      await Promise.all(
        docs.map((d) =>
          readingApi.resetProgress(d.id).catch(() => {
            // Safe fallback per document
          })
        )
      );

      // Clean local progress cache
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith("readable_progress_")) {
          localStorage.removeItem(key);
        }
      }

      // Also reset today's reading goal completed time
      updateSettings((prev) => ({
        ...prev,
        goal: { ...prev.goal, completedMinutes: 0 },
      }));

      setShowClearHistoryConfirm(false);
      showToast("Reading history cleared successfully.", "success");
    } catch {
      showToast("Failed to clear reading history.", "error");
    } finally {
      setIsClearingHistory(false);
    }
  };

  // Live preview styles based on reading settings
  const previewStyle: React.CSSProperties = useMemo(() => {
    const fontMap: Record<ReaderFont, string> = {
      OpenDyslexic: "'OpenDyslexic', sans-serif",
      Lexend: "'Lexend', sans-serif",
      Inter: "'Inter', sans-serif",
      System: "system-ui, -apple-system, sans-serif",
    };

    const isHighContrast = settings.accessibility.highContrast || settings.reading.contrast === "High contrast";
    const isCream = settings.reading.contrast === "Cream background";

    let bg = "var(--card-soft)";
    let color = "var(--text-1)";
    let border = "1px solid var(--border)";

    if (isHighContrast) {
      bg = "#000000";
      color = "#FFFFFF";
      border = "2px solid #3DD9AE";
    } else if (isCream) {
      bg = "#FAF4E8";
      color = "#382F24";
      border = "1px solid #E3D7BF";
    }

    return {
      fontFamily: settings.accessibility.dyslexiaFont ? fontMap.OpenDyslexic : fontMap[settings.reading.fontFamily],
      fontSize: `${settings.reading.fontSize}px`,
      lineHeight: settings.reading.comfortableSpacing ? 1.85 : settings.reading.lineSpacing,
      letterSpacing: settings.reading.comfortableSpacing ? "0.03em" : "normal",
      background: bg,
      color: color,
      border: border,
      borderRadius: "12px",
      padding: "20px",
      marginTop: "16px",
      transition: "all 0.2s ease",
    };
  }, [settings.reading, settings.accessibility]);

  // Goal calculations
  const goalMinutes = settings.goal.goalMinutes;
  const goalDone = settings.goal.completedMinutes;
  const goalPct = Math.min(100, Math.round((goalDone / (goalMinutes || 1)) * 100));

  const SECTIONS = [
    { id: "account", label: "Account", icon: User },
    { id: "reading", label: "Reading", icon: SlidersHorizontal },
    { id: "accessibility", label: "Accessibility", icon: Eye },
    { id: "readaloud", label: "Read Aloud", icon: Headphones },
    { id: "appearance", label: "Appearance", icon: Moon },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "goals", label: "Reading Goals", icon: Target },
    { id: "privacy", label: "Data & Privacy", icon: Shield },
  ];

  return (
    <div className="settings-page" style={{ paddingBottom: "60px" }}>
      {/* Toast Feedback */}
      {toastMsg && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 9999,
            background: toastMsg.type === "error" ? "#EF4444" : toastMsg.type === "info" ? "#2563EB" : "var(--accent)",
            color: "#FFFFFF",
            padding: "12px 20px",
            borderRadius: "10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "0.875rem",
            fontWeight: 500,
            animation: "fadeIn 0.2s ease",
          }}
        >
          {toastMsg.type === "error" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "14px",
          marginBottom: "20px",
        }}
      >
        <div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0, color: "var(--text-1)" }}>Settings</h2>
          <p style={{ margin: "4px 0 0", color: "var(--text-2)", fontSize: "0.875rem" }}>
            Customize your reading environment, accessibility features, and preferences.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--text-2)",
              fontSize: "0.8125rem",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <RotateCcw size={14} />
            <span>Reset to defaults</span>
          </button>

          <button
            type="button"
            onClick={handleManualSave}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: "var(--accent)",
              color: "#FFFFFF",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 2px 6px rgba(0,91,77,0.2)",
            }}
          >
            <Save size={14} />
            <span>{saveStatus === "saving" ? "Saving..." : "Save changes"}</span>
          </button>
        </div>
      </div>

      {/* Quick navigation pill tabs */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          overflowX: "auto",
          paddingBottom: "12px",
          marginBottom: "20px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setActiveSection(id);
              const el = document.getElementById(`settings-sec-${id}`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 14px",
              borderRadius: "999px",
              border: "1px solid",
              borderColor: activeSection === id ? "var(--accent)" : "var(--border)",
              background: activeSection === id ? "var(--accent-tint)" : "var(--card)",
              color: activeSection === id ? "var(--accent)" : "var(--text-2)",
              fontSize: "0.8125rem",
              fontWeight: activeSection === id ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "all 0.15s ease",
            }}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* ===================================================================== */}
      {/* 1. Account / Profile */}
      {/* ===================================================================== */}
      <section id="settings-sec-account" className="card" style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
          <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
            <User size={18} style={{ color: "var(--accent)" }} />
            <span>Account / Profile</span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--text-2)",
                fontSize: "0.8125rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <KeyRound size={14} />
              <span>Change password</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (isEditingProfile) {
                  handleSaveProfile();
                } else {
                  setIsEditingProfile(true);
                }
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                borderRadius: "8px",
                border: "none",
                background: "var(--accent)",
                color: "#FFFFFF",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <Edit3 size={14} />
              <span>{isEditingProfile ? (savingProfile ? "Saving..." : "Save profile") : "Edit profile"}</span>
            </button>
          </div>
        </div>
        <p style={{ margin: "4px 0 16px", color: "var(--text-3)", fontSize: "0.8125rem" }}>
          Your profile details and credentials for ReadAble.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "6px" }}>
              Full Name
            </label>
            <input
              type="text"
              readOnly={!isEditingProfile}
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Your full name"
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: isEditingProfile ? "var(--card)" : "var(--card-soft)",
                color: "var(--text-1)",
                fontSize: "0.875rem",
                cursor: isEditingProfile ? "text" : "default",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "6px" }}>
              Email Address
            </label>
            <input
              type="email"
              readOnly
              value={currentUser?.email || "Not provided"}
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "var(--card-soft)",
                color: "var(--text-1)",
                fontSize: "0.875rem",
                cursor: "not-allowed",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "6px" }}>
              Mobile Number
            </label>
            <input
              type="text"
              readOnly={!isEditingProfile}
              value={profilePhone}
              onChange={(e) => setProfilePhone(e.target.value)}
              placeholder="+1234567890"
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: isEditingProfile ? "var(--card)" : "var(--card-soft)",
                color: "var(--text-1)",
                fontSize: "0.875rem",
                cursor: isEditingProfile ? "text" : "default",
              }}
            />
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 2. Reading Preferences */}
      {/* ===================================================================== */}
      <section id="settings-sec-reading" className="card" style={{ marginBottom: "20px" }}>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <SlidersHorizontal size={18} style={{ color: "var(--accent)" }} />
          <span>Reading Preferences</span>
        </div>
        <p style={{ margin: "4px 0 16px", color: "var(--text-3)", fontSize: "0.8125rem" }}>
          These settings directly configure the document reader and live reading experience.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
          {/* Font Family */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "6px" }}>
              Default Font
            </label>
            <select
              value={settings.reading.fontFamily}
              onChange={(e) => {
                const val = e.target.value as ReaderFont;
                updateSettings((prev) => ({
                  ...prev,
                  reading: { ...prev.reading, fontFamily: val },
                  accessibility: {
                    ...prev.accessibility,
                    dyslexiaFont: val === "OpenDyslexic",
                  },
                }));
              }}
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--text-1)",
                fontSize: "0.875rem",
              }}
            >
              <option value="OpenDyslexic">OpenDyslexic (Dyslexia-friendly)</option>
              <option value="Lexend">Lexend (High readability)</option>
              <option value="Inter">Inter (Clean sans-serif)</option>
              <option value="System">System default</option>
            </select>
          </div>

          {/* Text Size Stepper */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "6px" }}>
              Text Size ({settings.reading.fontSize}px)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                type="button"
                onClick={() =>
                  updateSettings((prev) => ({
                    ...prev,
                    reading: { ...prev.reading, fontSize: Math.max(14, prev.reading.fontSize - 1) },
                  }))
                }
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  color: "var(--text-1)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Minus size={14} />
              </button>

              <input
                type="range"
                min="14"
                max="32"
                value={settings.reading.fontSize}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  updateSettings((prev) => ({
                    ...prev,
                    reading: { ...prev.reading, fontSize: val },
                  }));
                }}
                style={{ flex: 1, accentColor: "var(--accent)" }}
              />

              <button
                type="button"
                onClick={() =>
                  updateSettings((prev) => ({
                    ...prev,
                    reading: { ...prev.reading, fontSize: Math.min(32, prev.reading.fontSize + 1) },
                  }))
                }
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  color: "var(--text-1)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Contrast */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "6px" }}>
              Contrast Theme
            </label>
            <select
              value={settings.reading.contrast}
              onChange={(e) => {
                const val = e.target.value as "Standard" | "High contrast" | "Cream background";
                updateSettings((prev) => ({
                  ...prev,
                  reading: { ...prev.reading, contrast: val },
                  accessibility: {
                    ...prev.accessibility,
                    highContrast: val === "High contrast",
                  },
                }));
              }}
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--text-1)",
                fontSize: "0.875rem",
              }}
            >
              <option value="Standard">Standard (Clean light)</option>
              <option value="High contrast">High contrast (Maximum legibility)</option>
              <option value="Cream background">Cream background (Soft warm)</option>
            </select>
          </div>

          {/* Line Spacing */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "6px" }}>
              Line Spacing
            </label>
            <select
              value={settings.reading.lineSpacing}
              onChange={(e) => {
                const val = parseFloat(e.target.value) as 1.5 | 1.8 | 2.0;
                updateSettings((prev) => ({
                  ...prev,
                  reading: { ...prev.reading, lineSpacing: val },
                }));
              }}
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--text-1)",
                fontSize: "0.875rem",
              }}
            >
              <option value={1.5}>1.5 (Standard)</option>
              <option value={1.8}>1.8 (Comfortable)</option>
              <option value={2.0}>2.0 (Spacious)</option>
            </select>
          </div>

          {/* Reading Layout / View Mode */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "6px" }}>
              Default Reading Layout
            </label>
            <select
              value={settings.reading.viewMode}
              onChange={(e) => {
                const val = e.target.value as "text" | "pdf";
                updateSettings((prev) => ({
                  ...prev,
                  reading: { ...prev.reading, viewMode: val },
                }));
              }}
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--text-1)",
                fontSize: "0.875rem",
              }}
            >
              <option value="text">Single Page — Extracted Text (Accessible)</option>
              <option value="pdf">Original PDF (Canvas Viewer)</option>
            </select>
          </div>
        </div>

        {/* Live Preview Box */}
        <div style={{ marginTop: "16px" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)" }}>Live Preview</div>
          <div style={previewStyle}>
            <p style={{ margin: "0 0 8px 0", fontWeight: 600 }}>The joy of effortless reading</p>
            <p style={{ margin: 0 }}>
              ReadAble adapts each document to your exact visual needs. Whether you read with dyslexia-friendly
              typography, increased line spacing, or focused contrast, your reader will always open with these
              settings.
            </p>
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 3. Accessibility */}
      {/* ===================================================================== */}
      <section id="settings-sec-accessibility" className="card" style={{ marginBottom: "20px" }}>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Eye size={18} style={{ color: "var(--accent)" }} />
          <span>Accessibility</span>
        </div>
        <p style={{ margin: "4px 0 16px", color: "var(--text-3)", fontSize: "0.8125rem" }}>
          Designed specifically to reduce cognitive fatigue and improve visual focus.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* Dyslexia-friendly font */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderRadius: "10px",
              background: "var(--card-soft)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-1)" }}>
                Dyslexia-friendly font
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                Applies weighted bottoms and unique letter shapes (OpenDyslexic) to prevent letter confusion.
              </div>
            </div>
            <label style={{ position: "relative", display: "inline-block", width: 44, height: 24, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.accessibility.dyslexiaFont}
                onChange={(e) => {
                  const checked = e.target.checked;
                  updateSettings((prev) => ({
                    ...prev,
                    accessibility: { ...prev.accessibility, dyslexiaFont: checked },
                    reading: {
                      ...prev.reading,
                      fontFamily: checked ? "OpenDyslexic" : "Inter",
                    },
                  }));
                }}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 999,
                  background: settings.accessibility.dyslexiaFont ? "var(--accent)" : "var(--border)",
                  transition: "0.2s",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: settings.accessibility.dyslexiaFont ? 22 : 2,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "#FFFFFF",
                  transition: "0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </label>
          </div>

          {/* High contrast */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderRadius: "10px",
              background: "var(--card-soft)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-1)" }}>High contrast mode</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                Amplifies text-to-background contrast ratio for enhanced visual clarity and low-vision comfort.
              </div>
            </div>
            <label style={{ position: "relative", display: "inline-block", width: 44, height: 24, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.accessibility.highContrast}
                onChange={(e) => {
                  const checked = e.target.checked;
                  updateSettings((prev) => ({
                    ...prev,
                    accessibility: { ...prev.accessibility, highContrast: checked },
                    reading: {
                      ...prev.reading,
                      contrast: checked ? "High contrast" : "Standard",
                    },
                  }));
                }}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 999,
                  background: settings.accessibility.highContrast ? "var(--accent)" : "var(--border)",
                  transition: "0.2s",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: settings.accessibility.highContrast ? 22 : 2,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "#FFFFFF",
                  transition: "0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </label>
          </div>

          {/* Reduced motion */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderRadius: "10px",
              background: "var(--card-soft)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-1)" }}>Reduced motion</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                Minimizes UI transitions, sliding effects, and animations for vestibular accessibility.
              </div>
            </div>
            <label style={{ position: "relative", display: "inline-block", width: 44, height: 24, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.accessibility.reducedMotion}
                onChange={(e) => {
                  const checked = e.target.checked;
                  updateSettings((prev) => ({
                    ...prev,
                    accessibility: { ...prev.accessibility, reducedMotion: checked },
                  }));
                }}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 999,
                  background: settings.accessibility.reducedMotion ? "var(--accent)" : "var(--border)",
                  transition: "0.2s",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: settings.accessibility.reducedMotion ? 22 : 2,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "#FFFFFF",
                  transition: "0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </label>
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 4. Read Aloud */}
      {/* ===================================================================== */}
      <section id="settings-sec-readaloud" className="card" style={{ marginBottom: "20px" }}>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Headphones size={18} style={{ color: "var(--accent)" }} />
          <span>Read Aloud</span>
        </div>
        <p style={{ margin: "4px 0 16px", color: "var(--text-3)", fontSize: "0.8125rem" }}>
          Listen to your documents with natural device text-to-speech.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
          {/* Voice selector */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "6px" }}>
              Voice
            </label>
            <select
              value={settings.readAloud.voice}
              onChange={(e) => {
                const val = e.target.value;
                updateSettings((prev) => ({
                  ...prev,
                  readAloud: { ...prev.readAloud, voice: val },
                }));
              }}
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--text-1)",
                fontSize: "0.875rem",
              }}
            >
              <option value="">Default system voice</option>
              {voices.map((v) => (
                <option key={v.voiceURI || v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>

          {/* Speed / Rate */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "6px" }}>
              Reading Speed: {settings.readAloud.speed.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={settings.readAloud.speed}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                updateSettings((prev) => ({
                  ...prev,
                  readAloud: { ...prev.readAloud, speed: val },
                }));
              }}
              style={{ width: "100%", accentColor: "var(--accent)", marginTop: "8px" }}
            />
          </div>

          {/* Pitch */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "6px" }}>
              Voice Pitch: {settings.readAloud.pitch.toFixed(1)}
            </label>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.1"
              value={settings.readAloud.pitch}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                updateSettings((prev) => ({
                  ...prev,
                  readAloud: { ...prev.readAloud, pitch: val },
                }));
              }}
              style={{ width: "100%", accentColor: "var(--accent)", marginTop: "8px" }}
            />
          </div>
        </div>

        {/* Auto-read toggle & Test Voice */}
        <div
          style={{
            marginTop: "16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "14px",
            padding: "12px 16px",
            borderRadius: "10px",
            background: "var(--card-soft)",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-1)" }}>
              Auto-read on document open
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
              Automatically begins reading aloud when a document is opened.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              type="button"
              onClick={handleToggleVoiceTest}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "8px",
                border: "none",
                background: isSpeaking ? "var(--warning)" : "var(--accent)",
                color: "#FFFFFF",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {isSpeaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
              <span>{isSpeaking ? "Stop sample" : "Test voice"}</span>
            </button>

            <label style={{ position: "relative", display: "inline-block", width: 44, height: 24, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.readAloud.autoRead}
                onChange={(e) => {
                  const checked = e.target.checked;
                  updateSettings((prev) => ({
                    ...prev,
                    readAloud: { ...prev.readAloud, autoRead: checked },
                  }));
                }}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 999,
                  background: settings.readAloud.autoRead ? "var(--accent)" : "var(--border)",
                  transition: "0.2s",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: settings.readAloud.autoRead ? 22 : 2,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "#FFFFFF",
                  transition: "0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </label>
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 5. Appearance */}
      {/* ===================================================================== */}
      <section id="settings-sec-appearance" className="card" style={{ marginBottom: "20px" }}>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Moon size={18} style={{ color: "var(--accent)" }} />
          <span>Appearance</span>
        </div>
        <p style={{ margin: "4px 0 16px", color: "var(--text-3)", fontSize: "0.8125rem" }}>
          Select your theme. Synced seamlessly across the dashboard and document reader.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" }}>
          {/* Light Mode Card */}
          <div
            onClick={() =>
              updateSettings((prev) => ({
                ...prev,
                appearance: { theme: "light" },
              }))
            }
            style={{
              padding: "16px",
              borderRadius: "12px",
              border: `2px solid ${settings.appearance.theme === "light" ? "var(--accent)" : "var(--border)"}`,
              background: "#FFFFFF",
              color: "#122620",
              cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: settings.appearance.theme === "light" ? "0 4px 12px rgba(0,91,77,0.12)" : "none",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "0.9375rem" }}>
                <Sun size={18} style={{ color: "#E08A2B" }} />
                <span>Light Mode</span>
              </div>
              {settings.appearance.theme === "light" && <CheckCircle2 size={18} style={{ color: "var(--accent)" }} />}
            </div>
            <p style={{ margin: 0, fontSize: "0.75rem", color: "#5B6E68" }}>
              Clean, bright interface optimized for day reading and high-ambient light environments.
            </p>
          </div>

          {/* Dark Mode Card */}
          <div
            onClick={() =>
              updateSettings((prev) => ({
                ...prev,
                appearance: { theme: "dark" },
              }))
            }
            style={{
              padding: "16px",
              borderRadius: "12px",
              border: `2px solid ${settings.appearance.theme === "dark" ? "var(--accent)" : "var(--border)"}`,
              background: "#152420",
              color: "#EAF7F1",
              cursor: "pointer",
              transition: "all 0.2s ease",
              boxShadow: settings.appearance.theme === "dark" ? "0 4px 12px rgba(61,217,174,0.18)" : "none",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, fontSize: "0.9375rem" }}>
                <Moon size={18} style={{ color: "#3DD9AE" }} />
                <span>Dark Mode</span>
              </div>
              {settings.appearance.theme === "dark" && <CheckCircle2 size={18} style={{ color: "var(--accent)" }} />}
            </div>
            <p style={{ margin: 0, fontSize: "0.75rem", color: "#A9C4BB" }}>
              Soothing dark green/black palette reducing eye fatigue and blue light exposure at night.
            </p>
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 6. Notifications */}
      {/* ===================================================================== */}
      <section id="settings-sec-notifications" className="card" style={{ marginBottom: "20px" }}>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Bell size={18} style={{ color: "var(--accent)" }} />
          <span>Notifications</span>
        </div>
        <p style={{ margin: "4px 0 16px", color: "var(--text-3)", fontSize: "0.8125rem" }}>
          Choose which notifications and habit reminders you wish to receive.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Reading Reminders */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderRadius: "10px",
              background: "var(--card-soft)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-1)" }}>Reading reminders</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                Periodic nudges to help you maintain your daily reading goal.
              </div>
            </div>
            <label style={{ position: "relative", display: "inline-block", width: 44, height: 24, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.notifications.readingReminders}
                onChange={(e) => {
                  const checked = e.target.checked;
                  updateSettings((prev) => ({
                    ...prev,
                    notifications: { ...prev.notifications, readingReminders: checked },
                  }));
                }}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 999,
                  background: settings.notifications.readingReminders ? "var(--accent)" : "var(--border)",
                  transition: "0.2s",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: settings.notifications.readingReminders ? 22 : 2,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "#FFFFFF",
                  transition: "0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </label>
          </div>

          {/* Document Updates */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderRadius: "10px",
              background: "var(--card-soft)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-1)" }}>Document updates</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                Alerts when uploaded document text extraction or processing finishes.
              </div>
            </div>
            <label style={{ position: "relative", display: "inline-block", width: 44, height: 24, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.notifications.documentUpdates}
                onChange={(e) => {
                  const checked = e.target.checked;
                  updateSettings((prev) => ({
                    ...prev,
                    notifications: { ...prev.notifications, documentUpdates: checked },
                  }));
                }}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 999,
                  background: settings.notifications.documentUpdates ? "var(--accent)" : "var(--border)",
                  transition: "0.2s",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: settings.notifications.documentUpdates ? 22 : 2,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "#FFFFFF",
                  transition: "0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </label>
          </div>

          {/* Product Updates */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              borderRadius: "10px",
              background: "var(--card-soft)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-1)" }}>
                Product / feature updates
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                Announcements about new accessibility tools and reading features.
              </div>
            </div>
            <label style={{ position: "relative", display: "inline-block", width: 44, height: 24, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.notifications.productUpdates}
                onChange={(e) => {
                  const checked = e.target.checked;
                  updateSettings((prev) => ({
                    ...prev,
                    notifications: { ...prev.notifications, productUpdates: checked },
                  }));
                }}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 999,
                  background: settings.notifications.productUpdates ? "var(--accent)" : "var(--border)",
                  transition: "0.2s",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  left: settings.notifications.productUpdates ? 22 : 2,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "#FFFFFF",
                  transition: "0.2s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
              />
            </label>
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 7. Reading Goals */}
      {/* ===================================================================== */}
      <section id="settings-sec-goals" className="card" style={{ marginBottom: "20px" }}>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Target size={18} style={{ color: "var(--accent)" }} />
          <span>Reading Goals</span>
        </div>
        <p style={{ margin: "4px 0 16px", color: "var(--text-3)", fontSize: "0.8125rem" }}>
          Set your target reading minutes per day. Synchronized with the dashboard's Today's Goal widget.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "20px" }}>
          {/* Target controls */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "8px" }}>
              Daily Reading Goal
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <button
                type="button"
                onClick={() =>
                  updateSettings((prev) => ({
                    ...prev,
                    goal: { ...prev.goal, goalMinutes: Math.max(5, prev.goal.goalMinutes - 5) },
                  }))
                }
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  color: "var(--text-1)",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                -5m
              </button>

              <div
                style={{
                  flex: 1,
                  textAlign: "center",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "var(--card-soft)",
                  fontWeight: 700,
                  fontSize: "1rem",
                  color: "var(--text-1)",
                }}
              >
                {goalMinutes} minutes
              </div>

              <button
                type="button"
                onClick={() =>
                  updateSettings((prev) => ({
                    ...prev,
                    goal: { ...prev.goal, goalMinutes: Math.min(300, prev.goal.goalMinutes + 5) },
                  }))
                }
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  color: "var(--text-1)",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                +5m
              </button>
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-3)", marginTop: "8px" }}>
              Recommended: 30 to 60 minutes for steady comprehension and habit formation.
            </div>
          </div>

          {/* Goal Progress Ring card */}
          <div
            style={{
              padding: "16px",
              borderRadius: "12px",
              background: "var(--card-soft)",
              display: "flex",
              alignItems: "center",
              gap: "18px",
            }}
          >
            <div
              style={{
                width: 68,
                height: 68,
                borderRadius: "50%",
                background: `conic-gradient(var(--accent) ${goalPct}%, var(--border) 0)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  background: "var(--card)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "0.875rem",
                  color: "var(--text-1)",
                }}
              >
                {goalPct}%
              </div>
            </div>

            <div>
              <div style={{ fontWeight: 700, fontSize: "0.9375rem", color: "var(--text-1)" }}>
                {goalDone} of {goalMinutes} minutes
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-2)", marginTop: "2px" }}>
                Completed today • Resets automatically at midnight
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* 8. Data & Privacy */}
      {/* ===================================================================== */}
      <section id="settings-sec-privacy" className="card" style={{ marginBottom: "20px" }}>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Shield size={18} style={{ color: "var(--accent)" }} />
          <span>Data & Privacy</span>
        </div>
        <p style={{ margin: "4px 0 16px", color: "var(--text-3)", fontSize: "0.8125rem" }}>
          Manage your reading history, export records, and manage personal data.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {/* Export Data */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
              padding: "14px 16px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              background: "var(--card-soft)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-1)" }}>Export Your Data</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                Download a complete JSON file with your documents, notes, bookmarks, and settings.
              </div>
            </div>

            <button
              type="button"
              onClick={handleExportData}
              disabled={isExporting}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--text-1)",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: isExporting ? "wait" : "pointer",
              }}
            >
              {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              <span>{isExporting ? "Exporting..." : "Download data"}</span>
            </button>
          </div>

          {/* Clear Reading History */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
              padding: "14px 16px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              background: "var(--card-soft)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--text-1)" }}>Clear Reading History</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                Reset reading progress across all documents. Your documents and notes will remain intact.
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowClearHistoryConfirm(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "8px",
                border: "1px solid var(--warning)",
                background: "var(--card)",
                color: "var(--warning)",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <RotateCcw size={14} />
              <span>Clear history</span>
            </button>
          </div>

          {/* Delete Account (Danger Zone) */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
              padding: "14px 16px",
              borderRadius: "10px",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              background: "rgba(239, 68, 68, 0.04)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.875rem", color: "#EF4444" }}>Delete Account</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                Permanently delete your account, saved documents, and reading history.
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 14px",
                borderRadius: "8px",
                border: "1px solid #EF4444",
                background: "transparent",
                color: "#EF4444",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: "not-allowed",
                opacity: 0.5,
              }}
              title="Account deletion is not supported"
            >
              <Trash2 size={14} />
              <span>Unavailable</span>
            </button>
          </div>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* Confirmation Modal: Reset Defaults */}
      {/* ===================================================================== */}
      {showResetConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            style={{
              background: "var(--card)",
              borderRadius: "14px",
              padding: "24px",
              maxWidth: "420px",
              width: "100%",
              boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <AlertTriangle size={22} style={{ color: "var(--warning)" }} />
              <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: "var(--text-1)" }}>
                Reset preferences?
              </h3>
            </div>
            <p style={{ margin: "0 0 20px", fontSize: "0.875rem", color: "var(--text-2)", lineHeight: 1.5 }}>
              This will restore all font, spacing, contrast, speech, appearance, and goal preferences back to their
              default settings. Your documents, notes, and reading progress will NOT be touched.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  color: "var(--text-2)",
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetToDefaults}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--accent)",
                  color: "#FFFFFF",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Reset to defaults
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* Confirmation Modal: Clear Reading History */}
      {/* ===================================================================== */}
      {showClearHistoryConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            style={{
              background: "var(--card)",
              borderRadius: "14px",
              padding: "24px",
              maxWidth: "420px",
              width: "100%",
              boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <AlertTriangle size={22} style={{ color: "#EF4444" }} />
              <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: "var(--text-1)" }}>
                Clear all reading history?
              </h3>
            </div>
            <p style={{ margin: "0 0 20px", fontSize: "0.875rem", color: "var(--text-2)", lineHeight: 1.5 }}>
              This will reset the saved page position and furthest progress to 0% for every document in your library.
              Your uploaded documents and notes will NOT be deleted.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setShowClearHistoryConfirm(false)}
                disabled={isClearingHistory}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  color: "var(--text-2)",
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearHistory}
                disabled={isClearingHistory}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "none",
                  background: "#EF4444",
                  color: "#FFFFFF",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: isClearingHistory ? "wait" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {isClearingHistory && <Loader2 size={14} className="animate-spin" />}
                <span>{isClearingHistory ? "Clearing..." : "Yes, clear history"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: "420px",
              width: "100%",
              background: "var(--card)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
            }}
          >
            <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <KeyRound size={20} style={{ color: "var(--accent)" }} />
              <span>Change Password</span>
            </div>
            <p style={{ margin: "4px 0 16px", color: "var(--text-3)", fontSize: "0.8125rem" }}>
              Enter your current password and choose a secure new password.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "4px" }}>
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card-soft)", color: "var(--text-1)" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "4px" }}>
                  New Password (min 8 characters)
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card-soft)", color: "var(--text-1)" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "4px" }}>
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card-soft)", color: "var(--text-1)" }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
              <button
                type="button"
                onClick={() => {
                  setShowPasswordModal(false);
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                }}
                style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text-2)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleChangePassword}
                disabled={savingPassword}
                style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "var(--accent)", color: "#FFFFFF", fontWeight: 600, cursor: "pointer" }}
              >
                {savingPassword ? "Updating..." : "Update password"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: "420px",
              width: "100%",
              background: "var(--card)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
              border: "1px solid #EF4444",
            }}
          >
            <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "8px", color: "#EF4444" }}>
              <Trash2 size={20} />
              <span>Delete Account Permanently</span>
            </div>
            <p style={{ margin: "4px 0 16px", color: "var(--text-3)", fontSize: "0.8125rem" }}>
              This action cannot be undone. All your documents, reading progress, and personal notes will be permanently deleted.
            </p>

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "var(--text-2)", marginBottom: "4px" }}>
                Confirm Password
              </label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Enter password to confirm"
                style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card-soft)", color: "var(--text-1)" }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeletePassword("");
                }}
                style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text-2)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deletingAccount}
                style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "#EF4444", color: "#FFFFFF", fontWeight: 600, cursor: "pointer" }}
              >
                {deletingAccount ? "Deleting..." : "Permanently Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
