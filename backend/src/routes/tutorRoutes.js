import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  listLessons,
  getLesson,
  getUserProgress,
  submitPracticeAttempt,
  completeLesson,
  getRecommendations,
} from "../controllers/tutorController.js";

const router = Router();

router.get("/lessons", listLessons); // public — browsing doesn't require login
router.get("/lessons/:lessonId", getLesson);

router.use(requireAuth);
router.get("/progress", getUserProgress);
router.post("/practice", submitPracticeAttempt);
router.post("/lessons/:lessonId/complete", completeLesson);
router.get("/recommendations", getRecommendations);

export default router;
