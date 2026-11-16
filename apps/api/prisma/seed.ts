// Demo data so you have something to look at right away.
//   npm run db:seed
// Demo login (local development only): owner@slotbook.test / password123
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const owner = await prisma.user.upsert({
    where: { email: "owner@slotbook.test" },
    update: {},
    create: {
      email: "owner@slotbook.test",
      name: "Demo Owner",
      passwordHash: await bcrypt.hash("password123", 12),
    },
  });

  const existing = await prisma.business.findUnique({ where: { slug: "glow-salon" } });
  if (existing) {
    console.log("Seed data already exists, skipping.");
    return;
  }

  const business = await prisma.business.create({
    data: {
      ownerId: owner.id,
      name: "Glow Salon",
      slug: "glow-salon",
      timezone: "Asia/Kolkata",
      address: "MG Road, Kochi",
      minNoticeMinutes: 60,
      maxAdvanceDays: 30,
    },
  });

  const [haircut, facial, colour] = await Promise.all([
    prisma.service.create({ data: { businessId: business.id, name: "Haircut", durationMin: 45, bufferMin: 15, priceCents: 50000 } }),
    prisma.service.create({ data: { businessId: business.id, name: "Facial", durationMin: 60, bufferMin: 10, priceCents: 120000 } }),
    prisma.service.create({ data: { businessId: business.id, name: "Hair Colour", durationMin: 90, bufferMin: 15, priceCents: 250000 } }),
  ]);

  const staffMembers = [
    { name: "Priya", services: [haircut!, colour!] },
    { name: "Arjun", services: [haircut!, facial!] },
  ];

  for (const s of staffMembers) {
    const staff = await prisma.staff.create({
      data: {
        businessId: business.id,
        name: s.name,
        services: { create: s.services.map((svc) => ({ serviceId: svc.id })) },
        // Monday–Saturday: 09:00–13:00 and 14:00–18:00 (lunch break 13:00–14:00)
        workingHours: {
          create: [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
            { weekday, startMinute: 9 * 60, endMinute: 13 * 60 },
            { weekday, startMinute: 14 * 60, endMinute: 18 * 60 },
          ]),
        },
      },
    });
    console.log(`Created staff ${staff.name}`);
  }

  console.log("Seeded Glow Salon → GET http://localhost:4000/b/glow-salon");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
