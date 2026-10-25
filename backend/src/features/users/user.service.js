// Contains business logic for user profile management, password updates, and account lifecycle
import bcrypt from "bcryptjs";
import prisma from "../../config/database.js";
import { config } from "../../config/env.js";
import { NotFoundError, UnauthorizedError, ConflictError } from "../../shared/utils/errors.js";

// Normalize phone: strip all spaces, dashes, parentheses, and dots
const normalizePhone = (phone) =>
  phone ? phone.replace(/[\s\-().]/g, "").trim() : null;

/**
 * Get profile data for the authenticated user
 */
export const getUserProfile = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    throw new NotFoundError("User not found.");
  }

  return user;
};

/**
 * Update user profile details (name, phone)
 */
export const updateUserProfile = async (userId, { name, phone }) => {
  const existingUser = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!existingUser) {
    throw new NotFoundError("User not found.");
  }

  const updateData = {};

  if (name !== undefined) {
    updateData.name = name.trim();
  }

  if (phone !== undefined) {
    const cleanPhone = normalizePhone(phone);
    if (cleanPhone) {
      const duplicatePhone = await prisma.user.findFirst({
        where: {
          phone: cleanPhone,
          NOT: { id: userId },
        },
      });

      if (duplicatePhone) {
        throw new ConflictError("An account with this phone number already exists.");
      }
    }
    updateData.phone = cleanPhone;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updated;
};

/**
 * Change user password after verifying current password
 */
export const changeUserPassword = async (userId, { currentPassword, newPassword }) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new NotFoundError("User not found.");
  }

  const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isCurrentValid) {
    throw new UnauthorizedError("Current password is incorrect.");
  }

  const newHash = await bcrypt.hash(newPassword, config.bcryptSaltRounds);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash },
  });

  return { message: "Password updated successfully." };
};

/**
 * Delete user account and associated resources after verifying password
 */
export const deleteUserAccount = async (userId, password) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new NotFoundError("User not found.");
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    throw new UnauthorizedError("Incorrect password. Account deletion canceled.");
  }

  await prisma.user.delete({
    where: { id: userId },
  });

  return { message: "User account deleted successfully." };
};
