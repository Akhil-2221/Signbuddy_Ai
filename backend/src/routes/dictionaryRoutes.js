import { Router } from "express";
import { query } from "../db/pool.js";
import { asyncHandler } from "../middleware/error.js";

const router = Router();

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { signLanguage = "ASL", category, search } = req.query;
    const conditions = ["sign_language = $1"];
    const params = [signLanguage];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (search) {
      params.push(`%${search.toUpperCase()}%`);
      conditions.push(`gloss ILIKE $${params.length}`);
    }

    const result = await query(
      `SELECT * FROM sign_dictionary WHERE ${conditions.join(" AND ")} ORDER BY gloss ASC LIMIT 100`,
      params
    );
    res.json({ signs: result.rows });
  })
);

router.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const signLanguage = req.query.signLanguage || "ASL";
    const result = await query(
      `SELECT DISTINCT category FROM sign_dictionary WHERE sign_language = $1 AND category IS NOT NULL`,
      [signLanguage]
    );
    res.json({ categories: result.rows.map((r) => r.category) });
  })
);

export default router;
