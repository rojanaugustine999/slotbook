import { Router, type CookieOptions, type Response } from "express";
import { isProd } from "../../lib/env.js";
import { currentUserId, requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { loginSchema, registerSchema } from "./auth.schema.js";
import * as auth from "./auth.service.js";

const REFRESH_COOKIE = "sb_refresh";

const cookieOptions: CookieOptions = {
  httpOnly: true, // JavaScript in the browser can't read it
  secure: isProd, // HTTPS only in production
  // Frontend (Vercel) and API (Render) are different sites in production,
  // which requires SameSite=None (+ Secure). Locally, Lax works on localhost.
  sameSite: isProd ? "none" : "lax",
  path: "/auth", // the browser only sends it to /auth/* routes
};

function setRefreshCookie(res: Response, token: string, expires: Date) {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions, expires });
}

export const authRouter = Router();

authRouter.post("/register", validateBody(registerSchema), async (req, res) => {
  const { user, accessToken, refreshToken, refreshExpiresAt } = await auth.register(req.body);
  setRefreshCookie(res, refreshToken, refreshExpiresAt);
  res.status(201).json({ user, accessToken });
});

authRouter.post("/login", validateBody(loginSchema), async (req, res) => {
  const { user, accessToken, refreshToken, refreshExpiresAt } = await auth.login(req.body);
  setRefreshCookie(res, refreshToken, refreshExpiresAt);
  res.json({ user, accessToken });
});

authRouter.post("/refresh", async (req, res) => {
  const { accessToken, refreshToken, refreshExpiresAt } = await auth.refresh(req.cookies?.[REFRESH_COOKIE]);
  setRefreshCookie(res, refreshToken, refreshExpiresAt);
  res.json({ accessToken });
});

authRouter.post("/logout", async (req, res) => {
  await auth.logout(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ user: await auth.getMe(currentUserId(req)) });
});
