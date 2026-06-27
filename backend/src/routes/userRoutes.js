import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { ApiError, asyncHandler } from "../middleware/error.js";

const router = Router();
router.use(requireAuth);

const settingsSchema = z.object({
  preferredSignLanguage: z.enum(["ASL", "ISL", "BSL"]).optional(),
  preferredOutput: z.enum(["text", "speech", "both"]).optional(),
  preferredSpokenLanguage: z.string().optional(),
  accessibilitySettings: z
    .object({
      highContrast: z.boolean().optional(),
      darkMode: z.boolean().optional(),
      textSize: z.enum(["small", "medium", "large", "extra_large"]).optional(),
      reduceMotion: z.boolean().optional(),
      voiceSpeed: z.number().min(0.5).max(2.0).optional(),
    })
    .partial()
    .optional(),
});

router.patch(
  "/settings",
  asyncHandler(async (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, "validation_error", "Invalid settings payload", parsed.error.flatten());
    }
    const data = parsed.data;

    // Merge accessibility settings rather than overwrite, so partial updates don't wipe other prefs
    const current = await query(`SELECT accessibility_settings FROM users WHERE id = $1`, [req.user.sub]);
    const mergedAccessibility = {
      ...current.rows[0].accessibility_settings,
      ...(data.accessibilitySettings ?? {}),
    };

    const updated = await query(
      `UPDATE users SET
         preferred_sign_language = COALESCE($2, preferred_sign_language),
         preferred_output = COALESCE($3, preferred_output),
         preferred_spoken_language = COALESCE($4, preferred_spoken_language),
         accessibility_settings = $5
       WHERE id = $1
       RETURNING *`,
      [
        req.user.sub,
        data.preferredSignLanguage ?? null,
        data.preferredOutput ?? null,
        data.preferredSpokenLanguage ?? null,
        JSON.stringify(mergedAccessibility),
      ]
    );

    res.json({
      preferredSignLanguage: updated.rows[0].preferred_sign_language,
      preferredOutput: updated.rows[0].preferred_output,
      preferredSpokenLanguage: updated.rows[0].preferred_spoken_language,
      accessibilitySettings: updated.rows[0].accessibility_settings,
    });
  })
);

export default router;
