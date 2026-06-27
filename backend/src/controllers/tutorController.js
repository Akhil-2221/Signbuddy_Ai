import { z } from "zod";
import { query } from "../db/pool.js";
import { ApiError, asyncHandler } from "../middleware/error.js";
import { scorePracticeAttempt } from "../services/aiServiceClient.js";

export const listLessons = asyncHandler(async (req, res) => {
  const signLanguage = req.query.signLanguage || "ASL";
  const result = await query(
    `SELECT * FROM lessons WHERE sign_language = $1 ORDER BY order_index ASC`,
    [signLanguage]
  );
  res.json({ lessons: result.rows });
});

export const getLesson = asyncHandler(async (req, res) => {
  const { lessonId } = req.params;
  const lessonResult = await query(`SELECT * FROM lessons WHERE id = $1`, [lessonId]);
  if (lessonResult.rows.length === 0) {
    throw new ApiError(404, "lesson_not_found", "Lesson not found");
  }
  const lesson = lessonResult.rows[0];

  const signsResult = await query(
    `SELECT * FROM sign_dictionary WHERE id = ANY($1::uuid[])`,
    [lesson.sign_ids]
  );

  res.json({ lesson, signs: signsResult.rows });
});

export const getUserProgress = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT ulp.*, l.title, l.difficulty_level
     FROM user_lesson_progress ulp
     JOIN lessons l ON l.id = ulp.lesson_id
     WHERE ulp.user_id = $1
     ORDER BY ulp.last_attempted_at DESC NULLS LAST`,
    [req.user.sub]
  );
  res.json({ progress: result.rows });
});

const practiceSchema = z.object({
  signId: z.string().uuid(),
  signLanguage: z.enum(["ASL", "ISL", "BSL"]),
  frames: z.array(z.record(z.any())).min(1),
  lessonId: z.string().uuid().optional(),
});

export const submitPracticeAttempt = asyncHandler(async (req, res) => {
  const parsed = practiceSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", "Invalid practice payload", parsed.error.flatten());
  }
  const { signId, signLanguage, frames, lessonId } = parsed.data;

  const signResult = await query(`SELECT gloss FROM sign_dictionary WHERE id = $1`, [signId]);
  if (signResult.rows.length === 0) {
    throw new ApiError(404, "sign_not_found", "Target sign not found");
  }
  const targetGloss = signResult.rows[0].gloss;

  const aiResult = await scorePracticeAttempt({
    frames,
    targetSignId: signId,
    signLanguage,
  });

  const attempt = await query(
    `INSERT INTO practice_attempts (user_id, sign_id, predicted_gloss, target_gloss, confidence_score, is_correct)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [req.user.sub, signId, aiResult.predictedGloss, targetGloss, aiResult.confidence, aiResult.isCorrect]
  );

  // Update lesson progress if part of a lesson
  if (lessonId) {
    await query(
      `INSERT INTO user_lesson_progress (user_id, lesson_id, status, best_score, attempts_count, last_attempted_at)
       VALUES ($1, $2, 'in_progress', $3, 1, now())
       ON CONFLICT (user_id, lesson_id)
       DO UPDATE SET
         attempts_count = user_lesson_progress.attempts_count + 1,
         best_score = GREATEST(user_lesson_progress.best_score, $3),
         last_attempted_at = now(),
         status = CASE WHEN user_lesson_progress.status = 'completed' THEN 'completed' ELSE 'in_progress' END`,
      [req.user.sub, lessonId, aiResult.isCorrect ? 100 : aiResult.confidence * 100]
    );
  }

  res.json({ attempt: attempt.rows[0], result: aiResult });
});

export const completeLesson = asyncHandler(async (req, res) => {
  const { lessonId } = req.params;
  const updated = await query(
    `UPDATE user_lesson_progress
     SET status = 'completed', completed_at = now()
     WHERE user_id = $1 AND lesson_id = $2
     RETURNING *`,
    [req.user.sub, lessonId]
  );
  if (updated.rows.length === 0) {
    throw new ApiError(404, "progress_not_found", "No progress record found for this lesson");
  }
  res.json({ progress: updated.rows[0] });
});

/**
 * Personalized recommendations: simple heuristic for now —
 * recommend the next not-completed lesson ordered by difficulty,
 * plus any lesson where best_score < 70% for review.
 * Replace with a real recommender once usage data accumulates.
 */
export const getRecommendations = asyncHandler(async (req, res) => {
  const signLanguage = req.query.signLanguage || "ASL";

  const nextLesson = await query(
    `SELECT l.* FROM lessons l
     LEFT JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id AND ulp.user_id = $1
     WHERE l.sign_language = $2 AND (ulp.status IS NULL OR ulp.status != 'completed')
     ORDER BY l.order_index ASC
     LIMIT 1`,
    [req.user.sub, signLanguage]
  );

  const reviewLessons = await query(
    `SELECT l.*, ulp.best_score FROM lessons l
     JOIN user_lesson_progress ulp ON ulp.lesson_id = l.id
     WHERE ulp.user_id = $1 AND ulp.best_score < 70
     ORDER BY ulp.best_score ASC
     LIMIT 3`,
    [req.user.sub]
  );

  res.json({
    nextLesson: nextLesson.rows[0] ?? null,
    reviewLessons: reviewLessons.rows,
  });
});
