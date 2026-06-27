import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { query, withTransaction } from "../db/pool.js";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../utils/auth.js";
import { ApiError, asyncHandler } from "../middleware/error.js";

const registerSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(7).optional(),
  password: z.string().min(8),
  fullName: z.string().min(1).max(120),
  role: z.enum(["deaf_user", "hearing_user", "interpreter"]).default("deaf_user"),
  preferredSignLanguage: z.enum(["ASL", "ISL", "BSL"]).default("ASL"),
  preferredSpokenLanguage: z.string().default("en"),
}).refine((data) => data.email || data.phone, {
  message: "Either email or phone is required",
});

function userResponse(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    preferredSignLanguage: row.preferred_sign_language,
    preferredOutput: row.preferred_output,
    preferredSpokenLanguage: row.preferred_spoken_language,
    accessibilitySettings: row.accessibility_settings,
    isAnonymous: row.is_anonymous,
  };
}

async function issueTokenPair(user) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id });

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '30 days')`,
    [user.id, await hashPassword(refreshToken)]
  );

  return { accessToken, refreshToken };
}

export const register = asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", "Invalid registration data", parsed.error.flatten());
  }
  const data = parsed.data;

  const existing = await query(
    `SELECT id FROM users WHERE email = $1 OR phone = $2`,
    [data.email ?? null, data.phone ?? null]
  );
  if (existing.rows.length > 0) {
    throw new ApiError(409, "user_exists", "An account with this email or phone already exists");
  }

  const passwordHash = await hashPassword(data.password);

  const result = await query(
    `INSERT INTO users (email, phone, password_hash, full_name, role, preferred_sign_language, preferred_spoken_language)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [data.email ?? null, data.phone ?? null, passwordHash, data.fullName, data.role, data.preferredSignLanguage, data.preferredSpokenLanguage]
  );

  const user = result.rows[0];
  const tokens = await issueTokenPair(user);

  res.status(201).json({ user: userResponse(user), ...tokens });
});

const loginSchema = z.object({
  identifier: z.string().min(1), // email or phone
  password: z.string().min(1),
});

export const login = asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, "validation_error", "Email/phone and password are required");
  }
  const { identifier, password } = parsed.data;

  const result = await query(
    `SELECT * FROM users WHERE (email = $1 OR phone = $1) AND deleted_at IS NULL`,
    [identifier]
  );
  const user = result.rows[0];
  if (!user || !user.password_hash) {
    throw new ApiError(401, "invalid_credentials", "Incorrect email/phone or password");
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    throw new ApiError(401, "invalid_credentials", "Incorrect email/phone or password");
  }

  await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
  const tokens = await issueTokenPair(user);

  res.json({ user: userResponse(user), ...tokens });
});

/**
 * Guest/anonymous session — critical for accessibility.
 * A deaf user in an emergency or unfamiliar setting should not be blocked by signup.
 * Creates a throwaway user row so the rest of the system (sessions, history) works uniformly.
 */
export const createGuestSession = asyncHandler(async (req, res) => {
  const guestId = uuidv4();
  const result = await query(
    `INSERT INTO users (full_name, role, is_anonymous, preferred_sign_language, preferred_spoken_language)
     VALUES ($1, 'deaf_user', TRUE, $2, $3)
     RETURNING *`,
    [`Guest-${guestId.slice(0, 8)}`, req.body?.signLanguage ?? "ASL", req.body?.spokenLanguage ?? "en"]
  );
  const user = result.rows[0];
  const tokens = await issueTokenPair(user);
  res.status(201).json({ user: userResponse(user), ...tokens });
});

export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    throw new ApiError(400, "missing_token", "refreshToken is required");
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new ApiError(401, "invalid_token", "Refresh token is invalid or expired");
  }

  const userResult = await query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [payload.sub]);
  const user = userResult.rows[0];
  if (!user) {
    throw new ApiError(401, "invalid_token", "User no longer exists");
  }

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  res.json({ accessToken });
});

export const logout = asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [req.user.sub]
    );
  });
  res.status(204).send();
});

export const getCurrentUser = asyncHandler(async (req, res) => {
  const result = await query(`SELECT * FROM users WHERE id = $1`, [req.user.sub]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "user_not_found", "User not found");
  }
  res.json({ user: userResponse(result.rows[0]) });
});
