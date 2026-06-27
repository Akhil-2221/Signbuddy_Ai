import { verifyAccessToken } from "../utils/auth.js";

/**
 * Requires a valid access token. Populates req.user.
 * Anonymous/guest sessions are NOT allowed past this middleware —
 * use `optionalAuth` for routes that work for both guests and users.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_token", message: "Authorization header required" });
  }
  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "invalid_token", message: "Token is invalid or expired" });
  }
}

/**
 * Attaches req.user if a valid token is present, but does not block the request otherwise.
 * Used for routes like emergency phrases that should work for guests too.
 */
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      req.user = verifyAccessToken(header.slice(7));
    } catch {
      req.user = null;
    }
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "forbidden", message: "Insufficient permissions" });
    }
    return next();
  };
}
