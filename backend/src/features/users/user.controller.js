// Handles HTTP requests and responses for user profile, security, and account management endpoints
import {
  getUserProfile,
  updateUserProfile,
  changeUserPassword,
  deleteUserAccount,
} from "./user.service.js";
import {
  validateUpdateProfile,
  validateChangePassword,
  validateDeleteAccount,
} from "./user.validation.js";
import { sendSuccess } from "../../shared/utils/response.js";
import { ValidationError } from "../../shared/utils/errors.js";

export const getProfile = async (req, res, next) => {
  try {
    const profile = await getUserProfile(req.user.id);
    sendSuccess(res, profile);
  } catch (err) {
    next(err);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const errors = validateUpdateProfile(req.body);
    if (errors.length) {
      throw new ValidationError(errors[0]);
    }

    const updated = await updateUserProfile(req.user.id, req.body);
    sendSuccess(res, updated, "Profile updated successfully.");
  } catch (err) {
    next(err);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const errors = validateChangePassword(req.body);
    if (errors.length) {
      throw new ValidationError(errors[0]);
    }

    const result = await changeUserPassword(req.user.id, req.body);
    sendSuccess(res, result, "Password updated successfully.");
  } catch (err) {
    next(err);
  }
};

export const deleteAccount = async (req, res, next) => {
  try {
    const errors = validateDeleteAccount(req.body);
    if (errors.length) {
      throw new ValidationError(errors[0]);
    }

    const result = await deleteUserAccount(req.user.id, req.body.password);
    sendSuccess(res, result, "Account deleted successfully.");
  } catch (err) {
    next(err);
  }
};
