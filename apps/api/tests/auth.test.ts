import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { resetDb } from "./helpers/db.js";

const app = createApp();

// A made-up person used in every test.
const maya = { email: "maya@example.com", password: "correct-horse-42", name: "Maya" };

// Start every test with empty tables.
beforeEach(async () => {
  await resetDb();
});

describe("register", () => {
  it("creates an account and returns an access token", async () => {
    const res = await request(app).post("/auth/register").send(maya);

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(maya.email);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it("never sends the password back", async () => {
    const res = await request(app).post("/auth/register").send(maya);

    expect(res.body.user).not.toHaveProperty("password");
    expect(res.body.user).not.toHaveProperty("passwordHash");
  });

  it("stores a hash in the database, not the real password", async () => {
    await request(app).post("/auth/register").send(maya);

    const row = await prisma.user.findUniqueOrThrow({ where: { email: maya.email } });
    expect(row.passwordHash).not.toBe(maya.password);
    expect(row.passwordHash.startsWith("$2")).toBe(true); // every bcrypt hash starts with $2
  });

  it("puts the refresh token in a cookie that JavaScript cannot read", async () => {
    const res = await request(app).post("/auth/register").send(maya);

    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toContain("sb_refresh=");
    expect(cookie).toContain("HttpOnly");
    expect(res.body).not.toHaveProperty("refreshToken"); // only in the cookie, never in the body
  });

  it("refuses a second account with the same email", async () => {
    await request(app).post("/auth/register").send(maya);
    const res = await request(app).post("/auth/register").send(maya);

    expect(res.status).toBe(409);
  });
});

describe("login", () => {
  beforeEach(async () => {
    await request(app).post("/auth/register").send(maya);
  });

  it("works with the right password", async () => {
    const res = await request(app).post("/auth/login").send({ email: maya.email, password: maya.password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const wrongPassword = await request(app).post("/auth/login").send({ email: maya.email, password: "wrong-password" });
    const unknownEmail = await request(app).post("/auth/login").send({ email: "nobody@example.com", password: "wrong-password" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Identical messages, so an attacker can't find out which emails have accounts.
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });
});

describe("access token", () => {
  it("lets you read your own profile", async () => {
    const { body } = await request(app).post("/auth/register").send(maya);

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${body.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(maya.email);
  });

  it("is rejected when it has been tampered with", async () => {
    const { body } = await request(app).post("/auth/register").send(maya);

    const res = await request(app).get("/auth/me").set("Authorization", `Bearer ${body.accessToken}x`);

    expect(res.status).toBe(401);
  });
});

describe("refresh token", () => {
  it("gives a new access token, and each refresh token works only once", async () => {
    // An "agent" remembers cookies between requests, like a browser does.
    const browser = request.agent(app);
    const register = await browser.post("/auth/register").send(maya);
    const firstCookie = String(register.headers["set-cookie"]).split(";")[0]!;

    const refresh = await browser.post("/auth/refresh");
    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toEqual(expect.any(String));

    // Replaying the first (already used) cookie must fail.
    const replay = await request(app).post("/auth/refresh").set("Cookie", firstCookie);
    expect(replay.status).toBe(401);
  });

  it("signs out every session when a used token shows up again", async () => {
    const browser = request.agent(app);
    const register = await browser.post("/auth/register").send(maya);
    const stolenCookie = String(register.headers["set-cookie"]).split(";")[0]!;

    await browser.post("/auth/refresh"); // the real user refreshes: the first token is now used
    await request(app).post("/auth/refresh").set("Cookie", stolenCookie); // a thief replays it

    // The real user's newest token has been cancelled too, as a precaution.
    const res = await browser.post("/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("stops working after logout", async () => {
    const browser = request.agent(app);
    const register = await browser.post("/auth/register").send(maya);
    const cookie = String(register.headers["set-cookie"]).split(";")[0]!;

    const logout = await browser.post("/auth/logout");
    expect(logout.status).toBe(204);

    const res = await request(app).post("/auth/refresh").set("Cookie", cookie);
    expect(res.status).toBe(401);
  });
});
