import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAiQuery } from "../src/features/ai/ai.validation.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  processAiQuery,
} from "../src/features/ai/ai.service.js";
import { ValidationError, AppError } from "../src/shared/utils/errors.js";

describe("AI Assistant — Phase 1: Backend Groq Integration", () => {
  // ---------------------------------------------------------------------------
  // 1. Validation Tests
  // ---------------------------------------------------------------------------
  describe("Payload Validation (validateAiQuery)", () => {
    it("accepts valid inputs with EXPLAIN and SIMPLE", () => {
      const result = validateAiQuery({
        action: "EXPLAIN",
        level: "SIMPLE",
        text: "Quantum computing uses qubits instead of classical bits.",
      });

      assert.equal(result.action, "EXPLAIN");
      assert.equal(result.level, "SIMPLE");
      assert.equal(
        result.text,
        "Quantum computing uses qubits instead of classical bits."
      );
    });

    it("normalizes lowercase and whitespace in action and level", () => {
      const result = validateAiQuery({
        action: "  summarize  ",
        level: "  technical  ",
        text: "  Some technical paragraph here.  ",
      });

      assert.equal(result.action, "SUMMARIZE");
      assert.equal(result.level, "TECHNICAL");
      assert.equal(result.text, "Some technical paragraph here.");
    });

    it("accepts DEFINE action and TECHNICAL level", () => {
      const result = validateAiQuery({
        action: "DEFINE",
        level: "TECHNICAL",
        text: "Photosynthesis is the process used by plants.",
      });

      assert.equal(result.action, "DEFINE");
      assert.equal(result.level, "TECHNICAL");
    });

    it("rejects INTERMEDIATE level", () => {
      assert.throws(
        () =>
          validateAiQuery({
            action: "EXPLAIN",
            level: "INTERMEDIATE",
            text: "Some passage here.",
          }),
        (err) => err instanceof ValidationError && err.statusCode === 400
      );
    });

    it("accepts all three actions with SIMPLE level", () => {
      for (const action of ["EXPLAIN", "SUMMARIZE", "DEFINE"]) {
        const result = validateAiQuery({ action, level: "SIMPLE", text: "Test passage." });
        assert.equal(result.action, action);
        assert.equal(result.level, "SIMPLE");
      }
    });

    it("accepts all three actions with TECHNICAL level", () => {
      for (const action of ["EXPLAIN", "SUMMARIZE", "DEFINE"]) {
        const result = validateAiQuery({ action, level: "TECHNICAL", text: "Test passage." });
        assert.equal(result.action, action);
        assert.equal(result.level, "TECHNICAL");
      }
    });

    it("rejects unsupported action", () => {
      assert.throws(
        () =>
          validateAiQuery({
            action: "TRANSLATE",
            level: "SIMPLE",
            text: "Hello world",
          }),
        (err) => err instanceof ValidationError && err.statusCode === 400
      );
    });

    it("rejects unsupported level", () => {
      assert.throws(
        () =>
          validateAiQuery({
            action: "EXPLAIN",
            level: "GENIUS",
            text: "Hello world",
          }),
        (err) => err instanceof ValidationError && err.statusCode === 400
      );
    });

    it("rejects missing or empty text", () => {
      assert.throws(
        () =>
          validateAiQuery({
            action: "EXPLAIN",
            level: "SIMPLE",
            text: "   ",
          }),
        (err) => err instanceof ValidationError && err.statusCode === 400
      );
    });

    it("rejects text exceeding 5,000 characters", () => {
      const longText = "a".repeat(5001);
      assert.throws(
        () =>
          validateAiQuery({
            action: "EXPLAIN",
            level: "SIMPLE",
            text: longText,
          }),
        (err) =>
          err instanceof ValidationError &&
          err.statusCode === 400 &&
          err.message.includes("exceeds maximum allowed limit")
      );
    });

    it("accepts text of exactly 5,000 characters", () => {
      const maxText = "a".repeat(5000);
      const result = validateAiQuery({
        action: "EXPLAIN",
        level: "SIMPLE",
        text: maxText,
      });
      assert.equal(result.text.length, 5000);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Prompt Builder Tests
  // ---------------------------------------------------------------------------
  describe("Prompt Construction", () => {
    it("builds appropriate system prompt for DEFINE and TECHNICAL", () => {
      const prompt = buildSystemPrompt("DEFINE", "TECHNICAL");
      assert.ok(prompt.toLowerCase().includes("identify and clearly define"));
      assert.ok(prompt.toLowerCase().includes("technical") || prompt.includes("Advanced") || prompt.includes("specialist") || prompt.includes("rigorous"));
    });

    it("builds appropriate system prompt for SUMMARIZE and SIMPLE", () => {
      const prompt = buildSystemPrompt("SUMMARIZE", "SIMPLE");
      assert.ok(prompt.includes("Provide a concise, well-structured summary"));
      assert.ok(prompt.toLowerCase().includes("beginner") || prompt.toLowerCase().includes("plain") || prompt.toLowerCase().includes("everyday"));
    });

    it("SIMPLE and TECHNICAL prompts are meaningfully different", () => {
      const simplePrompt = buildSystemPrompt("EXPLAIN", "SIMPLE");
      const techPrompt = buildSystemPrompt("EXPLAIN", "TECHNICAL");
      assert.notEqual(simplePrompt, techPrompt);
      // SIMPLE should emphasize plain language
      assert.ok(simplePrompt.toLowerCase().includes("plain") || simplePrompt.toLowerCase().includes("beginner") || simplePrompt.toLowerCase().includes("everyday"));
      // TECHNICAL should emphasize precision
      assert.ok(techPrompt.toLowerCase().includes("technical") || techPrompt.toLowerCase().includes("rigorous") || techPrompt.toLowerCase().includes("specialist") || techPrompt.toLowerCase().includes("precise"));
    });

    it("wraps user text with clear passage boundaries", () => {
      const userPrompt = buildUserPrompt("EXPLAIN", "SIMPLE", "Photosynthesis is...");
      assert.ok(userPrompt.includes("--- BEGIN PASSAGE ---"));
      assert.ok(userPrompt.includes("Photosynthesis is..."));
      assert.ok(userPrompt.includes("--- END PASSAGE ---"));
    });

    it("all three actions produce distinct action prompts at both levels", () => {
      for (const level of ["SIMPLE", "TECHNICAL"]) {
        const prompts = ["EXPLAIN", "SUMMARIZE", "DEFINE"].map((a) => buildSystemPrompt(a, level));
        assert.notEqual(prompts[0], prompts[1]);
        assert.notEqual(prompts[1], prompts[2]);
        assert.notEqual(prompts[0], prompts[2]);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Service Execution with Mocked Groq Client
  // ---------------------------------------------------------------------------
  describe("AI Service (processAiQuery)", () => {
    it("processes valid query and returns expected response structure", async () => {
      const mockClient = {
        chat: {
          completions: {
            create: async (params) => {
              assert.ok(params.model);
              assert.equal(params.messages.length, 2);
              assert.equal(params.messages[0].role, "system");
              assert.equal(params.messages[1].role, "user");
              return {
                choices: [
                  {
                    message: {
                      content: "This is a simple explanation of the concept.",
                    },
                  },
                ],
              };
            },
          },
        },
      };

      const result = await processAiQuery(
        {
          action: "EXPLAIN",
          level: "SIMPLE",
          text: "Quantum superposition allows particles to exist in multiple states.",
        },
        { client: mockClient }
      );

      assert.equal(result.answer, "This is a simple explanation of the concept.");
      assert.equal(result.action, "EXPLAIN");
      assert.equal(result.level, "SIMPLE");
      assert.ok(result.model);
    });

    it("handles rate limit error (429) cleanly", async () => {
      const mockClient = {
        chat: {
          completions: {
            create: async () => {
              const err = new Error("Rate limit reached");
              err.status = 429;
              throw err;
            },
          },
        },
      };

      await assert.rejects(
        () =>
          processAiQuery(
            { action: "EXPLAIN", level: "SIMPLE", text: "Some text" },
            { client: mockClient }
          ),
        (err) => err instanceof AppError && err.statusCode === 429
      );
    });

    it("handles provider authentication error (401/403) as 503", async () => {
      const mockClient = {
        chat: {
          completions: {
            create: async () => {
              const err = new Error("Invalid API key");
              err.status = 401;
              throw err;
            },
          },
        },
      };

      await assert.rejects(
        () =>
          processAiQuery(
            { action: "EXPLAIN", level: "SIMPLE", text: "Some text" },
            { client: mockClient }
          ),
        (err) => err instanceof AppError && err.statusCode === 503
      );
    });

    it("handles empty completion content as 502", async () => {
      const mockClient = {
        chat: {
          completions: {
            create: async () => ({
              choices: [{ message: { content: "   " } }],
            }),
          },
        },
      };

      await assert.rejects(
        () =>
          processAiQuery(
            { action: "EXPLAIN", level: "SIMPLE", text: "Some text" },
            { client: mockClient }
          ),
        (err) => err instanceof AppError && err.statusCode === 502
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Controller Unit Tests (queryDocumentAi)
  // ---------------------------------------------------------------------------
  describe("AI Controller (queryDocumentAi)", async () => {
    const { queryDocumentAi } = await import(
      "../src/features/ai/ai.controller.js"
    );

    it("rejects invalid document IDs with ValidationError", async () => {
      let nextError = null;
      const req = {
        params: { id: "invalid-id" },
        user: { id: 1 },
        body: { action: "EXPLAIN", level: "SIMPLE", text: "Some text" },
      };
      const res = {};
      const next = (err) => {
        nextError = err;
      };

      await queryDocumentAi(req, res, next);
      assert.ok(nextError instanceof ValidationError);
      assert.equal(nextError.statusCode, 400);
    });
  });
});

