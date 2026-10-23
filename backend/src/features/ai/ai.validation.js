import { ValidationError } from "../../shared/utils/errors.js";

const VALID_ACTIONS = ["EXPLAIN", "SUMMARIZE", "DEFINE"];
const VALID_LEVELS = ["SIMPLE", "INTERMEDIATE", "TECHNICAL"];
const MAX_TEXT_LENGTH = 5000;

/**
 * Validates AI query request payload.
 *
 * @param {Object} body
 * @param {string} body.action - EXPLAIN | SUMMARIZE | DEFINE
 * @param {string} body.level - SIMPLE | INTERMEDIATE | TECHNICAL
 * @param {string} body.text - Selected passage text (max 5000 chars)
 * @returns {{ action: string, level: string, text: string }}
 */
export const validateAiQuery = (body = {}) => {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Request body is required");
  }

  const { action, level, text } = body;

  if (!action || typeof action !== "string") {
    throw new ValidationError("Action is required and must be a string");
  }

  const normalizedAction = action.trim().toUpperCase();
  if (!VALID_ACTIONS.includes(normalizedAction)) {
    throw new ValidationError(
      `Invalid action '${action}'. Supported actions: ${VALID_ACTIONS.join(", ")}`
    );
  }

  if (!level || typeof level !== "string") {
    throw new ValidationError("Level is required and must be a string");
  }

  const normalizedLevel = level.trim().toUpperCase();
  if (!VALID_LEVELS.includes(normalizedLevel)) {
    throw new ValidationError(
      `Invalid level '${level}'. Supported levels: ${VALID_LEVELS.join(", ")}`
    );
  }

  if (!text || typeof text !== "string") {
    throw new ValidationError("Text is required and must be a non-empty string");
  }

  const trimmedText = text.trim();
  if (trimmedText.length === 0) {
    throw new ValidationError("Text cannot be empty or contain only whitespace");
  }

  if (trimmedText.length > MAX_TEXT_LENGTH) {
    throw new ValidationError(
      `Text length exceeds maximum allowed limit of ${MAX_TEXT_LENGTH} characters (received ${trimmedText.length})`
    );
  }

  return {
    action: normalizedAction,
    level: normalizedLevel,
    text: trimmedText,
  };
};
