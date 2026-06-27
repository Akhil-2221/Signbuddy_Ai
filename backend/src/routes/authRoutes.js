import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  register,
  login,
  createGuestSession,
  refresh,
  logout,
  getCurrentUser,
} from "../controllers/authController.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/guest", createGuestSession);
router.post("/refresh", refresh);
router.post("/logout", requireAuth, logout);
router.get("/me", requireAuth, getCurrentUser);

export default router;
