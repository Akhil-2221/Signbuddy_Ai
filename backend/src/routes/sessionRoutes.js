import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  startSession,
  endSession,
  recognizeSign,
  transcribeSpeechToText,
  translateUtterance,
  correctUtterance,
  getSessionHistory,
  listUserSessions,
} from "../controllers/sessionController.js";

const router = Router();

router.use(requireAuth); // every session route requires a user (guest accounts included)

router.post("/", startSession);
router.post("/:sessionId/end", endSession);
router.post("/recognize/sign", recognizeSign);
router.post("/recognize/speech", transcribeSpeechToText);
router.post("/translate", translateUtterance);
router.patch("/utterances/:utteranceId/correct", correctUtterance);
router.get("/:sessionId/history", getSessionHistory);
router.get("/", listUserSessions);

export default router;
