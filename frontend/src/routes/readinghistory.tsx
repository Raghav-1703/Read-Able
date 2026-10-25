/**
 * readinghistory.tsx
 *
 * Standalone Reading History Route — /readinghistory
 * Displays reading progress for each document:
 * - Circular reading-progress percentage indicator
 * - Document title and file name
 * - Page progress: furthestPage / totalPages (when available)
 * - Resume button navigating to the saved reading position (?page=N)
 * - Reset Progress button resetting to page 1 and 0%
 *
 * Refetches on tab focus to stay in sync with reader sessions.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createFileRoute, redirect, useNavigate, Link } from "@tanstack/react-router";
import { readingApi, documentApi, type BookmarkDocumentItem, type DocumentItem } from "@/lib/api";
import {
  History,
  ArrowLeft,
  Upload,
  Play,
  RotateCcw,
  Loader2,
  BookOpen,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/readinghistory")({
  beforeLoad: () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("readable_token") : null;
    if (!token) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: "Reading History — ReadAble" },
      {
        name: "description",
        content: "Track your reading progress, resume reading, and review all documents in your library.",
      },
    ],
  }),
  component: ReadingHistoryPage,
});

export interface ReadingHistoryItem {
  documentId: number;
  title: string;
  fileName: string;
  lastPage: number;
  furthestPage: number;
  totalPages: number | null;
  percentage: number;
  updatedAt: string;
  hasProgressRecord: boolean;
}

function formatTimeAgo(dateString?: string): string {
  if (!dateString) return "Never read";
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (isNaN(diffSec) || diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Circular progress ring SVG component
 */
function CircularProgress({ percentage }: { percentage: number }) {
  const safePct = Math.min(100, Math.max(0, Math.round(percentage || 0)));
  const size = 52;
  const strokeWidth = 4;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (safePct / 100) * circumference;

  const isComplete = safePct === 100;
  const strokeColor = isComplete ? "#059669" : safePct > 0 ? "#2B8272" : "#9CA3AF";

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
      title={`${safePct}% complete`}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#E7E2DA"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Animated Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          style={{ transition: "stroke-dashoffset 0.35s ease, stroke 0.35s ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          fontSize: "0.6875rem",
          fontWeight: 700,
          color: isComplete ? "#059669" : "#1D2321",
          textAlign: "center",
          lineHeight: 1,
        }}
      >
        {isComplete ? (
          <CheckCircle2 size={16} color="#059669" />
        ) : (
          `${safePct}%`
        )}
      </div>
    </div>
  );
}

function ReadingHistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ReadingHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [resettingId, setResettingId] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2500);
  }, []);

  const fetchReadingHistory = useCallback(async () => {
    try {
      // Fetch both user documents and bookmark/progress items in parallel
      const [docsRes, bookmarksRes] = await Promise.all([
        documentApi.getAll().catch(() => null),
        readingApi.getBookmarks().catch(() => null),
      ]);

      const allDocs: DocumentItem[] = docsRes?.data?.data || [];
      const bookmarks: BookmarkDocumentItem[] = bookmarksRes?.data?.data || [];

      // Map progress by documentId
      const progressMap = new Map<number, BookmarkDocumentItem>();
      bookmarks.forEach((b) => {
        progressMap.set(b.documentId, b);
      });

      // Build unified reading history list
      const combinedItems: ReadingHistoryItem[] = allDocs.map((doc) => {
        const prog = progressMap.get(doc.id);
        if (prog) {
          const furthest = prog.furthestPage ?? (prog.lastPage && prog.lastPage >= 1 ? prog.lastPage : 0);
          const total = prog.totalPages ?? null;
          const pct =
            prog.percentage !== undefined
              ? prog.percentage
              : total && total > 0
              ? Math.min(100, Math.max(0, Math.round((furthest / total) * 100)))
              : 0;

          return {
            documentId: doc.id,
            title: doc.title,
            fileName: doc.fileName,
            lastPage: prog.lastPage && prog.lastPage >= 1 ? prog.lastPage : 1,
            furthestPage: furthest,
            totalPages: total,
            percentage: pct,
            updatedAt: prog.updatedAt || doc.updatedAt,
            hasProgressRecord: true,
          };
        }

        // Unopened document
        return {
          documentId: doc.id,
          title: doc.title,
          fileName: doc.fileName,
          lastPage: 1,
          furthestPage: 0,
          totalPages: null,
          percentage: 0,
          updatedAt: doc.lastUploadedAt || doc.createdAt,
          hasProgressRecord: false,
        };
      });

      // Sort: Most recently updated/read first
      combinedItems.sort((a, b) => {
        const timeA = new Date(a.updatedAt).getTime() || 0;
        const timeB = new Date(b.updatedAt).getTime() || 0;
        return timeB - timeA;
      });

      setItems(combinedItems);
      setError(null);
    } catch {
      setError("Failed to load reading history. Please refresh the page.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReadingHistory();
  }, [fetchReadingHistory]);

  // Refetch when tab regains focus or visibility
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchReadingHistory();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", fetchReadingHistory);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", fetchReadingHistory);
    };
  }, [fetchReadingHistory]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      await documentApi.upload(file, file.name.replace(/\.[^/.]+$/, ""));
      showToast("Document uploaded successfully");
      await fetchReadingHistory();
    } catch {
      showToast("Failed to upload document.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleResume = (item: ReadingHistoryItem) => {
    const pageToOpen = item.lastPage && item.lastPage >= 1 ? item.lastPage : 1;
    navigate({
      to: "/documents/$id/read",
      params: { id: String(item.documentId) },
      search: { page: pageToOpen },
    });
  };

  const handleResetProgress = async (item: ReadingHistoryItem) => {
    // If it's an unopened document that has no record and is already at 0%
    if (!item.hasProgressRecord && item.percentage === 0 && item.furthestPage === 0) {
      showToast(`Reading progress is already at 0% for "${item.title}"`);
      return;
    }

    try {
      setResettingId(item.documentId);
      const res = await readingApi.resetProgress(item.documentId);

      if (res.data?.success) {
        // Immediately update local state to 0% and page 1
        setItems((prev) =>
          prev.map((it) =>
            it.documentId === item.documentId
              ? {
                  ...it,
                  lastPage: 1,
                  furthestPage: 0,
                  percentage: 0,
                  updatedAt: new Date().toISOString(),
                  hasProgressRecord: true,
                }
              : it
          )
        );
        showToast(`Progress reset to 0% for "${item.title}"`);
      }
    } catch {
      showToast("Failed to reset progress. Please try again.");
    } finally {
      setResettingId(null);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#FAF8F5",
        color: "#1D2321",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        style={{ display: "none" }}
        onChange={handleFileSelected}
      />

      {/* Top Navbar */}
      <header
        style={{
          borderBottom: "1px solid #E7E2DA",
          background: "#FFFFFF",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Link
            to="/dashboard"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#2B8272",
              textDecoration: "none",
              fontSize: "0.875rem",
              fontWeight: 500,
              background: "#F0EDE6",
              padding: "6px 12px",
              borderRadius: 8,
            }}
          >
            <ArrowLeft size={16} />
            <span>Dashboard</span>
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "rgba(43,130,114,0.1)",
                color: "#2B8272",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <History size={18} />
            </div>
            <h1 style={{ fontSize: "1.125rem", fontWeight: 700, margin: 0 }}>
              Reading History
            </h1>
          </div>
        </div>

        <button
          onClick={handleUploadClick}
          disabled={uploading}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "#2B8272",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: "0.8125rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          <span>Upload Document</span>
        </button>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px 60px" }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 6px" }}>
            Reading History
          </h2>
          <p style={{ color: "#66706D", fontSize: "0.875rem", margin: 0 }}>
            Track highest page reached, overall completion percentage, and resume or reset your reading.
          </p>
        </div>

        {/* Loading State */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#66706D" }}>
            <div
              style={{
                width: 32,
                height: 32,
                border: "3px solid #ddd",
                borderTop: "3px solid #2B8272",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                margin: "0 auto 12px",
              }}
            />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            Loading reading history…
          </div>
        ) : error ? (
          /* Error State */
          <div
            style={{
              padding: 24,
              background: "#FFF",
              border: "1px solid #E7E2DA",
              borderRadius: 12,
              textAlign: "center",
              color: "#DC2626",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}>
              <AlertCircle size={18} />
              <span style={{ fontWeight: 600 }}>{error}</span>
            </div>
            <button
              onClick={() => fetchReadingHistory()}
              style={{
                background: "#2B8272",
                color: "#FFF",
                border: "none",
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: "pointer",
                marginTop: 8,
              }}
            >
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          /* Empty State */
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #E7E2DA",
              borderRadius: 14,
              padding: "48px 24px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: "rgba(43,130,114,0.1)",
                color: "#2B8272",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              <History size={28} />
            </div>
            <h3 style={{ fontSize: "1.125rem", fontWeight: 600, margin: "0 0 8px" }}>
              No reading history yet
            </h3>
            <p style={{ color: "#66706D", fontSize: "0.875rem", maxWidth: 420, margin: "0 auto 20px" }}>
              Open a document from My Library to start reading and tracking progress.
            </p>
            <Link
              to="/dashboard"
              style={{
                background: "#2B8272",
                color: "#FFFFFF",
                textDecoration: "none",
                borderRadius: 8,
                padding: "10px 20px",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <BookOpen size={16} />
              <span>Go to My Library</span>
            </Link>
          </div>
        ) : (
          /* Document Reading History Cards List */
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {items.map((item) => {
              const isResetting = resettingId === item.documentId;
              const hasPages = item.totalPages && item.totalPages > 0;
              const isUnopened = !item.hasProgressRecord && item.percentage === 0 && item.furthestPage === 0;

              return (
                <div
                  key={item.documentId}
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #E7E2DA",
                    borderRadius: 12,
                    padding: "18px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.02)",
                    flexWrap: "wrap",
                  }}
                >
                  {/* Left: Circular Progress Ring & Document Info */}
                  <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 260, flex: "1 1 auto" }}>
                    <CircularProgress percentage={item.percentage} />

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h4
                        style={{
                          fontSize: "0.9375rem",
                          fontWeight: 600,
                          margin: "0 0 4px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={item.title}
                      >
                        {item.title}
                      </h4>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          fontSize: "0.8125rem",
                          color: "#66706D",
                          flexWrap: "wrap",
                        }}
                      >
                        {/* Page progress furthest / total */}
                        {hasPages ? (
                          <span
                            style={{
                              fontWeight: 600,
                              color: item.percentage === 100 ? "#059669" : "#2B8272",
                              background: item.percentage === 100 ? "rgba(5,150,105,0.08)" : "rgba(43,130,114,0.08)",
                              padding: "2px 8px",
                              borderRadius: 6,
                            }}
                          >
                            Page {item.furthestPage} of {item.totalPages}
                          </span>
                        ) : item.furthestPage > 0 ? (
                          <span
                            style={{
                              fontWeight: 600,
                              color: "#2B8272",
                              background: "rgba(43,130,114,0.08)",
                              padding: "2px 8px",
                              borderRadius: 6,
                            }}
                          >
                            Reached Page {item.furthestPage}
                          </span>
                        ) : (
                          <span
                            style={{
                              fontWeight: 500,
                              color: "#6B7280",
                              background: "#F3F4F6",
                              padding: "2px 8px",
                              borderRadius: 6,
                            }}
                          >
                            Not started
                          </span>
                        )}

                        {item.lastPage > 1 && (
                          <>
                            <span>•</span>
                            <span style={{ fontSize: "0.75rem", color: "#66706D" }}>
                              Resume on p. {item.lastPage}
                            </span>
                          </>
                        )}

                        <span>•</span>
                        <span style={{ fontSize: "0.75rem" }}>
                          Last read: {formatTimeAgo(item.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Resume & Reset Progress Buttons */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    {/* Reset Progress Button */}
                    <button
                      type="button"
                      onClick={() => handleResetProgress(item)}
                      disabled={isResetting || (item.percentage === 0 && item.furthestPage === 0 && item.lastPage <= 1)}
                      title={
                        item.percentage === 0 && item.furthestPage === 0 && item.lastPage <= 1
                          ? "Progress already at 0%"
                          : `Reset progress for '${item.title}'`
                      }
                      style={{
                        background: "#F9FAFB",
                        color:
                          item.percentage === 0 && item.furthestPage === 0 && item.lastPage <= 1
                            ? "#9CA3AF"
                            : "#4B5563",
                        border: "1px solid #E5E7EB",
                        borderRadius: 8,
                        padding: "8px 14px",
                        fontSize: "0.8125rem",
                        fontWeight: 500,
                        cursor:
                          item.percentage === 0 && item.furthestPage === 0 && item.lastPage <= 1
                            ? "default"
                            : isResetting
                            ? "wait"
                            : "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        if (!(item.percentage === 0 && item.furthestPage === 0 && item.lastPage <= 1)) {
                          e.currentTarget.style.color = "#DC2626";
                          e.currentTarget.style.borderColor = "#FCA5A5";
                          e.currentTarget.style.background = "#FEF2F2";
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color =
                          item.percentage === 0 && item.furthestPage === 0 && item.lastPage <= 1
                            ? "#9CA3AF"
                            : "#4B5563";
                        e.currentTarget.style.borderColor = "#E5E7EB";
                        e.currentTarget.style.background = "#F9FAFB";
                      }}
                    >
                      {isResetting ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <RotateCcw size={13} />
                      )}
                      <span>Reset</span>
                    </button>

                    {/* Resume Button */}
                    <button
                      type="button"
                      onClick={() => handleResume(item)}
                      style={{
                        background: "#2B8272",
                        color: "#FFFFFF",
                        border: "none",
                        borderRadius: 8,
                        padding: "8px 18px",
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        boxShadow: "0 1px 3px rgba(43,130,114,0.2)",
                      }}
                    >
                      <Play size={12} fill="currentColor" />
                      <span>{isUnopened ? "Start" : "Resume"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Floating Toast notification */}
      {toastMsg && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1D2321",
            color: "#FFFFFF",
            padding: "10px 20px",
            borderRadius: 8,
            fontSize: "0.8125rem",
            fontWeight: 500,
            boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
            zIndex: 100,
            animation: "fadeIn 0.2s ease-out",
          }}
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
