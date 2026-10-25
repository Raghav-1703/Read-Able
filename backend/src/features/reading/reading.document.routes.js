/**
 * reading.document.routes.js
 *
 * Per-document reading routes mounted under /api/documents/:documentId
 */

import { Router } from "express";
import {
  getReading,
  saveProgress,
  resetProgress,
  createNote,
  updateNote,
  deleteNote,
  createHighlight,
  updateHighlight,
  deleteHighlight,
  deleteHighlights,
} from "./reading.controller.js";

const router = Router({ mergeParams: true });

router.get("/reading", getReading);
router.put("/progress", saveProgress);
router.post("/progress/reset", resetProgress);
router.delete("/progress", resetProgress);

router.post("/notes", createNote);
router.patch("/notes/:id", updateNote);
router.delete("/notes/:id", deleteNote);

router.post("/highlights", createHighlight);
router.patch("/highlights/:id", updateHighlight);
router.delete("/highlights", deleteHighlights);
router.delete("/highlights/:id", deleteHighlight);

export default router;
