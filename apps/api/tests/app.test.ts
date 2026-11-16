import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

// These tests don't touch the database, so they run without Postgres.
// Week 2 task: add auth tests against a real test database (slotbook_test).
const app = createApp();

describe("app basics", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("unknown routes return a JSON 404", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("protected routes reject requests without a token", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("invalid bodies return a 400 with field errors", async () => {
    const res = await request(app).post("/auth/register").send({ email: "not-an-email", password: "123" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details).toHaveProperty("email");
    expect(res.body.error.details).toHaveProperty("password");
  });

  it("malformed JSON returns a 400", async () => {
    const res = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send("{ not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_JSON");
  });
});
