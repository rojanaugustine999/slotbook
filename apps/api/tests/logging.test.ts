import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createLogger } from "../src/lib/logger.js";
import { resetDb } from "./helpers/db.js";

// Every log line is captured here instead of being printed, so tests can read it.
type LogLine = { level: number; msg: string; userId?: string; responseTime?: number; req?: { id: string; method: string; url: string }; res?: { statusCode: number } };
const lines: LogLine[] = [];
const logger = createLogger({ level: "info", stream: { write: (chunk: string) => void lines.push(JSON.parse(chunk)) } });
const app = createApp({ logger });

// The log line is written when the response finishes, which can be a moment after
// the test receives the response. Give it a beat before reading.
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const INFO = 30;
const WARN = 40;

beforeEach(async () => {
  await resetDb();
  lines.length = 0;
});

describe("request logging", () => {
  it("writes one structured line per request, without the query string", async () => {
    await request(app).get("/b/no-such-salon?secret=abc123");
    await settle();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: "request completed", req: { method: "GET", url: "/b/no-such-salon" }, res: { statusCode: 404 } });
    expect(typeof lines[0]!.responseTime).toBe("number");
    expect(JSON.stringify(lines)).not.toContain("abc123");
  });

  it("uses the level that matches the outcome", async () => {
    await request(app).post("/auth/register").send({ email: "maya@example.com", password: "correct-horse-42", name: "Maya" });
    await request(app).get("/b/no-such-salon");
    await settle();

    expect(lines.map((l) => [l.res?.statusCode, l.level])).toEqual([
      [201, INFO], // success: info
      [404, WARN], // client mistake: warn
    ]);
  });

  it("never writes passwords, tokens or the Authorization header", async () => {
    const register = await request(app).post("/auth/register").send({ email: "maya@example.com", password: "correct-horse-42", name: "Maya" });
    const token = register.body.accessToken as string;
    await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    await request(app).post("/auth/login").send({ email: "maya@example.com", password: "correct-horse-42" });
    await settle();

    const everything = JSON.stringify(lines).toLowerCase();
    expect(lines.length).toBe(3);
    expect(everything).not.toContain("correct-horse-42");
    expect(everything).not.toContain(token.toLowerCase());
    expect(everything).not.toContain("authorization");
    expect(everything).not.toContain("sb_refresh");
  });

  it("records which user made an authenticated request", async () => {
    const register = await request(app).post("/auth/register").send({ email: "maya@example.com", password: "correct-horse-42", name: "Maya" });
    lines.length = 0;

    await request(app).get("/auth/me").set("Authorization", `Bearer ${register.body.accessToken}`);
    await settle();

    expect(lines[0]!.userId).toBe(register.body.user.id);
  });

  it("does not log health checks", async () => {
    await request(app).get("/health");
    await settle();

    expect(lines).toEqual([]);
  });
});

describe("request ids", () => {
  it("gives every response an X-Request-Id that matches its log line", async () => {
    const res = await request(app).get("/b/no-such-salon");
    await settle();

    const id = res.headers["x-request-id"];
    expect(id).toMatch(/^[0-9a-f-]{36}$/); // a generated UUID
    expect(lines[0]!.req!.id).toBe(id);
  });

  it("keeps an id the caller sent, so one trace can span several systems", async () => {
    const res = await request(app).get("/b/no-such-salon").set("X-Request-Id", "frontend-trace-12345");
    await settle();

    expect(res.headers["x-request-id"]).toBe("frontend-trace-12345");
    expect(lines[0]!.req!.id).toBe("frontend-trace-12345");
  });

  it("replaces a suspicious id instead of copying it into the logs", async () => {
    const res = await request(app).get("/b/no-such-salon").set("X-Request-Id", 'x" , "level":60, "msg":"forged');
    await settle();

    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(lines)).not.toContain("forged");
  });
});
