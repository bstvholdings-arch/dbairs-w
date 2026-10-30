import { config } from "dotenv";

config();

const { prisma } = await import("./src/lib/prisma.ts");

try {
  const created = await prisma.adminUser.create({
    data: {
      username: "tmp_role_probe",
      passwordHash: "x",
      role: "finance",
      tenantId: null,
    },
    select: { id: true, username: true, role: true },
  });
  console.log("WRITE OK:", created);

  const filtered = await prisma.adminUser.findMany({
    where: { role: { in: ["super_admin", "finance", "tech", "support"] } },
    select: { username: true, role: true },
  });
  console.log("FILTER OK:", filtered);

  await prisma.adminUser.delete({ where: { id: created.id } });
  console.log("DELETE OK");
} catch (error) {
  console.log("FAILED:", error.message);
}

await prisma.$disconnect();
