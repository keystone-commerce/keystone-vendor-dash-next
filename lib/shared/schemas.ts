import { z } from "zod";
import { BillStatus, UserRole, VENDOR_CATEGORIES, VendorStatus } from "./enums";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1),
  role: z.nativeEnum(UserRole),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.partial();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const vendorCategoryValues = [...VENDOR_CATEGORIES] as [string, ...string[]];
export const vendorStatusValues = Object.values(VendorStatus) as [string, ...string[]];

export const createVendorSchema = z.object({
  name: z.string().min(1, "Vendor name is required"),
  category: z.enum(vendorCategoryValues),
  status: z.nativeEnum(VendorStatus).default(VendorStatus.ACTIVE),
  // Required: all three are printed in the Supplier Details block of every PO.
  contactName: z.string().trim().min(1, "Contact person is required"),
  phone: z.string().trim().regex(/^\d{10}$/, "Mobile number must be exactly 10 digits"),
  email: z.string().trim().email("A valid email is required"),
  contractValue: z.number().int().min(0, "Contract value cannot be negative"),
  rating: z.number().int().min(0).max(5).default(0),
  contractStart: z.string().optional().nullable(),
  contractEnd: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type CreateVendorInput = z.infer<typeof createVendorSchema>;

export const updateVendorSchema = createVendorSchema.partial();
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;

export const stageTransitionSchema = z
  .object({
    direction: z.enum(["advance", "back"]).optional(),
    targetStage: z.string().optional(),
  })
  .refine((v) => v.direction || v.targetStage, {
    message: "Either direction or targetStage must be provided",
  });
export type StageTransitionInput = z.infer<typeof stageTransitionSchema>;

export const createCatalogueSchema = z.object({
  title: z.string().min(1),
  driveFileId: z.string().optional().nullable(),
  viewUrl: z.string().url().optional().nullable().or(z.literal("")),
  uploadedAt: z.string().optional(),
});
export type CreateCatalogueInput = z.infer<typeof createCatalogueSchema>;

export const createBillSchema = z.object({
  billNumber: z.string().min(1),
  amount: z.number().int().min(0),
  billDate: z.string().optional(),
  status: z.nativeEnum(BillStatus).default(BillStatus.UNPAID),
  driveFileId: z.string().optional().nullable(),
  viewUrl: z.string().url().optional().nullable().or(z.literal("")),
});
export type CreateBillInput = z.infer<typeof createBillSchema>;

export const updateBillSchema = z.object({
  billNumber: z.string().min(1).optional(),
  amount: z.number().int().min(0).optional(),
  billDate: z.string().optional(),
  status: z.nativeEnum(BillStatus).optional(),
});
export type UpdateBillInput = z.infer<typeof updateBillSchema>;

export const assignFileSchema = z.object({
  vendorId: z.string().uuid(),
});
export type AssignFileInput = z.infer<typeof assignFileSchema>;
