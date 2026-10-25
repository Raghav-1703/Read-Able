import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import prisma from "../src/config/database.js";
import { config } from "../src/config/env.js";
import {
  validateUpdateProfile,
  validateChangePassword,
  validateDeleteAccount,
} from "../src/features/users/user.validation.js";
import {
  getUserProfile,
  updateUserProfile,
  changeUserPassword,
  deleteUserAccount,
} from "../src/features/users/user.service.js";
import { NotFoundError, UnauthorizedError, ConflictError } from "../src/shared/utils/errors.js";

describe("User Management & Profile — Backend Features", () => {
  let testUser;
  let otherUser;

  before(async () => {
    // Create test user and second user for collision testing
    const passwordHash = await bcrypt.hash("password123", config.bcryptSaltRounds);

    testUser = await prisma.user.create({
      data: {
        name: "Settings Test User",
        email: `settings_${Date.now()}@example.com`,
        phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
        passwordHash,
      },
    });

    otherUser = await prisma.user.create({
      data: {
        name: "Other User",
        email: `other_${Date.now()}@example.com`,
        phone: `+1999${Math.floor(1000000 + Math.random() * 9000000)}`,
        passwordHash,
      },
    });
  });

  after(async () => {
    // Cleanup users
    if (testUser) {
      await prisma.user.deleteMany({ where: { id: testUser.id } });
    }
    if (otherUser) {
      await prisma.user.deleteMany({ where: { id: otherUser.id } });
    }
  });

  describe("User Validation", () => {
    it("validates update profile payload requiring at least one valid field", () => {
      const emptyErrors = validateUpdateProfile({});
      assert.ok(emptyErrors.length > 0);
      assert.match(emptyErrors[0], /At least one field/i);

      const invalidNameErrors = validateUpdateProfile({ name: "A" });
      assert.ok(invalidNameErrors.length > 0);
      assert.match(invalidNameErrors[0], /at least 2 characters/i);

      const invalidPhoneErrors = validateUpdateProfile({ phone: "123" });
      assert.ok(invalidPhoneErrors.length > 0);
      assert.match(invalidPhoneErrors[0], /valid mobile number/i);

      const validErrors = validateUpdateProfile({ name: "Valid Name", phone: "+1234567890" });
      assert.equal(validErrors.length, 0);
    });

    it("validates change password payload requiring minimum length and difference", () => {
      const missingCurrent = validateChangePassword({ newPassword: "newpassword123" });
      assert.ok(missingCurrent.length > 0);
      assert.match(missingCurrent[0], /Current password is required/i);

      const shortNew = validateChangePassword({ currentPassword: "pass", newPassword: "short" });
      assert.ok(shortNew.length > 0);
      assert.match(shortNew[0], /at least 8 characters/i);

      const identical = validateChangePassword({ currentPassword: "password123", newPassword: "password123" });
      assert.ok(identical.length > 0);
      assert.match(identical[0], /must be different/i);

      const valid = validateChangePassword({ currentPassword: "password123", newPassword: "newpassword123" });
      assert.equal(valid.length, 0);
    });

    it("validates delete account requiring password", () => {
      const missing = validateDeleteAccount({});
      assert.ok(missing.length > 0);
      assert.match(missing[0], /Password confirmation is required/i);

      const valid = validateDeleteAccount({ password: "password123" });
      assert.equal(valid.length, 0);
    });
  });

  describe("User Service Operations", () => {
    it("fetches user profile excluding password hash", async () => {
      const profile = await getUserProfile(testUser.id);
      assert.equal(profile.id, testUser.id);
      assert.equal(profile.name, testUser.name);
      assert.equal(profile.email, testUser.email);
      assert.equal(profile.passwordHash, undefined);
    });

    it("throws NotFoundError when user does not exist", async () => {
      await assert.rejects(
        () => getUserProfile(99999999),
        (err) => err instanceof NotFoundError
      );
    });

    it("updates user profile name and phone", async () => {
      const updated = await updateUserProfile(testUser.id, {
        name: "Updated Name",
        phone: "+15558889999",
      });

      assert.equal(updated.name, "Updated Name");
      assert.equal(updated.phone, "+15558889999");
    });

    it("throws ConflictError when updating phone to another user's phone", async () => {
      await assert.rejects(
        () => updateUserProfile(testUser.id, { phone: otherUser.phone }),
        (err) => err instanceof ConflictError
      );
    });

    it("rejects password change if current password is incorrect", async () => {
      await assert.rejects(
        () => changeUserPassword(testUser.id, {
          currentPassword: "wrongpassword",
          newPassword: "newValidPassword123",
        }),
        (err) => err instanceof UnauthorizedError
      );
    });

    it("successfully changes password when current password matches", async () => {
      const res = await changeUserPassword(testUser.id, {
        currentPassword: "password123",
        newPassword: "brandNewPassword123",
      });

      assert.ok(res.message);

      const reloaded = await prisma.user.findUnique({ where: { id: testUser.id } });
      const matches = await bcrypt.compare("brandNewPassword123", reloaded.passwordHash);
      assert.equal(matches, true);
    });

    it("rejects account deletion if password is incorrect", async () => {
      await assert.rejects(
        () => deleteUserAccount(testUser.id, "wrongPass"),
        (err) => err instanceof UnauthorizedError
      );
    });

    it("deletes user account when password matches", async () => {
      const delUser = await prisma.user.create({
        data: {
          name: "User To Delete",
          email: `del_${Date.now()}@example.com`,
          passwordHash: await bcrypt.hash("delPass123", config.bcryptSaltRounds),
        },
      });

      const res = await deleteUserAccount(delUser.id, "delPass123");
      assert.match(res.message, /deleted successfully/i);

      const found = await prisma.user.findUnique({ where: { id: delUser.id } });
      assert.equal(found, null);
    });
  });
});
