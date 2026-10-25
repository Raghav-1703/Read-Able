import { Router } from "express";
import authRoutes from "../features/auth/auth.routes.js";
import documentRoutes from "../features/documents/document.routes.js";
import readingRoutes from "../features/reading/reading.routes.js";
import userRoutes from "../features/users/user.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/documents", documentRoutes);
router.use("/reading", readingRoutes);
router.use("/users", userRoutes);

export default router;
