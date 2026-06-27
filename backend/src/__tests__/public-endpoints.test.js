import request from "supertest";
import { app } from "../app.js";
import { pool } from "../db/pool.js";

afterAll(async () => {
  await pool.end();
});

describe("GET /api/v1/emergency-phrases", () => {
  it("is accessible without authentication (no auth wall in a crisis)", async () => {
    const res = await request(app).get("/api/v1/emergency-phrases?signLanguage=ASL");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.phrases)).toBe(true);
  });

  it("returns phrases ordered by priority", async () => {
    const res = await request(app).get("/api/v1/emergency-phrases?signLanguage=ASL");
    const priorities = res.body.phrases.map((p) => p.priority_order);
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
  });
});

describe("GET /api/v1/dictionary", () => {
  it("returns dictionary entries filtered by sign language", async () => {
    const res = await request(app).get("/api/v1/dictionary?signLanguage=ASL");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.signs)).toBe(true);
    res.body.signs.forEach((s) => expect(s.sign_language).toBe("ASL"));
  });

  it("supports search by gloss", async () => {
    const res = await request(app).get("/api/v1/dictionary?signLanguage=ASL&search=hello");
    expect(res.status).toBe(200);
    res.body.signs.forEach((s) => expect(s.gloss.toUpperCase()).toContain("HELLO"));
  });
});

describe("GET /health", () => {
  it("reports server status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
