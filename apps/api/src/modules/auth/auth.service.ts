import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/db.js";
import { env } from "../../lib/env.js";
import { conflict, unauthorized } from "../../lib/errors.js";
import type { LoginInput, RegisterInput } from "./auth.schema.js";

// ─── How auth works in SlotBook ──────────────────────────────────────────────
// ACCESS token  : short-lived JWT (15 min). Sent as "Authorization: Bearer ...".
//                 Stateless: the server just checks the signature, no DB lookup.
// REFRESH token : long random string (30 days) in an httpOnly cookie, which JavaScript
//                 can't read, so an XSS bug can't steal it. Stored in the DB as a
//                 hash so it can be revoked (logout), and ROTATED on every use.
// Rotation + reuse detection: if an already-used refresh token shows up again,
// someone probably stole it, so we revoke every session for that user.
// ──────────────────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;
// Used when the email doesn't exist, so login takes the same time either way.
// Without it, attackers could tell which emails are registered by timing responses.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_ROUNDS);

export const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  createdAt: true,
} as const;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function signAccessToken(userId: string) {
  return jwt.sign({}, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
  });
}

async function issueTokens(userId: string) {
  const refreshToken = randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { userId, tokenHash: sha256(refreshToken), expiresAt },
  });

  return { accessToken: signAccessToken(userId), refreshToken, refreshExpiresAt: expiresAt };
}

export async function register(input: RegisterInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict("An account with this email already exists");

  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      phone: input.phone,
      passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
    },
    select: publicUserSelect,
  });

  return { user, ...(await issueTokens(user.id)) };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);

  // Same message for "no such email" and "wrong password", so we don't reveal which.
  if (!user || !ok) throw unauthorized("Email or password is incorrect");

  const { passwordHash: _omit, updatedAt: _u, ...publicUser } = user;
  return { user: publicUser, ...(await issueTokens(user.id)) };
}

export async function refresh(refreshToken: string | undefined) {
  if (!refreshToken) throw unauthorized("No refresh token");

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(refreshToken) },
  });
  if (!stored) throw unauthorized("Invalid refresh token");

  if (stored.revokedAt) {
    // Reuse detected: revoke every active session for this user.
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized("Session expired, please sign in again");
  }

  if (stored.expiresAt < new Date()) throw unauthorized("Session expired, please sign in again");

  // Rotate: the old token is single-use.
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  return issueTokens(stored.userId);
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function getMe(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: publicUserSelect });
}
