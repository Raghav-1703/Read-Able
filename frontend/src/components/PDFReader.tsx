/**
 * PDFReader.tsx
 *
 * Core Document Reading Experience with Phase 3 Reading Features:
 * 1. Bookmark autosave (debounced ~1s, keepalive on unmount/hide, Go to page input).
 * 2. Highlights (floating red/yellow toolbar on selection, persistent render, color change & delete).
 * 3. Notes panel (autosave debounced ~800ms, status indicators, flush on blur/exit).
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

import type { DocumentReaderSource } from "@/lib/documentSource";
import {
  loadReaderSettings,
  saveReaderSettings,
  type ReaderSettings,
  type ReaderTheme,
  type ReaderFont,
  type ReaderViewMode,
} from "@/lib/readerSettings";
import { useReadingSession } from "@/lib/useReadingSession";
import { loadUserSettings, recordReadingMinutes, speakText, stopSpeech } from "@/lib/appSettings";
import { documentApi, aiApi, type HighlightRecord, type AiAction, type AiLevel } from "@/lib/api";

// Setup pdf.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

function getCharacterOffset(container: Node, targetNode: Node, targetOffset: number): number {
  let charCount = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let currentNode = walker.nextNode();
  while (currentNode) {
    if (currentNode === targetNode) {
      return charCount + targetOffset;
    }
    charCount += currentNode.nodeValue ? currentNode.nodeValue.length : 0;
    currentNode = walker.nextNode();
  }
  return charCount;
}

interface PDFReaderProps {
  source: DocumentReaderSource;
}

const ZOOM_STEPS = [50, 75, 100, 125, 150, 175, 200];
const DEFAULT_ZOOM_IDX = 2; // 100%

export default function PDFReader({ source }: PDFReaderProps) {
  const navigate = useNavigate();

  // Reader Preferences
  const [settings, setSettings] = useState<ReaderSettings>(() => loadReaderSettings());
  const [prefsOpen, setPrefsOpen] = useState(false);

  // Document & Page state
  const extractedPages = source.extractedPages || [];
  const hasExtractedText = extractedPages.length > 0;

  // View Mode: fall back to PDF view mode if no extracted text
  const activeViewMode: ReaderViewMode =
    settings.viewMode === "text" && !hasExtractedText ? "pdf" : settings.viewMode;

  const [numPdfPages, setNumPdfPages] = useState<number>(0);
  const totalPages = Math.max(
    1,
    activeViewMode === "pdf"
      ? numPdfPages || source.totalPages || (hasExtractedText ? extractedPages.length : 1)
      : hasExtractedText ? extractedPages.length : numPdfPages || source.totalPages || 1
  );

  // Reading Session Hook (Features 1, 2, 3)
  const {
    currentPage,
    pageInput,
    setPageInput,
    goToPage,
    nextPage,
    prevPage,
    highlightMode,
    setHighlightMode,
    highlights,
    saveHighlightDirect,
    updateHighlightColor,
    deleteHighlight,
    deleteHighlightsBatch,
    cancelAutosaves,
    activeHighlightPopup,
    setActiveHighlightPopup,
    notes,
    notesPanelOpen,
    setNotesPanelOpen,
    addDraftNote,
    updateNoteContent,
    deleteNote,
    flushNote,
  } = useReadingSession(source.documentId, totalPages);

  // PDF loading state
  const [pdfLoading, setPdfLoading] = useState(true);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Ref to the page container
  const pageContainerRef = useRef<HTMLDivElement | null>(null);
  // Ref to the text container for calculating text offsets
  const textContainerRef = useRef<HTMLDivElement | null>(null);
  // Ref to the scrollable main canvas for smooth page scrolling
  const mainCanvasRef = useRef<HTMLElement | null>(null);

  // Highlight menu dropdown & Toast state
  const [highlightMenuOpen, setHighlightMenuOpen] = useState(false);
  const highlightMenuRef = useRef<HTMLDivElement | null>(null);

  // AI Assistant state & refs
  const [sidebarTab, setSidebarTab] = useState<"notes" | "ai">("notes");
  const [aiDropdown, setAiDropdown] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);
  const aiDropdownRef = useRef<HTMLDivElement | null>(null);
  const [aiState, setAiState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    action: AiAction | null;
    text: string;
    answer: string | null;
    error: string | null;
  }>({
    status: "idle",
    action: null,
    text: "",
    answer: null,
    error: null,
  });

  const [aiLevel, setAiLevel] = useState<AiLevel>("SIMPLE");

  const [toastMsg, setToastMsg] = useState<string>("");
  const [toastVisible, setToastVisible] = useState<boolean>(false);
  const toastTimerRef = useRef<any>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2400);
  }, []);

  const handleDeleteHighlights = useCallback(
    async (ids: number[]) => {
      if (!ids || ids.length === 0) return;
      try {
        await deleteHighlightsBatch(ids);
      } catch {
        showToast("Failed to erase highlight. Please try again.");
      }
    },
    [deleteHighlightsBatch, showToast]
  );

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingDoc, setDeletingDoc] = useState(false);

  const handleDeleteCurrentDocument = async () => {
    setDeletingDoc(true);
    // Cancel pending autosave timers and in-flight saves (Requirement 3)
    cancelAutosaves();
    try {
      await documentApi.delete(Number(source.documentId));
      navigate({ to: "/dashboard" });
    } catch {
      showToast("Failed to delete document");
      setDeletingDoc(false);
      setDeleteDialogOpen(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Keyboard navigation (ArrowLeft / ArrowRight)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        nextPage();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prevPage();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nextPage, prevPage]);

  // ---------------------------------------------------------------------------
  // Preferences management
  // ---------------------------------------------------------------------------
  const updateSettings = (patch: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveReaderSettings(next);
      return next;
    });
  };

  const handleThemeChange = (theme: ReaderTheme) => updateSettings({ theme });
  const handleFontChange = (fontFamily: ReaderFont) => updateSettings({ fontFamily });
  const handleViewModeToggle = () =>
    updateSettings({ viewMode: activeViewMode === "text" ? "pdf" : "text" });

  const changeFontSize = (delta: number) => {
    updateSettings({ fontSize: Math.max(14, Math.min(32, settings.fontSize + delta)) });
  };

  const changeZoom = (delta: number) => {
    const currentIdx = ZOOM_STEPS.indexOf(settings.zoom);
    const nextIdx = Math.max(
      0,
      Math.min(
        ZOOM_STEPS.length - 1,
        (currentIdx === -1 ? DEFAULT_ZOOM_IDX : currentIdx) + delta
      )
    );
    updateSettings({ zoom: ZOOM_STEPS[nextIdx] });
  };

  // ---------------------------------------------------------------------------
  // Visual Theme Tokens
  // ---------------------------------------------------------------------------
  const themeColors = {
    light: {
      bg: "#FAF8F5",
      toolbar: "#FFFFFF",
      border: "#E7E2DA",
      text: "#1D2321",
      textMuted: "#66706D",
      card: "#FFFFFF",
      cardBorder: "#E8E3DA",
      accent: "#2B8272",
      accentHover: "#236B5D",
      accentTint: "rgba(43,130,114,0.08)",
      btnBg: "#F0EDE6",
    },
    sepia: {
      bg: "#F4ECD8",
      toolbar: "#EDE4CE",
      border: "#D8CDAF",
      text: "#382D1D",
      textMuted: "#7C6C53",
      card: "#FAF4E6",
      cardBorder: "#D8CDAF",
      accent: "#8C5823",
      accentHover: "#73461A",
      accentTint: "rgba(140,88,35,0.08)",
      btnBg: "#E3DAC0",
    },
    dark: {
      bg: "#121413",
      toolbar: "#1B1E1C",
      border: "#292E2B",
      text: "#EDF2EF",
      textMuted: "#88948E",
      card: "#181B19",
      cardBorder: "#292E2B",
      accent: "#38A894",
      accentHover: "#45C4AD",
      accentTint: "rgba(56,168,148,0.14)",
      btnBg: "#232825",
    },
  }[settings.theme];

  const fontFamilies: Record<ReaderFont, string> = {
    OpenDyslexic: "'OpenDyslexic', sans-serif",
    Lexend: "'Lexend', sans-serif",
    Inter: "'Inter', sans-serif",
    System: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  };

  const progressPercentage = Math.min(
    100,
    Math.max(0, Math.round((currentPage / totalPages) * 100))
  );

  const currentPageContent =
    extractedPages.find((p) => p.pageNumber === currentPage) ||
    extractedPages[currentPage - 1];

  const pageText = currentPageContent?.text || "";

  // Auto-read page text when enabled in settings
  useEffect(() => {
    const userSettings = loadUserSettings();
    if (userSettings.readAloud?.autoRead && pageText) {
      speakText(pageText, userSettings.readAloud);
    }
    return () => {
      stopSpeech();
    };
  }, [currentPage, pageText]);

  // Track active reading time toward daily reading goal
  useEffect(() => {
    let readingSeconds = 0;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        readingSeconds += 10;
        if (readingSeconds >= 60) {
          recordReadingMinutes(1);
          readingSeconds = 0;
        }
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Valid highlights for active page (Item 2: skip non-matching text or old rects form)
  const validPageHighlights = useMemo(() => {
    if (!pageText) return [];
    return highlights.filter((hl) => {
      if (hl.page !== currentPage) return false;
      if (!hl.rects || typeof hl.rects !== "object") return false;
      const { start, end } = hl.rects as { start?: number; end?: number };
      if (typeof start !== "number" || typeof end !== "number") return false;
      if (start < 0 || end <= start || end > pageText.length) return false;
      return pageText.slice(start, end) === hl.text;
    });
  }, [highlights, currentPage, pageText]);

  interface TextSegment {
    key: string;
    text: string;
    start: number;
    end: number;
    highlights: HighlightRecord[];
  }

  const textSegments = useMemo<TextSegment[]>(() => {
    if (!pageText) return [];
    if (validPageHighlights.length === 0) {
      return [{ key: "seg-0", text: pageText, start: 0, end: pageText.length, highlights: [] }];
    }

    const boundariesSet = new Set<number>([0, pageText.length]);
    for (const hl of validPageHighlights) {
      const { start, end } = hl.rects as { start: number; end: number };
      boundariesSet.add(start);
      boundariesSet.add(end);
    }
    const boundaries = Array.from(boundariesSet).sort((a, b) => a - b);

    const segments: TextSegment[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      if (start >= end) continue;

      const segText = pageText.slice(start, end);
      const covering = validPageHighlights.filter((hl) => {
        const { start: hStart, end: hEnd } = hl.rects as { start: number; end: number };
        return hStart <= start && hEnd >= end;
      });

      segments.push({
        key: `seg-${start}-${end}`,
        text: segText,
        start,
        end,
        highlights: covering,
      });
    }

    return segments;
  }, [pageText, validPageHighlights]);

  // ---------------------------------------------------------------------------
  // Text Selection detection: only active in Text View (Requirement 1 & 2)
  // ---------------------------------------------------------------------------
  const handleTextSelection = useCallback(() => {
    if (activeViewMode !== "text") return;
    if (highlightMode === "OFF") return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const container = textContainerRef.current;
    if (!container) return;

    const range = selection.getRangeAt(0);
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      return;
    }

    let rawStart = getCharacterOffset(container, range.startContainer, range.startOffset);
    let rawEnd = getCharacterOffset(container, range.endContainer, range.endOffset);
    if (rawStart > rawEnd) {
      const tmp = rawStart;
      rawStart = rawEnd;
      rawEnd = tmp;
    }

    // Trim whitespace to ensure clean offset range matching text
    let start = rawStart;
    let end = rawEnd;
    while (start < end && /\s/.test(pageText[start])) {
      start++;
    }
    while (end > start && /\s/.test(pageText[end - 1])) {
      end--;
    }

    if (start >= end) return;
    const selectedText = pageText.slice(start, end);
    if (!selectedText.trim()) return;

    if (highlightMode === "ERASE") {
      // Erase active: selecting text removes every saved highlight that overlaps it
      const overlapping = validPageHighlights.filter((hl) => {
        const { start: hStart, end: hEnd } = hl.rects as { start: number; end: number };
        return Math.max(hStart, start) < Math.min(hEnd, end);
      });

      if (overlapping.length > 0) {
        const idsToDelete = overlapping.map((h) => h.id);
        handleDeleteHighlights(idsToDelete);
      }
      selection.removeAllRanges();
      return;
    }

    if (highlightMode === "RED" || highlightMode === "YELLOW") {
      // Red or Yellow active: selecting text highlights it immediately and autosaves
      saveHighlightDirect(highlightMode, {
        text: selectedText,
        rects: { start, end },
        page: currentPage,
      });
      selection.removeAllRanges();
    }
  }, [
    activeViewMode,
    highlightMode,
    pageText,
    validPageHighlights,
    currentPage,
    saveHighlightDirect,
    handleDeleteHighlights,
  ]);

  // Click outside listener for highlight menu & popup & AI dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!highlightMenuRef.current?.contains(target)) {
        setHighlightMenuOpen(false);
      }
      if (aiDropdownRef.current && !aiDropdownRef.current.contains(target)) {
        setAiDropdown(null);
      }
      if (target?.closest(".highlight-popup")) {
        return;
      }
      if (!target?.closest(".text-highlight-mark")) {
        setActiveHighlightPopup(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setActiveHighlightPopup]);

  // AI Assistant Action trigger
  const handleAiAction = useCallback(
    async (action: AiAction, text: string, level?: AiLevel) => {
      const effectiveLevel = level ?? aiLevel;
      setAiDropdown(null);
      setSidebarTab("ai");
      setNotesPanelOpen(true);
      setAiState({
        status: "loading",
        action,
        text,
        answer: null,
        error: null,
      });

      try {
        const res = await aiApi.query(source.documentId, {
          action,
          level: effectiveLevel,
          text,
        });

        const answer =
          res.data?.data?.answer || res.data?.data?.result || "No answer received.";

        setAiState({
          status: "success",
          action,
          text,
          answer,
          error: null,
        });
      } catch (err: any) {
        const errMsg =
          err?.response?.data?.message ||
          err?.message ||
          "Failed to get AI response. Please try again.";
        setAiState({
          status: "error",
          action,
          text,
          answer: null,
          error: errMsg,
        });
      }
    },
    [source.documentId, setNotesPanelOpen, aiLevel]
  );

  // General text selection detection for AI dropdown (works in both Text and PDF mode)
  const handleSelectionDetection = useCallback(
    (e?: React.SyntheticEvent) => {
      // If user is actively highlighting in text view, let highlight handler run
      if (activeViewMode === "text" && highlightMode !== "OFF") {
        handleTextSelection();
        return;
      }

      // If clicking inside the AI dropdown itself, keep it open
      if (aiDropdownRef.current?.contains(e?.target as Node)) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setAiDropdown(null);
        return;
      }

      const selectedText = selection.toString().trim();
      if (!selectedText) {
        setAiDropdown(null);
        return;
      }

      const mainCanvas = mainCanvasRef.current;
      if (!mainCanvas) return;

      const range = selection.getRangeAt(0);
      if (!mainCanvas.contains(range.commonAncestorContainer)) {
        setAiDropdown(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setAiDropdown(null);
        return;
      }

      // Position floating dropdown above selection (or below if too close to top)
      const popupWidth = 270;
      const popupHeight = 44;
      let top = rect.top - popupHeight - 8;
      if (top < 64) {
        top = rect.bottom + 8;
      }

      let left = rect.left + rect.width / 2 - popupWidth / 2;
      left = Math.max(12, Math.min(window.innerWidth - popupWidth - 12, left));

      setAiDropdown({
        text: selectedText,
        top,
        left,
      });
    },
    [activeViewMode, highlightMode, handleTextSelection]
  );

  // Page input submission (Requirement 5)
  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(pageInput, 10);
    if (!isNaN(val) && val >= 1) {
      const target = Math.max(1, Math.min(val, totalPages));
      goToPage(target);
      mainCanvasRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setPageInput(String(currentPage));
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: themeColors.bg,
        color: themeColors.text,
        fontFamily: fontFamilies[settings.fontFamily],
        overflow: "hidden",
        position: "relative",
      }}
      onMouseUp={handleSelectionDetection}
      onTouchEnd={handleSelectionDetection}
    >
      {/* -------------------------------------------------------------------- */}
      {/* Top Navigation & Toolbar                                             */}
      {/* -------------------------------------------------------------------- */}
      <header
        style={{
          height: 56,
          background: themeColors.toolbar,
          borderBottom: `1px solid ${themeColors.border}`,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 30,
          flexShrink: 0,
        }}
      >
        {/* Left: Back & Document Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => navigate({ to: "/dashboard" })}
            title="Back to Dashboard"
            style={{
              background: themeColors.btnBg,
              border: `1px solid ${themeColors.border}`,
              color: themeColors.text,
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: "0.8125rem",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
            }}
          >
            ← <span className="hidden sm:inline">Dashboard</span>
          </button>

          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                fontSize: "0.9375rem",
                fontWeight: 600,
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "240px",
              }}
              title={source.title}
            >
              {source.title}
            </h1>
          </div>
        </div>

        {/* Center: Page Navigation & "Go to page" */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={prevPage}
            disabled={currentPage <= 1}
            title="Previous page (Left Arrow)"
            style={{
              background: themeColors.btnBg,
              border: `1px solid ${themeColors.border}`,
              color: currentPage <= 1 ? themeColors.textMuted : themeColors.text,
              opacity: currentPage <= 1 ? 0.4 : 1,
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: "0.875rem",
              cursor: currentPage <= 1 ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            ←
          </button>

          <form
            onSubmit={handlePageInputSubmit}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <input
              type="number"
              min={1}
              max={totalPages}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handlePageInputSubmit(e);
                }
              }}
              title="Go to page"
              aria-label="Go to page"
              style={{
                width: 52,
                textAlign: "center",
                background: themeColors.bg,
                color: themeColors.text,
                border: `1px solid ${themeColors.border}`,
                borderRadius: 6,
                padding: "4px 2px",
                fontSize: "0.875rem",
                fontWeight: 600,
                outline: "none",
              }}
            />
            <span style={{ fontSize: "0.8125rem", color: themeColors.textMuted }}>
              / {totalPages}
            </span>
            <button
              type="submit"
              style={{
                background: themeColors.btnBg,
                border: `1px solid ${themeColors.border}`,
                color: themeColors.text,
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: "0.75rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Go
            </button>
          </form>

          <button
            type="button"
            onClick={nextPage}
            disabled={currentPage >= totalPages}
            title="Next page (Right Arrow)"
            style={{
              background: themeColors.btnBg,
              border: `1px solid ${themeColors.border}`,
              color: currentPage >= totalPages ? themeColors.textMuted : themeColors.text,
              opacity: currentPage >= totalPages ? 0.4 : 1,
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: "0.875rem",
              cursor: currentPage >= totalPages ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            →
          </button>
        </div>

        {/* Right: Notes Toggle, Highlight Toolbar, View Mode & Preferences */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
          {/* Notes Panel Toggle Button */}
          <button
            type="button"
            onClick={() => {
              if (notesPanelOpen && sidebarTab === "notes") {
                setNotesPanelOpen(false);
              } else {
                setNotesPanelOpen(true);
                setSidebarTab("notes");
              }
            }}
            title="Toggle Notes Panel"
            style={{
              background: notesPanelOpen && sidebarTab === "notes" ? themeColors.accentTint : themeColors.btnBg,
              border: `1px solid ${notesPanelOpen && sidebarTab === "notes" ? themeColors.accent : themeColors.border}`,
              color: notesPanelOpen && sidebarTab === "notes" ? themeColors.accent : themeColors.text,
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: "0.8125rem",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            📝 Notes
            {notes.length > 0 && (
              <span
                style={{
                  background: themeColors.accent,
                  color: "#fff",
                  borderRadius: "10px",
                  padding: "1px 6px",
                  fontSize: "0.6875rem",
                  fontWeight: 700,
                }}
              >
                {notes.length}
              </span>
            )}
          </button>

          {/* AI Assistant Toggle Button */}
          <button
            type="button"
            onClick={() => {
              if (notesPanelOpen && sidebarTab === "ai") {
                setNotesPanelOpen(false);
              } else {
                setNotesPanelOpen(true);
                setSidebarTab("ai");
              }
            }}
            title="Toggle AI Assistant"
            style={{
              background: notesPanelOpen && sidebarTab === "ai" ? themeColors.accentTint : themeColors.btnBg,
              border: `1px solid ${notesPanelOpen && sidebarTab === "ai" ? themeColors.accent : themeColors.border}`,
              color: notesPanelOpen && sidebarTab === "ai" ? themeColors.accent : themeColors.text,
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: "0.8125rem",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            ✨ AI
          </button>

          {/* Highlight Dropdown Button (Requirement 1 & 2) */}
          {activeViewMode === "pdf" ? (
            <button
              type="button"
              disabled
              title="Highlighting is available in Text view"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: themeColors.btnBg,
                border: `1px solid ${themeColors.border}`,
                color: themeColors.textMuted,
                opacity: 0.5,
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: "0.8125rem",
                fontWeight: 500,
                cursor: "not-allowed",
              }}
            >
              <span>🖍️</span>
              <span>Highlight</span>
            </button>
          ) : (
            <div style={{ position: "relative" }} ref={highlightMenuRef}>
              <button
                type="button"
                onClick={() => setHighlightMenuOpen((v) => !v)}
                title={
                  highlightMode === "OFF"
                    ? "Highlight: Off"
                    : `Highlight: ${highlightMode} active`
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background:
                    highlightMode === "RED"
                      ? "rgba(239, 68, 68, 0.15)"
                      : highlightMode === "YELLOW"
                      ? "rgba(234, 179, 8, 0.2)"
                      : highlightMode === "ERASE"
                      ? "rgba(100, 116, 139, 0.18)"
                      : themeColors.btnBg,
                  border: `1px solid ${
                    highlightMode === "RED"
                      ? "#ef4444"
                      : highlightMode === "YELLOW"
                      ? "#eab308"
                      : highlightMode === "ERASE"
                      ? "#64748b"
                      : themeColors.border
                  }`,
                  color:
                    highlightMode === "RED"
                      ? "#dc2626"
                      : highlightMode === "YELLOW"
                      ? "#b45309"
                      : highlightMode === "ERASE"
                      ? themeColors.text
                      : themeColors.text,
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <span>🖍️</span>
                <span>
                  Highlight
                  {highlightMode === "RED"
                    ? " (Red)"
                    : highlightMode === "YELLOW"
                    ? " (Yellow)"
                    : highlightMode === "ERASE"
                    ? " (Erase)"
                    : ""}
                </span>
                <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>▼</span>
              </button>

              {highlightMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: 40,
                    right: 0,
                    width: 140,
                    background: themeColors.toolbar,
                    border: `1px solid ${themeColors.border}`,
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                    padding: 4,
                    zIndex: 50,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setHighlightMode("RED");
                      setHighlightMenuOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "none",
                      background:
                        highlightMode === "RED" ? "rgba(239, 68, 68, 0.15)" : "transparent",
                      color: highlightMode === "RED" ? "#dc2626" : themeColors.text,
                      fontWeight: highlightMode === "RED" ? 600 : 500,
                      fontSize: "0.8125rem",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span>🔴</span> Red
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHighlightMode("YELLOW");
                      setHighlightMenuOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "none",
                      background:
                        highlightMode === "YELLOW" ? "rgba(234, 179, 8, 0.2)" : "transparent",
                      color: highlightMode === "YELLOW" ? "#b45309" : themeColors.text,
                      fontWeight: highlightMode === "YELLOW" ? 600 : 500,
                      fontSize: "0.8125rem",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span>🟡</span> Yellow
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHighlightMode("ERASE");
                      setHighlightMenuOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "none",
                      background:
                        highlightMode === "ERASE" ? "rgba(100, 116, 139, 0.18)" : "transparent",
                      color: highlightMode === "ERASE" ? themeColors.text : themeColors.text,
                      fontWeight: highlightMode === "ERASE" ? 600 : 500,
                      fontSize: "0.8125rem",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span>🧹</span> Erase
                  </button>
                  <div style={{ height: 1, background: themeColors.border, margin: "2px 0" }} />
                  <button
                    type="button"
                    onClick={() => {
                      setHighlightMode("OFF");
                      setHighlightMenuOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "none",
                      background:
                        highlightMode === "OFF" ? themeColors.btnBg : "transparent",
                      color: themeColors.textMuted,
                      fontWeight: highlightMode === "OFF" ? 600 : 500,
                      fontSize: "0.8125rem",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span>⚪</span> Off
                  </button>
                </div>
              )}
            </div>
          )}

          {/* View Mode Toggle: Accessible Text vs Original PDF */}
          {hasExtractedText && (
            <button
              type="button"
              onClick={handleViewModeToggle}
              title={`Switch to ${activeViewMode === "text" ? "Original PDF" : "Accessible Text"} view`}
              style={{
                background: themeColors.btnBg,
                border: `1px solid ${themeColors.border}`,
                color: themeColors.text,
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {activeViewMode === "text" ? "📄 View PDF" : "✨ Text Mode"}
            </button>
          )}

          {/* Reading Preferences Toggle Button */}
          <button
            type="button"
            onClick={() => setPrefsOpen((v) => !v)}
            title="Reading Preferences"
            style={{
              background: prefsOpen ? themeColors.accentTint : themeColors.btnBg,
              border: `1px solid ${prefsOpen ? themeColors.accent : themeColors.border}`,
              color: prefsOpen ? themeColors.accent : themeColors.text,
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: "0.8125rem",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            ⚙️ <span className="hidden sm:inline">Preferences</span>
          </button>

          {/* Delete Document Button (Requirement 3) */}
          <button
            type="button"
            onClick={() => setDeleteDialogOpen(true)}
            title="Delete this document"
            style={{
              background: "transparent",
              border: `1px solid ${themeColors.border}`,
              color: themeColors.textMuted,
              borderRadius: 8,
              padding: "6px 8px",
              fontSize: "0.8125rem",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#dc2626";
              e.currentTarget.style.borderColor = "#dc2626";
              e.currentTarget.style.background = "rgba(220, 38, 38, 0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = themeColors.textMuted;
              e.currentTarget.style.borderColor = themeColors.border;
              e.currentTarget.style.background = "transparent";
            }}
          >
            🗑️
          </button>

          {/* Preferences Dropdown Panel */}
          {prefsOpen && (
            <div
              style={{
                position: "absolute",
                top: 48,
                right: 0,
                width: 280,
                background: themeColors.toolbar,
                border: `1px solid ${themeColors.border}`,
                borderRadius: 12,
                boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
                padding: 16,
                zIndex: 40,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: `1px solid ${themeColors.border}`,
                  paddingBottom: 8,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>
                  Reading Preferences
                </span>
                <button
                  type="button"
                  onClick={() => setPrefsOpen(false)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "0.9375rem",
                    color: themeColors.textMuted,
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Theme Choice */}
              <div>
                <label style={{ fontSize: "0.75rem", color: themeColors.textMuted, display: "block", marginBottom: 6 }}>
                  CONTRAST THEME
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  {(["light", "sepia", "dark"] as ReaderTheme[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleThemeChange(t)}
                      style={{
                        padding: "6px 0",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        borderRadius: 6,
                        border: `1px solid ${settings.theme === t ? themeColors.accent : themeColors.border}`,
                        background: settings.theme === t ? themeColors.accentTint : themeColors.btnBg,
                        color: settings.theme === t ? themeColors.accent : themeColors.text,
                        cursor: "pointer",
                        textTransform: "capitalize",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Sizing */}
              <div>
                <label style={{ fontSize: "0.75rem", color: themeColors.textMuted, display: "block", marginBottom: 6 }}>
                  TEXT SIZE: {settings.fontSize}px
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => changeFontSize(-2)}
                    disabled={settings.fontSize <= 14}
                    style={{
                      flex: 1,
                      padding: "5px 0",
                      background: themeColors.btnBg,
                      border: `1px solid ${themeColors.border}`,
                      color: themeColors.text,
                      borderRadius: 6,
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    A-
                  </button>
                  <button
                    type="button"
                    onClick={() => changeFontSize(2)}
                    disabled={settings.fontSize >= 32}
                    style={{
                      flex: 1,
                      padding: "5px 0",
                      background: themeColors.btnBg,
                      border: `1px solid ${themeColors.border}`,
                      color: themeColors.text,
                      borderRadius: 6,
                      fontSize: "0.8125rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    A+
                  </button>
                </div>
              </div>

              {/* Typography */}
              <div>
                <label style={{ fontSize: "0.75rem", color: themeColors.textMuted, display: "block", marginBottom: 6 }}>
                  FONT FAMILY
                </label>
                <select
                  value={settings.fontFamily}
                  onChange={(e) => handleFontChange(e.target.value as ReaderFont)}
                  style={{
                    width: "100%",
                    background: themeColors.bg,
                    color: themeColors.text,
                    border: `1px solid ${themeColors.border}`,
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: "0.8125rem",
                    outline: "none",
                  }}
                >
                  <option value="OpenDyslexic">OpenDyslexic (Dyslexia)</option>
                  <option value="Lexend">Lexend (Reading Fluency)</option>
                  <option value="Inter">Inter (Sans-serif)</option>
                  <option value="System">System Default</option>
                </select>
              </div>

              {/* Comfortable Spacing */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: "0.8125rem",
                  cursor: "pointer",
                }}
              >
                <span>Comfortable line spacing</span>
                <input
                  type="checkbox"
                  checked={settings.comfortableSpacing}
                  onChange={(e) => updateSettings({ comfortableSpacing: e.target.checked })}
                  style={{ accentColor: themeColors.accent }}
                />
              </label>

              {/* PDF Zoom Controls */}
              {activeViewMode === "pdf" && (
                <div>
                  <label style={{ fontSize: "0.75rem", color: themeColors.textMuted, display: "block", marginBottom: 6 }}>
                    PDF ZOOM: {settings.zoom}%
                  </label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => changeZoom(-1)}
                      style={{
                        flex: 1,
                        padding: "5px 0",
                        background: themeColors.btnBg,
                        border: `1px solid ${themeColors.border}`,
                        color: themeColors.text,
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSettings({ zoom: 100 })}
                      style={{
                        flex: 1,
                        padding: "5px 0",
                        background: themeColors.btnBg,
                        border: `1px solid ${themeColors.border}`,
                        color: themeColors.text,
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: "0.75rem",
                      }}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => changeZoom(1)}
                      style={{
                        flex: 1,
                        padding: "5px 0",
                        background: themeColors.btnBg,
                        border: `1px solid ${themeColors.border}`,
                        color: themeColors.text,
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </header>


      {/* -------------------------------------------------------------------- */}
      {/* Existing Highlight Action Popup (Color change / Delete)             */}
      {/* -------------------------------------------------------------------- */}
      {activeHighlightPopup && (
        <div
          className="highlight-popup"
          style={{
            position: "fixed",
            top: activeHighlightPopup.y,
            left: activeHighlightPopup.x,
            transform: "translate(-50%, -100%)",
            background: themeColors.toolbar,
            border: `1px solid ${themeColors.border}`,
            boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
            borderRadius: 8,
            padding: "6px 8px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            zIndex: 60,
          }}
        >
          <button
            type="button"
            onClick={() =>
              updateHighlightColor(
                activeHighlightPopup.highlight.id,
                activeHighlightPopup.highlight.color === "RED" ? "YELLOW" : "RED"
              )
            }
            style={{
              background: themeColors.btnBg,
              border: `1px solid ${themeColors.border}`,
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: "0.75rem",
              cursor: "pointer",
              color: themeColors.text,
              fontWeight: 600,
            }}
          >
            Switch to {activeHighlightPopup.highlight.color === "RED" ? "🟡 Yellow" : "🔴 Red"}
          </button>
          <button
            type="button"
            onClick={() => deleteHighlight(activeHighlightPopup.highlight.id)}
            style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#dc2626",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: "0.75rem",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            🗑️ Delete
          </button>
          <button
            type="button"
            onClick={() => setActiveHighlightPopup(null)}
            style={{
              background: "none",
              border: "none",
              color: themeColors.textMuted,
              cursor: "pointer",
              fontSize: "0.875rem",
              padding: "0 4px",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Main Content Area (Reading Canvas + Slide-in Notes Panel)           */}
      {/* -------------------------------------------------------------------- */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        {/* Main Canvas */}
        <main
          ref={mainCanvasRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px 16px 80px",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
          }}
        >
          {/* VIEW MODE 1: Accessible Structured Text View */}
          {activeViewMode === "text" && (
            <article
              ref={pageContainerRef}
              style={{
                position: "relative",
                width: "100%",
                maxWidth: "760px",
                background: themeColors.card,
                border: `1px solid ${themeColors.cardBorder}`,
                borderRadius: "14px",
                padding: "40px 36px",
                boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.comfortableSpacing ? 1.85 : 1.5,
                letterSpacing: settings.comfortableSpacing ? "0.02em" : "normal",
                userSelect: "text",
              }}
            >
              {/* Page Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: `1px solid ${themeColors.border}`,
                  paddingBottom: "12px",
                  marginBottom: "24px",
                  fontSize: "0.8125rem",
                  color: themeColors.textMuted,
                }}
              >
                <span>Page {currentPage} of {totalPages}</span>
                <span>{source.title}</span>
              </div>

              {/* Content Display: Rendered with character-offset inline highlights (Requirement 1 & 2) */}
              {currentPageContent && pageText ? (
                <div
                  ref={textContainerRef}
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    userSelect: "text",
                  }}
                >
                  {textSegments.map((seg) => {
                    if (seg.highlights.length === 0) {
                      return <span key={seg.key}>{seg.text}</span>;
                    }

                    const activeHl = seg.highlights[seg.highlights.length - 1];
                    const isRed = activeHl.color === "RED";

                    return (
                      <mark
                        key={seg.key}
                        className="text-highlight-mark"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (highlightMode === "ERASE") {
                            // Erase active: clicking a highlighted passage removes every saved highlight that overlaps it
                            const idsToDelete = seg.highlights.map((h) => h.id);
                            handleDeleteHighlights(idsToDelete);
                          } else {
                            // Red/Yellow active or Off: clicking an existing highlight still lets user change color or remove
                            setActiveHighlightPopup({
                              highlight: activeHl,
                              x: e.clientX,
                              y: e.clientY - 30,
                            });
                          }
                        }}
                        title={
                          highlightMode === "ERASE"
                            ? "Click to erase highlight"
                            : `Highlight (${activeHl.color}): "${activeHl.text}"`
                        }
                        style={{
                          background: isRed
                            ? "rgba(239, 68, 68, 0.35)"
                            : "rgba(250, 204, 21, 0.45)",
                          color: "inherit",
                          borderRadius: 2,
                          padding: "1px 0",
                          cursor: "pointer",
                          mixBlendMode: "multiply",
                          textDecoration: highlightMode === "ERASE" ? "line-through" : "none",
                        }}
                      >
                        {seg.text}
                      </mark>
                    );
                  })}
                </div>
              ) : (
                /* Empty page state */
                <div
                  style={{
                    padding: "48px 16px",
                    textAlign: "center",
                    color: themeColors.textMuted,
                  }}
                >
                  <div style={{ fontSize: "2rem", marginBottom: 12 }}>🖼️</div>
                  <h3 style={{ fontSize: "1rem", fontWeight: 600, color: themeColors.text, margin: "0 0 6px" }}>
                    No extractable text on page {currentPage}
                  </h3>
                  <p style={{ fontSize: "0.875rem", margin: "0 0 16px" }}>
                    This page may be an image, scan, or blank page.
                  </p>
                  <button
                    type="button"
                    onClick={handleViewModeToggle}
                    style={{
                      background: themeColors.accent,
                      color: "#fff",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: 8,
                      fontSize: "0.8125rem",
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    Switch to Original PDF View
                  </button>
                </div>
              )}
            </article>
          )}

          {/* VIEW MODE 2: Original PDF Canvas View */}
          {activeViewMode === "pdf" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: "100%",
              }}
            >
              {pdfError && (
                <div
                  style={{
                    padding: "24px",
                    textAlign: "center",
                    color: "#d64545",
                    background: themeColors.card,
                    borderRadius: 10,
                    border: `1px solid ${themeColors.border}`,
                    maxWidth: 420,
                  }}
                >
                  <p style={{ fontWeight: 600, margin: "0 0 8px" }}>Could not load PDF view</p>
                  <p style={{ fontSize: "0.8125rem", color: themeColors.textMuted, margin: 0 }}>
                    {pdfError}
                  </p>
                </div>
              )}

              {pdfLoading && !pdfError && (
                <div style={{ padding: 40, textAlign: "center", color: themeColors.textMuted }}>
                  Loading PDF…
                </div>
              )}

              <div
                ref={pageContainerRef}
                style={{
                  position: "relative",
                  boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
                  borderRadius: 6,
                  overflow: "hidden",
                  maxWidth: "100%",
                }}
              >
                <Document
                  file={source.pdfSource}
                  onLoadSuccess={({ numPages }) => {
                    setNumPdfPages(numPages);
                    setPdfLoading(false);
                  }}
                  onLoadError={(err) => {
                    setPdfError(err.message);
                    setPdfLoading(false);
                  }}
                  loading={null}
                >
                  <Page
                    key={`pdf_page_${currentPage}`}
                    pageNumber={currentPage}
                    scale={settings.zoom / 100}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                  />
                </Document>
              </div>
            </div>
          )}
        </main>

        {/* ------------------------------------------------------------------ */}
        {/* Slide-out Notes Panel                                              */}
        {/* ------------------------------------------------------------------ */}
        {notesPanelOpen && (
          <aside
            style={{
              width: 320,
              background: themeColors.toolbar,
              borderLeft: `1px solid ${themeColors.border}`,
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              zIndex: 28,
              boxShadow: "-4px 0 16px rgba(0,0,0,0.06)",
            }}
          >
            {/* Sidebar Header with Tabs */}
            <div
              style={{
                padding: "10px 14px",
                borderBottom: `1px solid ${themeColors.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => setSidebarTab("notes")}
                  style={{
                    background: sidebarTab === "notes" ? themeColors.accentTint : "none",
                    color: sidebarTab === "notes" ? themeColors.accent : themeColors.textMuted,
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 10px",
                    fontSize: "0.8125rem",
                    fontWeight: sidebarTab === "notes" ? 700 : 500,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span>Notes</span>
                  <span
                    style={{
                      background: sidebarTab === "notes" ? themeColors.accent : themeColors.border,
                      color: sidebarTab === "notes" ? "#fff" : themeColors.textMuted,
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 10,
                    }}
                  >
                    {notes.length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setSidebarTab("ai")}
                  style={{
                    background: sidebarTab === "ai" ? themeColors.accentTint : "none",
                    color: sidebarTab === "ai" ? themeColors.accent : themeColors.textMuted,
                    border: "none",
                    borderRadius: 6,
                    padding: "6px 10px",
                    fontSize: "0.8125rem",
                    fontWeight: sidebarTab === "ai" ? 700 : 500,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span>✨ AI</span>
                  {aiState.status === "loading" && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: themeColors.accent,
                        display: "inline-block",
                      }}
                    />
                  )}
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {sidebarTab === "notes" && (
                  <button
                    type="button"
                    onClick={addDraftNote}
                    style={{
                      background: themeColors.accent,
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "5px 9px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    + Note
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setNotesPanelOpen(false)}
                  title="Close panel"
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "1rem",
                    color: themeColors.textMuted,
                    cursor: "pointer",
                    padding: 4,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* TAB 1: Notes List */}
            {sidebarTab === "notes" && (
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {notes.length === 0 ? (
                  <div
                    style={{
                      padding: "48px 12px",
                      textAlign: "center",
                      color: themeColors.textMuted,
                    }}
                  >
                    <div style={{ fontSize: "2rem", marginBottom: 8 }}>📝</div>
                    <p style={{ fontSize: "0.875rem", margin: "0 0 12px" }}>
                      No notes yet. Start typing to add one.
                    </p>
                    <button
                      type="button"
                      onClick={addDraftNote}
                      style={{
                        background: themeColors.btnBg,
                        border: `1px solid ${themeColors.border}`,
                        color: themeColors.text,
                        padding: "6px 14px",
                        borderRadius: 8,
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      + Add first note
                    </button>
                  </div>
                ) : (
                  notes.map((note) => (
                    <div
                      key={note.id}
                      style={{
                        background: themeColors.card,
                        border: `1px solid ${themeColors.border}`,
                        borderRadius: 10,
                        padding: 12,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          fontSize: "0.75rem",
                          color: themeColors.textMuted,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => note.page && goToPage(note.page)}
                          style={{
                            background: "none",
                            border: "none",
                            color: themeColors.accent,
                            fontWeight: 600,
                            cursor: note.page ? "pointer" : "default",
                            padding: 0,
                            fontSize: "0.75rem",
                          }}
                        >
                          {note.page ? `Page ${note.page}` : "General note"}
                        </button>

                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {note.saveStatus === "Saving..." && (
                            <span style={{ color: "#d97706", fontSize: "0.6875rem" }}>
                              Saving…
                            </span>
                          )}
                          {note.saveStatus === "Saved" && (
                            <span style={{ color: "#16a34a", fontSize: "0.6875rem" }}>
                              Saved
                            </span>
                          )}
                          {note.saveStatus === "Failed - retrying" && (
                            <span style={{ color: "#dc2626", fontSize: "0.6875rem" }}>
                              Failed - retrying
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => deleteNote(note.id)}
                            title="Delete note"
                            style={{
                              background: "none",
                              border: "none",
                              color: themeColors.textMuted,
                              cursor: "pointer",
                              fontSize: "0.8125rem",
                              padding: "0 2px",
                            }}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>

                      <textarea
                        value={note.content}
                        onChange={(e) => updateNoteContent(note.id, e.target.value)}
                        onBlur={() => flushNote(note.id)}
                        placeholder="Write your note here…"
                        rows={3}
                        style={{
                          width: "100%",
                          background: themeColors.bg,
                          color: themeColors.text,
                          border: `1px solid ${themeColors.border}`,
                          borderRadius: 6,
                          padding: "8px",
                          fontSize: "0.8125rem",
                          lineHeight: 1.5,
                          resize: "vertical",
                          outline: "none",
                          fontFamily: "inherit",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 2: AI Assistant View */}
            {sidebarTab === "ai" && (
              <div
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {/* Quoted passage card */}
                {aiState.text ? (
                  <div
                    style={{
                      background: themeColors.card,
                      border: `1px solid ${themeColors.border}`,
                      borderLeft: `3px solid ${themeColors.accent}`,
                      borderRadius: 8,
                      padding: "10px 12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.6875rem",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        color: themeColors.accent,
                        letterSpacing: "0.5px",
                      }}
                    >
                      Selected Passage
                    </span>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.8125rem",
                        color: themeColors.textMuted,
                        fontStyle: "italic",
                        lineHeight: 1.4,
                        maxHeight: 100,
                        overflowY: "auto",
                      }}
                    >
                      "{aiState.text}"
                    </p>
                  </div>
                ) : null}

                {/* Level Selector */}
                {aiState.status !== "idle" && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      background: themeColors.card,
                      border: "1px solid " + themeColors.border,
                      borderRadius: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: themeColors.textMuted,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      Level:
                    </span>
                    {(["SIMPLE", "TECHNICAL"] as AiLevel[]).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        disabled={aiState.status === "loading"}
                        onClick={() => {
                          if (lvl !== aiLevel && aiState.action && aiState.text) {
                            setAiLevel(lvl);
                            handleAiAction(aiState.action, aiState.text, lvl);
                          }
                        }}
                        style={{
                          flex: 1,
                          padding: "4px 0",
                          background: lvl === aiLevel ? themeColors.accent : "none",
                          color: lvl === aiLevel ? "#fff" : themeColors.textMuted,
                          border: "1px solid " + (lvl === aiLevel ? themeColors.accent : themeColors.border),
                          borderRadius: 6,
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          cursor: aiState.status === "loading" ? "not-allowed" : "pointer",
                          opacity: aiState.status === "loading" ? 0.5 : 1,
                          textTransform: "capitalize",
                        }}
                      >
                        {lvl === "SIMPLE" ? "Simple" : "Technical"}
                      </button>
                    ))}
                  </div>
                )}

                {/* Loading State */}
                {aiState.status === "loading" && (
                  <div
                    style={{
                      padding: "40px 16px",
                      textAlign: "center",
                      color: themeColors.textMuted,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        border: `3px solid ${themeColors.border}`,
                        borderTop: `3px solid ${themeColors.accent}`,
                        borderRadius: "50%",
                        animation: "spin 0.8s linear infinite",
                      }}
                    />
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                    <div style={{ fontSize: "0.875rem", fontWeight: 600, color: themeColors.text }}>
                      Generating {aiState.action?.toLowerCase()}…
                    </div>
                    <div style={{ fontSize: "0.75rem", color: themeColors.textMuted }}>
                      {"Consulting Groq AI — " + (aiLevel === "SIMPLE" ? "Simple" : "Technical") + " level"}
                    </div>
                  </div>
                )}

                {/* Error State */}
                {aiState.status === "error" && (
                  <div
                    style={{
                      padding: 16,
                      background: "rgba(239, 68, 68, 0.08)",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      borderRadius: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        color: "#dc2626",
                        fontWeight: 600,
                        fontSize: "0.875rem",
                      }}
                    >
                      <span>⚠️</span> Request Failed
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.8125rem",
                        color: themeColors.text,
                        lineHeight: 1.45,
                      }}
                    >
                      {aiState.error || "Failed to generate AI response. Please try again."}
                    </p>
                    {aiState.action && aiState.text && (
                      <button
                        type="button"
                        onClick={() => handleAiAction(aiState.action!, aiState.text)}
                        style={{
                          alignSelf: "flex-start",
                          background: themeColors.accent,
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 12px",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        ↻ Try Again
                      </button>
                    )}
                  </div>
                )}

                {/* Success State */}
                {aiState.status === "success" && (
                  <div
                    style={{
                      background: themeColors.card,
                      border: `1px solid ${themeColors.border}`,
                      borderRadius: 10,
                      padding: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        borderBottom: `1px solid ${themeColors.border}`,
                        paddingBottom: 8,
                      }}
                    >
                      <span
                        style={{
                          background: themeColors.accentTint,
                          color: themeColors.accent,
                          fontSize: "0.6875rem",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 4,
                          letterSpacing: "0.5px",
                        }}
                      >
                        {aiState.action} ({aiLevel})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (aiState.answer) {
                            navigator.clipboard.writeText(aiState.answer);
                            showToast("Copied to clipboard!");
                          }
                        }}
                        title="Copy answer"
                        style={{
                          background: "none",
                          border: `1px solid ${themeColors.border}`,
                          borderRadius: 6,
                          color: themeColors.textMuted,
                          padding: "3px 8px",
                          fontSize: "0.75rem",
                          cursor: "pointer",
                        }}
                      >
                        📋 Copy
                      </button>
                    </div>

                    <div
                      style={{
                        fontSize: "0.875rem",
                        lineHeight: 1.6,
                        color: themeColors.text,
                        whiteSpace: "pre-wrap",
                        maxHeight: "calc(100vh - 360px)",
                        overflowY: "auto",
                      }}
                    >
                      {aiState.answer}
                    </div>
                  </div>
                )}

                {/* Idle State */}
                {aiState.status === "idle" && (
                  <div
                    style={{
                      padding: "48px 16px",
                      textAlign: "center",
                      color: themeColors.textMuted,
                    }}
                  >
                    <div style={{ fontSize: "2.25rem", marginBottom: 12 }}>✨</div>
                    <h4
                      style={{
                        margin: "0 0 8px",
                        color: themeColors.text,
                        fontSize: "0.9375rem",
                        fontWeight: 600,
                      }}
                    >
                      ReadAble AI Assistant
                    </h4>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "0.8125rem",
                        lineHeight: 1.5,
                      }}
                    >
                      Select any text passage in the document, then click <strong>Explain</strong>, <strong>Summarize</strong>, or <strong>Define</strong> from the popup menu.
                    </p>
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* Bottom Progress Bar & Reader Status                                  */}
      {/* -------------------------------------------------------------------- */}
      <footer
        style={{
          height: 48,
          background: themeColors.toolbar,
          borderTop: `1px solid ${themeColors.border}`,
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 25,
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: themeColors.textMuted,
            minWidth: 34,
          }}
        >
          {progressPercentage}%
        </span>

        {/* Progress Bar Track */}
        <div
          role="progressbar"
          aria-valuenow={progressPercentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Document Reading Progress"
          style={{
            flex: 1,
            height: 6,
            background: themeColors.border,
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPercentage}%`,
              background: themeColors.accent,
              borderRadius: 4,
              transition: "width 0.3s ease",
            }}
          />
        </div>

        <span
          style={{
            fontSize: "0.75rem",
            color: themeColors.textMuted,
            whiteSpace: "nowrap",
          }}
        >
          Page {currentPage} of {totalPages}
        </span>
      </footer>

      {/* Delete Document Confirmation Dialog (Requirement 3) */}
      {deleteDialogOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.55)",
            backdropFilter: "blur(3px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 110,
            padding: 16,
          }}
          onClick={() => !deletingDoc && setDeleteDialogOpen(false)}
        >
          <div
            style={{
              background: themeColors.card,
              border: `1px solid ${themeColors.cardBorder}`,
              borderRadius: 14,
              padding: "24px 28px",
              maxWidth: 460,
              width: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
              color: themeColors.text,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: "0 0 10px",
                fontSize: "1.125rem",
                fontWeight: 600,
                color: themeColors.text,
              }}
            >
              Delete '{source.title}'?
            </h3>
            <p
              style={{
                margin: "0 0 24px",
                fontSize: "0.875rem",
                color: themeColors.textMuted,
                lineHeight: 1.5,
              }}
            >
              This permanently removes the file, your bookmark, notes and highlights.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                disabled={deletingDoc}
                onClick={() => setDeleteDialogOpen(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: `1px solid ${themeColors.border}`,
                  background: themeColors.btnBg,
                  color: themeColors.text,
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  cursor: deletingDoc ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingDoc}
                onClick={handleDeleteCurrentDocument}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "#dc2626",
                  color: "#fff",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: deletingDoc ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {deletingDoc ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating AI Assistant Dropdown on Text Selection */}
      {aiDropdown && (
        <div
          ref={aiDropdownRef}
          style={{
            position: "fixed",
            top: aiDropdown.top,
            left: aiDropdown.left,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            gap: 2,
            background: themeColors.toolbar,
            border: `1px solid ${themeColors.border}`,
            borderRadius: 8,
            padding: "4px 6px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            userSelect: "none",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => handleAiAction("EXPLAIN", aiDropdown.text)}
            title="Explain this text with AI"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "none",
              border: "none",
              color: themeColors.text,
              padding: "5px 9px",
              borderRadius: 6,
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = themeColors.accentTint)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            <span>💡</span> Explain
          </button>

          <div style={{ width: 1, height: 16, background: themeColors.border }} />

          <button
            type="button"
            onClick={() => handleAiAction("SUMMARIZE", aiDropdown.text)}
            title="Summarize this text with AI"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "none",
              border: "none",
              color: themeColors.text,
              padding: "5px 9px",
              borderRadius: 6,
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = themeColors.accentTint)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            <span>📝</span> Summarize
          </button>

          <div style={{ width: 1, height: 16, background: themeColors.border }} />

          <button
            type="button"
            onClick={() => handleAiAction("DEFINE", aiDropdown.text)}
            title="Define key terms in this text with AI"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "none",
              border: "none",
              color: themeColors.text,
              padding: "5px 9px",
              borderRadius: 6,
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = themeColors.accentTint)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            <span>📖</span> Define
          </button>
        </div>
      )}

      {/* Reader Toast Notification */}
      {toastVisible && (
        <div
          style={{
            position: "fixed",
            bottom: 60,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#18181b",
            color: "#fafafa",
            padding: "10px 18px",
            borderRadius: 8,
            fontSize: "0.8125rem",
            fontWeight: 500,
            boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
            zIndex: 100,
            pointerEvents: "none",
          }}
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
