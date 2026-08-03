/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Seed data mirrors the prototype's 8 sample vendors so operators see the same reference
 * dashboard the design was built against. All money values are in paise (₹1 = 100 paise).
 */
async function main() {
  console.log("Seeding database…");

  // ── users ──────────────────────────────────────────────────────────────────
  const adminPassword = await bcrypt.hash("admin123", 10);
  const memberPassword = await bcrypt.hash("member123", 10);
  const viewerPassword = await bcrypt.hash("viewer123", 10);

  await prisma.user.upsert({
    where: { email: "admin@keystonecommerce.in" },
    update: {},
    create: {
      email: "admin@keystonecommerce.in",
      passwordHash: adminPassword,
      name: "Keystone Admin",
      role: "ADMIN",
    },
  });
  await prisma.user.upsert({
    where: { email: "procurement@keystonecommerce.in" },
    update: {},
    create: {
      email: "procurement@keystonecommerce.in",
      passwordHash: memberPassword,
      name: "Procurement Team",
      role: "PROCUREMENT_MEMBER",
    },
  });
  await prisma.user.upsert({
    where: { email: "viewer@keystonecommerce.in" },
    update: {},
    create: {
      email: "viewer@keystonecommerce.in",
      passwordHash: viewerPassword,
      name: "Read-only Viewer",
      role: "VIEWER",
    },
  });

  // ── vendors ────────────────────────────────────────────────────────────────
  const today = new Date();
  const daysFromNow = (n: number) => new Date(today.getTime() + n * 24 * 60 * 60 * 1000);

  /** Amounts are stored as integer paise. Multiply rupee-denominated seed values by 100. */
  const rup = (rupees: number) => rupees * 100;

  const vendors = [
    {
      name: "GreenPack Solutions",
      category: "PACKAGING" as const,
      stage: "IN_TALKS" as const,
      contactName: "Ritu Sharma",
      phone: "+91 98100 12345",
      email: "ritu@greenpack.io",
      contractValue: rup(180_000),
      rating: 3,
      contractStart: daysFromNow(-60),
      contractEnd: daysFromNow(300),
      catalogues: 0,
      bills: [] as { number: string; amount: number; status: "PAID" | "UNPAID" | "OVERDUE" }[],
    },
    {
      name: "OfficeMart Supplies",
      category: "OFFICE_SUPPLIES" as const,
      stage: "IN_TALKS" as const,
      contactName: "Suresh Rao",
      phone: "+91 98200 22222",
      email: "sales@officemart.in",
      contractValue: rup(45_000),
      rating: 2,
      contractStart: daysFromNow(-30),
      contractEnd: daysFromNow(20), // expiring within 30 days
      catalogues: 0,
      bills: [],
    },
    {
      name: "Falcon Raw Materials Co.",
      category: "RAW_MATERIALS" as const,
      stage: "IN_TALKS" as const,
      contactName: "Karan Mehta",
      phone: "+91 99000 44444",
      email: "karan@falconraw.com",
      contractValue: 0,
      rating: 0,
      catalogues: 0,
      bills: [],
    },
    {
      name: "NimbusTech IT Solutions",
      category: "IT_SERVICES" as const,
      stage: "CATALOGUE_RECEIVED" as const,
      contactName: "Karan Iyer",
      phone: "+91 90000 11111",
      email: "karan@nimbustech.io",
      contractValue: rup(620_000),
      rating: 4,
      contractStart: daysFromNow(-90),
      contractEnd: daysFromNow(280),
      catalogues: 1,
      bills: [],
    },
    {
      name: "Vertex Marketing Agency",
      category: "MARKETING" as const,
      stage: "CATALOGUE_RECEIVED" as const,
      contactName: "Ananya Patel",
      phone: "+91 90111 66666",
      email: "hello@vertexmarketing.co",
      contractValue: rup(275_000),
      rating: 4,
      contractStart: daysFromNow(-15),
      contractEnd: daysFromNow(25), // expiring within 30 days
      catalogues: 1,
      bills: [],
    },
    {
      name: "Sunrise Textiles Pvt Ltd",
      category: "RAW_MATERIALS" as const,
      stage: "PURCHASE_MADE" as const,
      contactName: "Meera Nair",
      phone: "+91 98000 55555",
      email: "meera@sunrisetextiles.in",
      contractValue: rup(850_000),
      rating: 5,
      contractStart: daysFromNow(-120),
      contractEnd: daysFromNow(240),
      catalogues: 0,
      bills: [
        { number: "INV-2001", amount: rup(400_000), status: "PAID" as const },
        { number: "INV-2002", amount: rup(230_000), status: "PAID" as const },
      ],
    },
    {
      name: "BlueDart Logistics",
      category: "LOGISTICS" as const,
      stage: "PURCHASE_MADE" as const,
      contactName: "Vikram Singh",
      phone: "+91 90333 77777",
      email: "vikram@bluedart-partner.com",
      contractValue: rup(420_000),
      rating: 4,
      contractStart: daysFromNow(-45),
      contractEnd: daysFromNow(320),
      catalogues: 0,
      bills: [{ number: "INV-2003", amount: rup(175_000), status: "UNPAID" as const }],
    },
    {
      name: "Crestline Consulting",
      category: "CONSULTING" as const,
      stage: "PURCHASE_MADE" as const,
      contactName: "Aditya Verma",
      phone: "+91 90555 33333",
      email: "aditya@crestline.co",
      contractValue: rup(350_000),
      rating: 4,
      contractStart: daysFromNow(-75),
      contractEnd: daysFromNow(180),
      catalogues: 0,
      bills: [{ number: "INV-2004", amount: rup(87_500), status: "OVERDUE" as const }],
    },
  ];

  // wipe existing vendor-side data for idempotent seeding
  await prisma.bill.deleteMany({});
  await prisma.catalogue.deleteMany({});
  await prisma.fileAssignment.deleteMany({});
  await prisma.ignoredFile.deleteMany({});
  await prisma.vendor.deleteMany({});

  for (const v of vendors) {
    const created = await prisma.vendor.create({
      data: {
        name: v.name,
        category: v.category,
        stage: v.stage,
        status: "ACTIVE",
        contactName: v.contactName,
        phone: v.phone,
        email: v.email,
        contractValue: v.contractValue,
        rating: v.rating,
        contractStart: v.contractStart,
        contractEnd: v.contractEnd,
      },
    });

    for (let i = 0; i < v.catalogues; i++) {
      await prisma.catalogue.create({
        data: {
          vendorId: created.id,
          title: `${v.name} — Catalogue ${i + 1}`,
          source: "MANUAL_UPLOAD",
        },
      });
    }
    for (const inv of v.bills) {
      await prisma.bill.create({
        data: {
          vendorId: created.id,
          billNumber: inv.number,
          amount: inv.amount,
          status: inv.status,
          source: "MANUAL_UPLOAD",
        },
      });
    }
  }

  console.log(`Seeded ${vendors.length} vendors, 3 users.`);
  console.log("Logins:");
  console.log("  admin@keystonecommerce.in / admin123");
  console.log("  procurement@keystonecommerce.in / member123");
  console.log("  viewer@keystonecommerce.in / viewer123");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
