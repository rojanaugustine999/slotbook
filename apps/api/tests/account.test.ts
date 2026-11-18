import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/db.js";
import { resetDb } from "./helpers/db.js";

const app = createApp();
const EMAIL = "asha@example.test";
const PASSWORD = "correct-horse-42";

beforeEach(async () => {
  await resetDb();
});

/**
 * One "device": a supertest agent keeps its own cookies, like a browser keeps the refresh
 * cookie. Signing in from two agents gives two separate sessions.
 */
async function device(signUp = false) {
  const agent = request.agent(app);
  const res = signUp
    ? await agent.post("/auth/register").send({ email: EMAIL, password: PASSWORD, name: "Asha Menon", phone: "+91 98765 43210" })
    : await agent.post("/auth/login").send({ email: EMAIL, password: PASSWORD });
  return { agent, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
}

describe("a phone number at sign-up", () => {
  const signUp = (phone?: string) => request(app).post("/auth/register").send({ email: EMAIL, password: PASSWORD, name: "Asha Menon", phone });

  it("is saved when given", async () => {
    const res = await signUp("+91 98765 43210");
    expect(res.status).toBe(201);
    expect(res.body.user.phone).toBe("+91 98765 43210");
  });

  it("is required: left out or left empty, no account is made", async () => {
    for (const phone of [undefined, "", "   "]) {
      const res = await signUp(phone);
      expect(res.status).toBe(400);
      expect(res.body.error.details.phone).toEqual(["enter your phone number"]);
    }
    expect(await prisma.user.count()).toBe(0);
  });

  it("follows the same rule as the Account page", async () => {
    const res = await signUp("not a number");
    expect(res.status).toBe(400);
    expect(res.body.error.details.phone).toBeDefined(); // shown under the phone box
  });
});

describe("PATCH /auth/me", () => {
  it("updates your name and phone", async () => {
    const me = await device(true);

    const res = await me.agent.patch("/auth/me").set(me.auth).send({ name: "Asha M.", phone: "+91 98765 43210" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: "Asha M.", phone: "+91 98765 43210", email: EMAIL });
  });

  it("the phone can be changed but not removed", async () => {
    const me = await device(true);

    expect((await me.agent.patch("/auth/me").set(me.auth).send({ phone: "" })).status).toBe(400);
    expect((await me.agent.patch("/auth/me").set(me.auth).send({ phone: null })).status).toBe(400);
    expect((await me.agent.patch("/auth/me").set(me.auth).send({ phone: "98765 00000" })).body.user.phone).toBe("98765 00000");
  });

  it("someone from before phones were required can still save just a new name", async () => {
    const me = await device(true);
    await prisma.user.update({ where: { email: EMAIL }, data: { phone: null } }); // an older account

    const res = await me.agent.patch("/auth/me").set(me.auth).send({ name: "Asha M." });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: "Asha M.", phone: null });
  });

  it("refuses a phone that isn't a phone number, and an empty request", async () => {
    const me = await device(true);
    expect((await me.agent.patch("/auth/me").set(me.auth).send({ phone: "call me maybe" })).status).toBe(400);
    expect((await me.agent.patch("/auth/me").set(me.auth).send({})).status).toBe(400);
  });

  it("never changes the email or admin rights, whatever is sent", async () => {
    const me = await device(true);

    await me.agent.patch("/auth/me").set(me.auth).send({ name: "Asha", email: "attacker@example.test", isPlatformAdmin: true }).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.isPlatformAdmin).toBe(false);
  });

  it("needs a login", async () => {
    expect((await request(app).patch("/auth/me").send({ name: "X" })).status).toBe(401);
  });
});

describe("POST /auth/password", () => {
  it("changes the password: the new one works, the old one doesn't", async () => {
    const me = await device(true);

    const res = await me.agent.post("/auth/password").set(me.auth).send({ currentPassword: PASSWORD, newPassword: "new-secret-77" });

    expect(res.status).toBe(200);
    expect((await request(app).post("/auth/login").send({ email: EMAIL, password: PASSWORD })).status).toBe(401);
    expect((await request(app).post("/auth/login").send({ email: EMAIL, password: "new-secret-77" })).status).toBe(200);
  });

  it("refuses a wrong current password with 400, not 401 (a 401 would look like an expired session)", async () => {
    const me = await device(true);

    const res = await me.agent.post("/auth/password").set(me.auth).send({ currentPassword: "guess-guess", newPassword: "new-secret-77" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WRONG_PASSWORD");
  });

  it("refuses the same password again, and a too-short one", async () => {
    const me = await device(true);
    expect((await me.agent.post("/auth/password").set(me.auth).send({ currentPassword: PASSWORD, newPassword: PASSWORD })).body.error.code).toBe("SAME_PASSWORD");
    expect((await me.agent.post("/auth/password").set(me.auth).send({ currentPassword: PASSWORD, newPassword: "short" })).status).toBe(400);
  });

  it("signs out every other device, but keeps this one", async () => {
    const laptop = await device(true);
    const phone = await device();

    const res = await laptop.agent.post("/auth/password").set(laptop.auth).send({ currentPassword: PASSWORD, newPassword: "new-secret-77" });

    expect(res.body.signedOutOtherDevices).toBe(1);
    expect((await phone.agent.post("/auth/refresh")).status).toBe(401);
    expect((await laptop.agent.post("/auth/refresh")).status).toBe(200);
  });
});

describe("POST /auth/sessions/revoke-others", () => {
  it("signs out the other devices and keeps this one", async () => {
    const laptop = await device(true);
    const phone = await device();
    const tablet = await device();

    const res = await laptop.agent.post("/auth/sessions/revoke-others").set(laptop.auth);

    expect(res.body.signedOutOtherDevices).toBe(2);
    expect((await phone.agent.post("/auth/refresh")).status).toBe(401);
    expect((await tablet.agent.post("/auth/refresh")).status).toBe(401);
    expect((await laptop.agent.post("/auth/refresh")).status).toBe(200);
  });

  it("a signed-out device trying to refresh doesn't trigger the theft alarm and sign THIS device out", async () => {
    // Refresh tokens are single-use: a REVOKED one coming back is treated as theft and every
    // session is ended. Revoke-others deletes tokens instead, so this must not happen.
    const laptop = await device(true);
    const phone = await device();
    await laptop.agent.post("/auth/sessions/revoke-others").set(laptop.auth).expect(200);

    await phone.agent.post("/auth/refresh").expect(401); // the old phone tries its token
    await phone.agent.post("/auth/refresh").expect(401); // ...twice

    expect((await laptop.agent.post("/auth/refresh")).status).toBe(200); // still signed in
  });
});
