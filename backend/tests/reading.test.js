// Phase 1: Reading Progress & Session Tracking Backend Tests
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const { default: prisma } = await import("../src/config/database.js");
const {
  calculateProgressPercentage,
  saveReadingProgress,
  resetReadingProgress,
  getReadingData,
  getRecentReading,
  getBookmarks,
} = await import("../src/features/reading/reading.service.js");
const {
  saveProgress,
  resetProgress,
  getReading,
} = await import("../src/features/reading/reading.controller.js");
const { ForbiddenError, NotFoundError, ValidationError } = await import(
  "../src/shared/utils/errors.js"
);

describe("Reading Progress — Phase 1 Backend & Database", () => {
  // -------------------------------------------------------------------------
  // 1. Percentage Calculation Unit Tests
  // -------------------------------------------------------------------------
  describe("Progress Percentage Calculation", () => {
    it("calculates progress percentage accurately and safely", () => {
      assert.equal(calculateProgressPercentage(5, 20), 25);
      assert.equal(calculateProgressPercentage(1, 3), 33);
      assert.equal(calculateProgressPercentage(3, 3), 100);
    });

    it("handles zero, negative, or invalid values without producing NaN or Infinity", () => {
      assert.equal(calculateProgressPercentage(0, 10), 0);
      assert.equal(calculateProgressPercentage(-5, 10), 0);
      assert.equal(calculateProgressPercentage(5, 0), 0);
      assert.equal(calculateProgressPercentage(5, -10), 0);
      assert.equal(calculateProgressPercentage(null, undefined), 0);
      assert.equal(calculateProgressPercentage("abc", "xyz"), 0);
      assert.equal(calculateProgressPercentage(NaN, 10), 0);
      assert.equal(calculateProgressPercentage(5, Infinity), 0);
    });

    it("clamps percentages to a maximum of 100%", () => {
      assert.equal(calculateProgressPercentage(15, 10), 100);
      assert.equal(calculateProgressPercentage(999, 50), 100);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Service & Database Integration Tests
  // -------------------------------------------------------------------------
  describe("Reading Progress Service & Database Operations", () => {
    let testUserA;
    let testUserB;
    let docA;
    let docA2;
    let docB;

    before(async () => {
      const suffix = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

      // Create test users
      testUserA = await prisma.user.create({
        data: {
          name: "User A",
          email: `user_a_${suffix}@test.com`,
          passwordHash: "hash",
        },
      });

      testUserB = await prisma.user.create({
        data: {
          name: "User B",
          email: `user_b_${suffix}@test.com`,
          passwordHash: "hash",
        },
      });

      // Create test documents
      docA = await prisma.document.create({
        data: {
          title: "Doc A",
          fileName: "doc_a.pdf",
          s3Key: `key_a_${suffix}`,
          fileSize: 1024,
          mimeType: "application/pdf",
          userId: testUserA.id,
        },
      });

      docA2 = await prisma.document.create({
        data: {
          title: "Doc A2",
          fileName: "doc_a2.pdf",
          s3Key: `key_a2_${suffix}`,
          fileSize: 2048,
          mimeType: "application/pdf",
          userId: testUserA.id,
        },
      });

      docB = await prisma.document.create({
        data: {
          title: "Doc B",
          fileName: "doc_b.pdf",
          s3Key: `key_b_${suffix}`,
          fileSize: 1024,
          mimeType: "application/pdf",
          userId: testUserB.id,
        },
      });
    });

    after(async () => {
      // Clean up test data
      try {
        if (docA) await prisma.document.delete({ where: { id: docA.id } });
      } catch {}
      try {
        if (docA2) await prisma.document.delete({ where: { id: docA2.id } });
      } catch {}
      try {
        if (docB) await prisma.document.delete({ where: { id: docB.id } });
      } catch {}
      try {
        if (testUserA) await prisma.user.delete({ where: { id: testUserA.id } });
      } catch {}
      try {
        if (testUserB) await prisma.user.delete({ where: { id: testUserB.id } });
      } catch {}
    });

    it("creates a new progress record with lastPage, furthestPage, and totalPages", async () => {
      const saved = await saveReadingProgress(testUserA.id, docA.id, 2, 10);

      assert.equal(saved.lastPage, 2);
      assert.equal(saved.furthestPage, 2);
      assert.equal(saved.totalPages, 10);
      assert.equal(saved.percentage, 20);
      assert.equal(saved.userId, testUserA.id);
      assert.equal(saved.documentId, docA.id);

      // Verify in DB
      const inDb = await prisma.readingProgress.findUnique({
        where: { userId_documentId: { userId: testUserA.id, documentId: docA.id } },
      });
      assert.ok(inDb);
      assert.equal(inDb.lastPage, 2);
      assert.equal(inDb.furthestPage, 2);
      assert.equal(inDb.totalPages, 10);
    });

    it("advances progress from page 2 to page 4", async () => {
      const updated = await saveReadingProgress(testUserA.id, docA.id, 4, 10);

      assert.equal(updated.lastPage, 4);
      assert.equal(updated.furthestPage, 4);
      assert.equal(updated.totalPages, 10);
      assert.equal(updated.percentage, 40);
    });

    it("navigates backward from page 4 to page 2 while preserving furthestPage", async () => {
      const backward = await saveReadingProgress(testUserA.id, docA.id, 2);

      // lastPage must reflect the new current position (Resume Reading contract)
      assert.equal(backward.lastPage, 2);
      // furthestPage must NOT be reduced
      assert.equal(backward.furthestPage, 4);
      // totalPages must be preserved even when omitted in the call
      assert.equal(backward.totalPages, 10);
      // percentage is based on furthestPage
      assert.equal(backward.percentage, 40);
    });

    it("prevents duplicate progress records on repeated saves", async () => {
      await saveReadingProgress(testUserA.id, docA.id, 2);
      await saveReadingProgress(testUserA.id, docA.id, 3);
      await saveReadingProgress(testUserA.id, docA.id, 2);

      const records = await prisma.readingProgress.findMany({
        where: { userId: testUserA.id, documentId: docA.id },
      });
      assert.equal(records.length, 1);
    });

    it("validates page and totalPages arguments strictly", async () => {
      // Non-integer lastPage
      await assert.rejects(
        () => saveReadingProgress(testUserA.id, docA.id, 2.5),
        (err) => err instanceof ValidationError && err.message.includes("lastPage")
      );

      // Negative lastPage
      await assert.rejects(
        () => saveReadingProgress(testUserA.id, docA.id, -1),
        (err) => err instanceof ValidationError && err.message.includes("lastPage")
      );

      // Zero lastPage
      await assert.rejects(
        () => saveReadingProgress(testUserA.id, docA.id, 0),
        (err) => err instanceof ValidationError && err.message.includes("lastPage")
      );

      // Non-integer totalPages
      await assert.rejects(
        () => saveReadingProgress(testUserA.id, docA.id, 2, "not-a-number"),
        (err) => err instanceof ValidationError && err.message.includes("totalPages")
      );

      // Zero totalPages
      await assert.rejects(
        () => saveReadingProgress(testUserA.id, docA.id, 2, 0),
        (err) => err instanceof ValidationError && err.message.includes("totalPages")
      );

      // Impossible combination: page > totalPages
      await assert.rejects(
        () => saveReadingProgress(testUserA.id, docA.id, 15, 10),
        (err) => err instanceof ValidationError && err.message.includes("cannot exceed")
      );
    });

    it("updates totalPages when a new totalPages value is provided", async () => {
      const updated = await saveReadingProgress(testUserA.id, docA.id, 5, 20);

      assert.equal(updated.lastPage, 5);
      assert.equal(updated.furthestPage, 5);
      assert.equal(updated.totalPages, 20);
      assert.equal(updated.percentage, 25);
    });

    it("correctly calculates 100% progress when reaching the final page", async () => {
      const completed = await saveReadingProgress(testUserA.id, docA.id, 20, 20);

      assert.equal(completed.lastPage, 20);
      assert.equal(completed.furthestPage, 20);
      assert.equal(completed.percentage, 100);
    });

    it("resets progress: lastPage to 1, furthestPage to 0, 0% percentage, preserving totalPages", async () => {
      const reset = await resetReadingProgress(testUserA.id, docA.id);

      assert.equal(reset.lastPage, 1);
      assert.equal(reset.furthestPage, 0);
      assert.equal(reset.totalPages, 20);
      assert.equal(reset.percentage, 0);

      // Verify the record is preserved in the database (not deleted)
      const inDb = await prisma.readingProgress.findUnique({
        where: { userId_documentId: { userId: testUserA.id, documentId: docA.id } },
      });
      assert.ok(inDb);
      assert.equal(inDb.lastPage, 1);
      assert.equal(inDb.furthestPage, 0);
      assert.equal(inDb.totalPages, 20);
    });

    it("forbids a user from modifying or resetting another user's document progress", async () => {
      // User B attempts to save progress on User A's document
      await assert.rejects(
        () => saveReadingProgress(testUserB.id, docA.id, 3, 10),
        (err) => err instanceof ForbiddenError && err.statusCode === 403
      );

      // User B attempts to reset User A's document progress
      await assert.rejects(
        () => resetReadingProgress(testUserB.id, docA.id),
        (err) => err instanceof ForbiddenError && err.statusCode === 403
      );
    });

    it("throws NotFoundError when document does not exist", async () => {
      await assert.rejects(
        () => saveReadingProgress(testUserA.id, 999999, 1),
        (err) => err instanceof NotFoundError && err.statusCode === 404
      );

      await assert.rejects(
        () => resetReadingProgress(testUserA.id, 999999),
        (err) => err instanceof NotFoundError && err.statusCode === 404
      );
    });

    it("throws NotFoundError when attempting to reset a document with no progress record", async () => {
      // docA2 exists but has never had progress saved
      await assert.rejects(
        () => resetReadingProgress(testUserA.id, docA2.id),
        (err) => err instanceof NotFoundError && err.statusCode === 404
      );
    });

    it("preserves the Resume Reading contract in getReadingData, getRecentReading, and getBookmarks", async () => {
      // Save progress on docA
      await saveReadingProgress(testUserA.id, docA.id, 7, 20);

      // 1. getReadingData
      const readingData = await getReadingData(testUserA.id, docA.id);
      assert.ok(readingData.progress);
      assert.equal(readingData.progress.lastPage, 7);
      assert.equal(readingData.progress.furthestPage, 7);
      assert.equal(readingData.progress.totalPages, 20);
      assert.equal(readingData.progress.percentage, 35);
      assert.ok(Array.isArray(readingData.notes));
      assert.ok(Array.isArray(readingData.highlights));

      // 2. getRecentReading
      const recent = await getRecentReading(testUserA.id);
      const docItem = recent.find((r) => r.documentId === docA.id);
      assert.ok(docItem);
      assert.equal(docItem.lastPage, 7);
      assert.equal(docItem.furthestPage, 7);
      assert.equal(docItem.totalPages, 20);
      assert.equal(docItem.percentage, 35);

      // 3. getBookmarks
      const bookmarks = await getBookmarks(testUserA.id);
      const bItem = bookmarks.find((b) => b.documentId === docA.id);
      assert.ok(bItem);
      assert.equal(bItem.lastPage, 7);
      assert.equal(bItem.furthestPage, 7);
      assert.equal(bItem.totalPages, 20);
      assert.equal(bItem.percentage, 35);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Controller Layer Tests
  // -------------------------------------------------------------------------
  describe("Reading Controller Integration", () => {
    let testUser;
    let testDoc;

    before(async () => {
      const suffix = `ctrl_${Date.now()}`;
      testUser = await prisma.user.create({
        data: {
          name: "Ctrl User",
          email: `${suffix}@test.com`,
          passwordHash: "hash",
        },
      });

      testDoc = await prisma.document.create({
        data: {
          title: "Ctrl Doc",
          fileName: "ctrl.pdf",
          s3Key: `ctrl_${suffix}`,
          fileSize: 1024,
          mimeType: "application/pdf",
          userId: testUser.id,
        },
      });
    });

    after(async () => {
      try {
        if (testDoc) await prisma.document.delete({ where: { id: testDoc.id } });
      } catch {}
      try {
        if (testUser) await prisma.user.delete({ where: { id: testUser.id } });
      } catch {}
    });

    it("saveProgress handles lastPage and totalPages from request body", async () => {
      let savedResponse;
      const mockRes = {
        status(code) {
          assert.equal(code, 200);
          return this;
        },
        json(body) {
          savedResponse = body;
          return this;
        },
      };

      await saveProgress(
        {
          params: { documentId: String(testDoc.id) },
          user: { id: testUser.id },
          body: { lastPage: 3, totalPages: 15 },
        },
        mockRes,
        (err) => {
          if (err) throw err;
        }
      );

      assert.equal(savedResponse.success, true);
      assert.equal(savedResponse.data.lastPage, 3);
      assert.equal(savedResponse.data.furthestPage, 3);
      assert.equal(savedResponse.data.totalPages, 15);
      assert.equal(savedResponse.data.percentage, 20);
    });

    it("saveProgress supports legacy currentPage parameter in request body", async () => {
      let savedResponse;
      const mockRes = {
        status(code) {
          assert.equal(code, 200);
          return this;
        },
        json(body) {
          savedResponse = body;
          return this;
        },
      };

      await saveProgress(
        {
          params: { documentId: String(testDoc.id) },
          user: { id: testUser.id },
          body: { currentPage: 6 },
        },
        mockRes,
        (err) => {
          if (err) throw err;
        }
      );

      assert.equal(savedResponse.success, true);
      assert.equal(savedResponse.data.lastPage, 6);
      assert.equal(savedResponse.data.furthestPage, 6);
      assert.equal(savedResponse.data.totalPages, 15);
      assert.equal(savedResponse.data.percentage, 40);
    });

    it("resetProgress resets progress via controller and returns 200", async () => {
      let resetResponse;
      const mockRes = {
        status(code) {
          assert.equal(code, 200);
          return this;
        },
        json(body) {
          resetResponse = body;
          return this;
        },
      };

      await resetProgress(
        {
          params: { documentId: String(testDoc.id) },
          user: { id: testUser.id },
        },
        mockRes,
        (err) => {
          if (err) throw err;
        }
      );

      assert.equal(resetResponse.success, true);
      assert.equal(resetResponse.data.lastPage, 1);
      assert.equal(resetResponse.data.furthestPage, 0);
      assert.equal(resetResponse.data.totalPages, 15);
      assert.equal(resetResponse.data.percentage, 0);
    });
  });
});
