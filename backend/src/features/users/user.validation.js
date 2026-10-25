// Defines validation functions for user-related request payloads (update profile, change password, delete account)

export const validateUpdateProfile = (body) => {
  const { name, phone } = body || {};
  const errors = [];

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2) {
      errors.push("Name must be at least 2 characters.");
    }
  }

  if (phone !== undefined) {
    if (typeof phone !== "string" || !/^[+\d][\d\s-]{7,}$/.test(phone.trim())) {
      errors.push("Please enter a valid mobile number.");
    }
  }

  if (name === undefined && phone === undefined) {
    errors.push("At least one field (name or phone) must be provided to update profile.");
  }

  return errors;
};

export const validateChangePassword = (body) => {
  const { currentPassword, newPassword } = body || {};
  const errors = [];

  if (!currentPassword) {
    errors.push("Current password is required.");
  }

  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    errors.push("New password must be at least 8 characters long.");
  } else if (currentPassword && currentPassword === newPassword) {
    errors.push("New password must be different from current password.");
  }

  return errors;
};

export const validateDeleteAccount = (body) => {
  const { password } = body || {};
  const errors = [];

  if (!password) {
    errors.push("Password confirmation is required to delete account.");
  }

  return errors;
};
