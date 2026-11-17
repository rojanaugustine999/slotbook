// Grants (or removes) SlotBook super admin for one existing account.
//
//   npm run admin:grant -- someone@example.com
//   npm run admin:grant -- someone@example.com --revoke
//
// This script is deliberately the ONLY way to become a super admin. There is no API route
// for it, so no request from the internet, however crafted, can make anyone an admin.
// It talks to whatever database DATABASE_URL points at, so check that first.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const revoke = process.argv.includes("--revoke");
  if (!email || !email.includes("@")) {
    console.error("Usage: npm run admin:grant -- someone@example.com [--revoke]");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account with the email ${email}. They need to sign up first.`);
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: !revoke } });
  console.log(revoke ? `${email} is no longer a super admin.` : `${email} is now a SlotBook super admin.`);
}

await main();
await prisma.$disconnect();
