// Defines Express routes for user management endpoints and maps them to controller methods
import { Router } from "express";
import {
  getProfile,
  updateProfile,
  changePassword,
  deleteAccount,
} from "./user.controller.js";
import { authenticate } from "../../shared/middleware/auth.middleware.js";

const router = Router();

// All user management routes require authentication
router.use(authenticate);

router.get("/profile", getProfile);
router.patch("/profile", updateProfile);
router.post("/change-password", changePassword);
router.delete("/account", deleteAccount);

export default router;
