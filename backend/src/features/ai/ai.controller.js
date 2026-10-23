import { validateAiQuery } from "./ai.validation.js";
import { processAiQuery } from "./ai.service.js";
import { verifyDocumentOwnership } from "../reading/reading.service.js";
import { sendSuccess } from "../../shared/utils/response.js";
import { ValidationError } from "../../shared/utils/errors.js";

/**
 * Handles AI query requests for a document passage.
 *
 * Route: POST /api/documents/:id/ai/query
 */
export const queryDocumentAi = async (req, res, next) => {
  try {
    const rawId = req.params.id || req.params.documentId;
    const documentId = parseInt(rawId, 10);

    if (isNaN(documentId) || documentId <= 0) {
      throw new ValidationError("Invalid document ID");
    }

    // Enforce JWT authentication & verify document ownership
    await verifyDocumentOwnership(documentId, req.user.id);

    // Validate request body
    const validatedData = validateAiQuery(req.body);

    // Process query via Groq
    const result = await processAiQuery(validatedData);

    return sendSuccess(
      res,
      {
        documentId,
        answer: result.answer,
        result: result.answer,
        action: result.action,
        level: result.level,
        model: result.model,
      },
      "AI response generated successfully",
      200
    );
  } catch (err) {
    next(err);
  }
};
