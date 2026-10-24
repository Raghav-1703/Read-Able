import Groq from "groq-sdk";
import { config } from "../../config/env.js";
import { AppError } from "../../shared/utils/errors.js";

const ACTION_INSTRUCTIONS = {
  EXPLAIN:
    "Explain the provided text clearly, elaborating on its underlying meaning, context, and significance to help the reader comprehend it fully.",
  SUMMARIZE:
    "Provide a concise, well-structured summary capturing the core arguments, essential points, and main takeaways of the provided text.",
  DEFINE:
    "Identify and clearly define the key terms, technical concepts, or specialized vocabulary present in the provided text.",
};

const LEVEL_INSTRUCTIONS = {
  SIMPLE:
    "Audience & Style: Beginner / general reader. Use plain, everyday language and short sentences. Break down ideas with real-world analogies and concrete examples. Avoid all jargon; if a term is unavoidable, define it immediately in simple words. The goal is that a curious teenager could read this and fully understand it.",
  TECHNICAL:
    "Audience & Style: Advanced practitioner or domain specialist. Use precise technical terminology without softening. Provide rigorous reasoning, relevant edge cases, formal definitions where appropriate, and technical depth that a professional in the field would expect. Avoid over-simplifying.",
};

/**
 * Builds system prompt based on selected action and level.
 *
 * @param {string} action
 * @param {string} level
 * @returns {string}
 */
export const buildSystemPrompt = (action, level) => {
  const actionInstruction = ACTION_INSTRUCTIONS[action] || ACTION_INSTRUCTIONS.EXPLAIN;
  const levelInstruction = LEVEL_INSTRUCTIONS[level] || LEVEL_INSTRUCTIONS.SIMPLE;

  return [
    "You are ReadAble's AI Reading Assistant, designed to help readers understand, learn from, and engage with documents.",
    "",
    `TASK: ${actionInstruction}`,
    "",
    `DIFFICULTY LEVEL: ${levelInstruction}`,
    "",
    "GUIDELINES:",
    "- Focus directly on answering the reader's request accurately and thoroughly based on the passage provided.",
    "- Do not include conversational filler (e.g. 'Sure, here is an explanation' or 'As an AI model...').",
    "- Format the output cleanly with clear paragraphs or bullet points where appropriate.",
  ].join("\n");
};

/**
 * Builds user prompt containing the selected passage.
 *
 * @param {string} action
 * @param {string} level
 * @param {string} text
 * @returns {string}
 */
export const buildUserPrompt = (action, level, text) => {
  return [
    `Please ${action.toLowerCase()} the following passage at a ${level.toLowerCase()} level:`,
    "",
    "--- BEGIN PASSAGE ---",
    text,
    "--- END PASSAGE ---",
  ].join("\n");
};

/**
 * Instantiates the Groq client.
 *
 * @returns {Groq}
 */
export const getGroqClient = () => {
  if (!config.groqApiKey) {
    throw new AppError(
      "AI Assistant is not configured on the server (missing GROQ_API_KEY)",
      503
    );
  }

  return new Groq({ apiKey: config.groqApiKey });
};

/**
 * Processes an AI query on a document passage using Groq.
 *
 * @param {Object} params
 * @param {string} params.action - EXPLAIN | SUMMARIZE | DEFINE
 * @param {string} params.level - SIMPLE | TECHNICAL
 * @param {string} params.text - Passage text
 * @param {Object} [options]
 * @param {Groq} [options.client] - Optional client override for testing
 * @returns {Promise<{ answer: string, action: string, level: string, model: string }>}
 */
export const processAiQuery = async (
  { action, level, text },
  options = {}
) => {
  const client = options.client || getGroqClient();
  const model = config.groqModel || "openai/gpt-oss-120b";

  const systemPrompt = buildSystemPrompt(action, level);
  const userPrompt = buildUserPrompt(action, level, text);

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() || "";

    if (!answer) {
      throw new AppError("AI provider returned an empty response", 502);
    }

    return {
      answer,
      action,
      level,
      model,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }

    // Handle Groq SDK specific errors
    const status = err.status || err.statusCode;
    const message = err.message || "Unknown provider error";

    if (status === 429) {
      throw new AppError(
        "Groq API rate limit exceeded. Please wait a moment before trying again.",
        429
      );
    }

    if (status === 401 || status === 403) {
      throw new AppError(
        "AI provider authentication failed. Please verify the server configuration.",
        503
      );
    }

    if (status === 400) {
      throw new AppError(`Invalid request sent to AI provider: ${message}`, 400);
    }

    if (status >= 500 && status < 600) {
      throw new AppError(
        "AI provider service is currently unavailable. Please try again later.",
        503
      );
    }

    throw new AppError(`AI Assistant query failed: ${message}`, 500);
  }
};

const aiService = {
  buildSystemPrompt,
  buildUserPrompt,
  getGroqClient,
  processAiQuery,
};

export default aiService;
