import { Router } from "express";
import { query } from "../db/pool.js";
import { asyncHandler } from "../middleware/error.js";

const router = Router();

/**
 * Emergency phrases are intentionally PUBLIC, no-auth.
 * A deaf user in a crisis must not be blocked by a login wall.
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const signLanguage = req.query.signLanguage || "ASL";
    const result = await query(
      `SELECT * FROM emergency_phrases WHERE sign_language = $1 ORDER BY priority_order ASC`,
      [signLanguage]
    );
    res.json({ phrases: result.rows });
  })
);

export default router;
