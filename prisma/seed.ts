import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD;
  const primaryUsername = process.env.SEED_PRIMARY_USERNAME;
  const partnerUsername = process.env.SEED_PARTNER_USERNAME;

  if (!password || !primaryUsername || !partnerUsername) {
    throw new Error(
      "Seed requires env vars: SEED_PASSWORD, SEED_PRIMARY_USERNAME, SEED_PARTNER_USERNAME"
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const primary = await prisma.user.upsert({
    where: { username: primaryUsername },
    update: {},
    create: {
      username: primaryUsername,
      passwordHash,
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

  const partner = await prisma.user.upsert({
    where: { username: partnerUsername },
    update: {},
    create: {
      username: partnerUsername,
      passwordHash,
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
    where: { requesterId_addresseeId: { requesterId: primary.id, addresseeId: partner.id } },
    update: { status: "ACCEPTED" },
    create: { requesterId: primary.id, addresseeId: partner.id, status: "ACCEPTED" },
  });

  console.log(`✅ Seeded users: ${primaryUsername} / ${partnerUsername} (password from SEED_PASSWORD)`);
  console.log("   They are already buddies!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
