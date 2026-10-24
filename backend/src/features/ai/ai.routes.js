import { Router } from "express";
import { queryDocumentAi } from "./ai.controller.js";

const router = Router({ mergeParams: true });

// POST /api/documents/:id/ai/query
router.post("/query", queryDocumentAi);

export default router;
