import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import {
  formatDateString,
  calculateReadingStreak,
  calculateWeekDays,
  getUserReadingStats,
  logUserReadingActivity,
  updateUserDailyGoal,
} from "../src/features/reading/reading.stats.service.js";

describe("Reading Streak & Daily Goal — Statistics Engine", () => {
  const testUserId = 9990001;

  after(() => {
    // Clean up test file if created
    const testFile = path.resolve("data/reading_stats", `user_${testUserId}.json`);
    if (fs.existsSync(testFile)) {
      try {
        fs.unlinkSync(testFile);
      } catch {}
    }
  });

  describe("Streak Calculation Logic", () => {
    it("returns 0 streak for empty activity", () => {
      assert.equal(calculateReadingStreak({}, "2026-10-25"), 0);
    });

    it("returns 1 streak when reading only on today", () => {
      const records = {
        "2026-10-25": 15,
      };
      assert.equal(calculateReadingStreak(records, "2026-10-25"), 1);
    });

    it("calculates 5 consecutive reading days", () => {
      const records = {
        "2026-10-21": 20,
        "2026-10-22": 35,
        "2026-10-23": 10,
        "2026-10-24": 50,
        "2026-10-25": 12,
      };
      assert.equal(calculateReadingStreak(records, "2026-10-25"), 5);
    });

    it("preserves previous streak during current day if user read yesterday", () => {
      const records = {
        "2026-10-21": 20,
        "2026-10-22": 35,
        "2026-10-23": 10,
        "2026-10-24": 50,
        "2026-10-25": 12,
      };
      // On Oct 26 morning, user has not read yet today (Oct 26: 0)
      assert.equal(calculateReadingStreak(records, "2026-10-26"), 5);
    });

    it("breaks streak when a full day is missed without reading", () => {
      const records = {
        "2026-10-21": 20,
        "2026-10-22": 35,
        "2026-10-23": 10,
        "2026-10-24": 50,
        "2026-10-25": 12,
        // Oct 26 missed!
      };
      // On Oct 27 morning, user has not read today (Oct 27) and missed Oct 26
      assert.equal(calculateReadingStreak(records, "2026-10-27"), 0);
    });

    it("resets streak to 1 day after a missed day when user reads again", () => {
      const records = {
        "2026-10-21": 20,
        "2026-10-22": 35,
        // Oct 26 missed
        "2026-10-27": 15, // Read on Oct 27
      };
      assert.equal(calculateReadingStreak(records, "2026-10-27"), 1);
    });

    it("ignores days with 0 minutes as invalid reading activity", () => {
      const records = {
        "2026-10-24": 0,
        "2026-10-25": 10,
      };
      assert.equal(calculateReadingStreak(records, "2026-10-25"), 1);
    });
  });

  describe("Weekdays Calculation", () => {
    it("generates 7 days from Monday to Sunday for any calendar week", () => {
      const week = calculateWeekDays(new Date("2026-10-25T12:00:00Z"), { "2026-10-25": 20 });
      assert.equal(week.length, 7);
      assert.deepEqual(week.map((w) => w.day), ["M", "T", "W", "T", "F", "S", "S"]);
    });

    it("correctly identifies today and completed days", () => {
      const ref = new Date("2026-10-25"); // Sunday
      const week = calculateWeekDays(ref, {
        "2026-10-19": 10, // Monday
        "2026-10-21": 25, // Wednesday
        "2026-10-25": 15, // Sunday
      });

      const mon = week[0];
      assert.equal(mon.day, "M");
      assert.equal(mon.completed, true);
      assert.equal(mon.minutes, 10);

      const tue = week[1];
      assert.equal(tue.day, "T");
      assert.equal(tue.completed, false);
      assert.equal(tue.minutes, 0);

      const wed = week[2];
      assert.equal(wed.day, "W");
      assert.equal(wed.completed, true);

      const sun = week[6];
      assert.equal(sun.day, "S");
      assert.equal(sun.isToday, true);
      assert.equal(sun.completed, true);
    });
  });

  describe("User Reading Stats & Sessions Integration", () => {
    it("returns default values for a brand new user", async () => {
      const stats = await getUserReadingStats(testUserId);
      assert.equal(stats.todayMinutes, 0);
      assert.equal(stats.goalMinutes, 50);
      assert.equal(stats.goalPercentage, 0);
      assert.equal(stats.streak, 0);
      assert.equal(stats.weekDays.length, 7);
    });

    it("accumulates multiple reading sessions on the same day across documents", async () => {
      // Document 1 -> 10 minutes
      const s1 = await logUserReadingActivity(testUserId, { documentId: 101, minutes: 10 });
      assert.equal(s1.todayMinutes, 10);
      assert.equal(s1.goalPercentage, 20); // 10 / 50 = 20%
      assert.equal(s1.streak, 1);

      // Document 2 -> 15 minutes
      const s2 = await logUserReadingActivity(testUserId, { documentId: 202, minutes: 15 });
      assert.equal(s2.todayMinutes, 25);
      assert.equal(s2.goalPercentage, 50); // 25 / 50 = 50%

      // Document 1 -> 5 minutes
      const s3 = await logUserReadingActivity(testUserId, { documentId: 101, minutes: 5 });
      assert.equal(s3.todayMinutes, 30);
      assert.equal(s3.goalPercentage, 60); // 30 / 50 = 60%
    });

    it("clamps progress to 100% when reading exceeds daily goal while preserving actual minutes", async () => {
      // Add 35 minutes -> 30 + 35 = 65 minutes (exceeds 50 min goal)
      const s = await logUserReadingActivity(testUserId, { documentId: 101, minutes: 35 });
      assert.equal(s.todayMinutes, 65);
      assert.equal(s.goalMinutes, 50);
      assert.equal(s.goalPercentage, 100); // Clamped to 100%
    });

    it("updates daily goal and recalculates percentage accurately", async () => {
      const updated = await updateUserDailyGoal(testUserId, 100);
      assert.equal(updated.goalMinutes, 100);
      assert.equal(updated.todayMinutes, 65);
      assert.equal(updated.goalPercentage, 65); // 65 / 100 = 65%
    });
  });
});
