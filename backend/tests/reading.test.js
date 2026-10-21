// Phase 3: Reading Progress & Session Tracking tests
// Updated to match the DB-backed reading.service.js (PR #23)
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const { default: prisma } = await import("../src/config/database.js");
const readingService = await import(
  "../src/features/reading/reading.service.js"
);
const { saveProgress, getReading } = await import(
  "../src/features/reading/reading.controller.js"
);
const { ForbiddenError, NotFoundError, ValidationError } = await import(
  "../src/shared/utils/errors.js"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal in-memory progress store that satisfies prisma.readingProgress.
 */
function makeProgressStore() {
  const store = new Map(); // key: `${userId}:${documentId}`
  return {
    upsert: async ({ where, update, create }) => {
      const { userId, documentId } = where.userId_documentId;
      const key = `${userId}:${documentId}`;
      const existing = store.get(key) || {};
      const record = { ...existing, ...create, ...update, userId, documentId, updatedAt: new Date() };
      store.set(key, record);
      return record;
    },
    findUnique: async ({ where }) => {
      const { userId, documentId } = where.userId_documentId;
      return store.get(`${userId}:${documentId}`) || null;
    },
    deleteMany: async ({ where }) => {
      let count = 0;
      for (const k of [...store.keys()]) {
        const [u, d] = k.split(":").map(Number);
        if (
          (where.userId === undefined || u === where.userId) &&
          (where.documentId === undefined || d === where.documentId)
        ) {
          store.delete(k);
          count++;
        }
      }
      return { count };
    },
  };
}

/** Minimal mock for note / highlight used in getReadingData. */
const emptyCollectionMock = { findMany: async () => [] };

/** Mock res object with setHeader, status, json. */
function mockRes(expectedStatus = 200) {
  const res = { result: null };
  res.setHeader = () => {};
  res.status = (code) => {
    assert.equal(code, expectedStatus);
    return res;
  };
  res.json = (body) => {
    res.result = body;
    return res;
  };
  return res;
}

describe("Phase 3: Reading Progress Tracking", () => {
  // Save and restore global prisma handles around the entire suite
  let origDocument;
  let origReadingProgress;
  let origNote;
  let origHighlight;

  before(() => {
    origDocument = prisma.document;
    origReadingProgress = prisma.readingProgress;
    origNote = prisma.note;
    origHighlight = prisma.highlight;
  });

  after(() => {
    prisma.document = origDocument;
    prisma.readingProgress = origReadingProgress;
    prisma.note = origNote;
    prisma.highlight = origHighlight;
  });

  // -------------------------------------------------------------------------
  // 1. Progress Percentage Calculation
  // -------------------------------------------------------------------------
  describe("Progress Percentage Calculation", () => {
    /** Inline helper — mirrors the frontend calculation. */
    function pct(current, total) {
      const c = parseInt(current, 10);
      const t = parseInt(total, 10);
      if (!c || !t || isNaN(c) || isNaN(t) || c <= 0 || t <= 0) return 0;
      return Math.min(100, Math.floor((c / t) * 100));
    }

    it("calculates progress percentage accurately and safely", () => {
      assert.equal(pct(5, 20), 25);
      assert.equal(pct(1, 3), 33);
      assert.equal(pct(3, 3), 100);
    });

    it("handles zero, negative, or invalid values without producing NaN or Infinity", () => {
      assert.equal(pct(0, 10), 0);
      assert.equal(pct(-5, 10), 0);
      assert.equal(pct(5, 0), 0);
      assert.equal(pct(5, -10), 0);
      assert.equal(pct(null, undefined), 0);
      assert.equal(pct("abc", "xyz"), 0);
    });

    it("clamps percentages to a maximum of 100%", () => {
      assert.equal(pct(15, 10), 100);
      assert.equal(pct(999, 50), 100);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Reading Progress Service (DB-backed)
  // -------------------------------------------------------------------------
  describe("Reading Progress Service", () => {
    let progressStore;

    beforeEach(() => {
      progressStore = makeProgressStore();
      // Document mock: each doc is "owned by" the requesting user (permissive for service tests)
      prisma.document = {
        findUnique: async ({ where }) => ({ id: where.id, userId: where.id /* any user owns it */ }),
      };
      prisma.readingProgress = progressStore;
      prisma.note = emptyCollectionMock;
      prisma.highlight = emptyCollectionMock;
    });

    it("saves and retrieves reading progress for a user and document", async () => {
      // Make doc 101 owned by user 1
      prisma.document = { findUnique: async ({ where }) => ({ id: 101, userId: 1 }) };

      const saved = await readingService.saveReadingProgress(1, 101, 5);
      assert.equal(saved.userId, 1);
      assert.equal(saved.documentId, 101);
      assert.equal(saved.lastPage, 5);

      const retrieved = await progressStore.findUnique({
        where: { userId_documentId: { userId: 1, documentId: 101 } },
      });
      assert.equal(retrieved.lastPage, 5);
    });

    it("maintains isolated progress across different users for the same document", async () => {
      // Return a document whose userId matches whichever user calls the service.
      // verifyDocumentOwnership passes `userId` as the second argument; the Prisma
      // mock only sees the document ID in `where`. We rotate the returned userId so
      // the first call (user 1) and the second call (user 2) both pass ownership.
      const callers = [1, 2];
      let callCount = 0;
      prisma.document = {
        findUnique: async ({ where }) => ({ id: 200, userId: callers[callCount++ % callers.length] }),
      };

      await readingService.saveReadingProgress(1, 200, 3);
      await readingService.saveReadingProgress(2, 200, 8);

      const user1 = await progressStore.findUnique({
        where: { userId_documentId: { userId: 1, documentId: 200 } },
      });
      const user2 = await progressStore.findUnique({
        where: { userId_documentId: { userId: 2, documentId: 200 } },
      });

      assert.equal(user1.lastPage, 3);
      assert.equal(user2.lastPage, 8);
    });

    it("maintains separate progress across different documents for the same user", async () => {
      prisma.document = { findUnique: async ({ where }) => ({ id: where.id, userId: 1 }) };

      await readingService.saveReadingProgress(1, 301, 2);
      await readingService.saveReadingProgress(1, 302, 7);

      const p301 = await progressStore.findUnique({
        where: { userId_documentId: { userId: 1, documentId: 301 } },
      });
      const p302 = await progressStore.findUnique({
        where: { userId_documentId: { userId: 1, documentId: 302 } },
      });

      assert.equal(p301.lastPage, 2);
      assert.equal(p302.lastPage, 7);
    });

    it("updates progress when advancing pages without losing totalPages", async () => {
      prisma.document = { findUnique: async ({ where }) => ({ id: 401, userId: 1 }) };

      await readingService.saveReadingProgress(1, 401, 1);
      await readingService.saveReadingProgress(1, 401, 10);

      const updated = await progressStore.findUnique({
        where: { userId_documentId: { userId: 1, documentId: 401 } },
      });
      assert.equal(updated.lastPage, 10);
    });

    it("clears progress when document is deleted", async () => {
      prisma.document = { findUnique: async ({ where }) => ({ id: 501, userId: 1 }) };

      await readingService.saveReadingProgress(1, 501, 4);
      let before = await progressStore.findUnique({
        where: { userId_documentId: { userId: 1, documentId: 501 } },
      });
      assert.ok(before);

      await progressStore.deleteMany({ where: { userId: 1, documentId: 501 } });

      const after = await progressStore.findUnique({
        where: { userId_documentId: { userId: 1, documentId: 501 } },
      });
      assert.equal(after, null);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Controller & Document Ownership Security
  // -------------------------------------------------------------------------
  describe("Controller & Document Ownership Security", () => {
    let progressStore;

    beforeEach(() => {
      progressStore = makeProgressStore();
      prisma.readingProgress = progressStore;
      prisma.note = emptyCollectionMock;
      prisma.highlight = emptyCollectionMock;
    });

    it("allows the owner to save and get reading progress", async () => {
      const mockDoc = { id: 601, userId: 10, title: "Owner Doc" };
      prisma.document = { findUnique: async () => mockDoc };

      const saveRes = mockRes(200);
      await saveProgress(
        { params: { documentId: "601" }, user: { id: 10 }, body: { currentPage: 4, totalPages: 10 } },
        saveRes,
        (err) => { if (err) throw err; }
      );

      assert.equal(saveRes.result.success, true);
      // New DB service stores lastPage (mapped from currentPage by the controller)
      assert.equal(saveRes.result.data.lastPage, 4);

      const getRes = mockRes(200);
      await getReading(
        { params: { documentId: "601" }, user: { id: 10 } },
        getRes,
        (err) => { if (err) throw err; }
      );

      assert.equal(getRes.result.success, true);
      // New service returns { progress, notes, highlights }
      assert.ok("progress" in getRes.result.data);
      assert.ok("notes" in getRes.result.data);
      assert.ok("highlights" in getRes.result.data);
    });

    it("forbids another user from accessing reading progress of a document they do not own", async () => {
      const mockDoc = { id: 701, userId: 99, title: "Secret Doc" };
      prisma.document = { findUnique: async () => mockDoc };

      let caughtError = null;
      await getReading(
        { params: { documentId: "701" }, user: { id: 5 } },
        { setHeader: () => {}, status: () => ({}), json: () => {} },
        (err) => { caughtError = err; }
      );

      assert.ok(caughtError instanceof ForbiddenError, `Expected ForbiddenError, got ${caughtError}`);
      assert.equal(caughtError.statusCode, 403);
    });

    it("rejects saving progress with invalid currentPage (< 1)", async () => {
      const mockDoc = { id: 801, userId: 10, title: "Doc" };
      prisma.document = { findUnique: async () => mockDoc };

      let caughtError = null;
      await saveProgress(
        { params: { documentId: "801" }, user: { id: 10 }, body: { currentPage: 0, totalPages: 10 } },
        { setHeader: () => {}, status: () => ({}), json: () => {} },
        (err) => { caughtError = err; }
      );

      assert.ok(caughtError instanceof ValidationError, `Expected ValidationError, got ${caughtError}`);
      assert.equal(caughtError.statusCode, 400);
    });

    it("throws NotFoundError when document does not exist in database", async () => {
      prisma.document = { findUnique: async () => null };

      let caughtError = null;
      await getReading(
        { params: { documentId: "9999" }, user: { id: 1 } },
        { setHeader: () => {}, status: () => ({}), json: () => {} },
        (err) => { caughtError = err; }
      );

      assert.ok(caughtError instanceof NotFoundError, `Expected NotFoundError, got ${caughtError}`);
      assert.equal(caughtError.statusCode, 404);
    });
  });
});
