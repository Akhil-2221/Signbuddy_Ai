import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";

/**
 * Integration tests against a real Postgres test database (see .github/workflows/ci.yml
 * and database/migrations/001_init_schema.sql for setup). Run locally with:
 *
 *   createdb signbuddy_test
 *   psql signbuddy_test -f ../database/migrations/001_init_schema.sql
 *   DATABASE_URL=postgresql://signbuddy:signbuddy_dev_password@localhost:5432/signbuddy_test npm test
 */

afterAll(async () => {
  await pool.end();
});

describe("POST /api/v1/auth/guest", () => {
  it("creates an anonymous guest user and returns tokens", async () => {
    const res = await request(app).post("/api/v1/auth/guest").send({ signLanguage: "ASL" });

    expect(res.status).toBe(201);
    expect(res.body.user.isAnonymous).toBe(true);
    expect(res.body.user.preferredSignLanguage).toBe("ASL");
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
  });
});

describe("POST /api/v1/auth/register + /login", () => {
  const testEmail = `test-${Date.now()}@example.com`;

  it("registers a new user", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      email: testEmail,
      password: "supersecure123",
      fullName: "Test User",
      role: "deaf_user",
    });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(testEmail);
    expect(res.body.user.role).toBe("deaf_user");
  });

  it("rejects duplicate registration", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      email: testEmail,
      password: "supersecure123",
      fullName: "Test User Again",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("user_exists");
  });

  it("logs in with correct credentials", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({
      identifier: testEmail,
      password: "supersecure123",
    });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(testEmail);
  });

  it("rejects login with wrong password", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({
      identifier: testEmail,
      password: "wrongpassword",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_credentials");
  });
});

describe("GET /api/v1/auth/me", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns the current user with a valid token", async () => {
    const guestRes = await request(app).post("/api/v1/auth/guest").send({});
    const token = guestRes.body.accessToken;

    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(guestRes.body.user.id);
  });
});
