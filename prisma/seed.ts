import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const hash = (pw: string) => bcrypt.hash(pw, 12);

  const sarthak = await prisma.user.upsert({
    where: { username: "sarthak" },
    update: {},
    create: {
      username: "sarthak",
      passwordHash: await hash("nutritrack123"),
      profile: {
        create: {
          kcalTarget: 2200,
          proteinTarget: 150,
          carbsTarget: 250,
          fatTarget: 75,
          fiberTarget: 30,
        },
      },
    },
  });

  const wife = await prisma.user.upsert({
    where: { username: "kavya" },
    update: {},
    create: {
      username: "kavya",
      passwordHash: await hash("nutritrack123"),
      profile: {
        create: {
          kcalTarget: 1800,
          proteinTarget: 100,
          carbsTarget: 200,
          fatTarget: 60,
          fiberTarget: 25,
        },
      },
    },
  });

  await prisma.buddyRelationship.upsert({
    where: { requesterId_addresseeId: { requesterId: sarthak.id, addresseeId: wife.id } },
    update: { status: "ACCEPTED" },
    create: { requesterId: sarthak.id, addresseeId: wife.id, status: "ACCEPTED" },
  });

  console.log("✅ Seeded users: sarthak / kavya (both password: nutritrack123)");
  console.log("   They are already buddies!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
