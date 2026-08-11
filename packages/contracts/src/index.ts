import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(8).max(128);
export const idSchema = z.string().uuid();

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(120),
});

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1) });

export const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  universityName: z.string().trim().max(160).optional(),
  countryCode: z.string().trim().max(3).optional(),
  program: z.string().trim().max(160).optional(),
  faculty: z.string().trim().max(160).nullable().optional(),
  academicYear: z.string().trim().max(40).nullable().optional(),
  expectedGraduationYear: z.number().int().min(1900).max(2200).nullable().optional(),
  studyLanguage: z.string().trim().min(2).max(40).optional(),
  aiResponseLanguage: z.string().trim().min(2).max(40).optional(),
});

export const semesterSchema = z.object({
  name: z.string().trim().min(1).max(100),
  academicYear: z.string().trim().min(1).max(40),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
});

export const courseSchema = z.object({
  semesterId: idSchema,
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().max(40).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .optional(),
  icon: z.string().trim().max(40).nullable().optional(),
});

export const noteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(200_000).default(''),
});

export const chatMessageSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
  mode: z.enum(['EXPLAIN', 'SIMPLIFY', 'SUMMARIZE', 'STUDY', 'EXAM_PREP']).default('EXPLAIN'),
  action: z
    .enum(['EXPLAIN', 'SUMMARIZE', 'CREATE_EXAM_QUESTIONS', 'STUDY_FIRST', 'SIMPLIFY', 'EXAM_PREP'])
    .optional(),
  sourceIds: z.array(idSchema).max(50).optional(),
});

export const generationSchema = z.object({
  sourceIds: z.array(idSchema).max(50).default([]),
  title: z.string().trim().min(1).max(200).optional(),
});

export type ApiSuccess<T> = { success: true; data: T; meta?: Record<string, unknown> };
export type ApiFailure = {
  success: false;
  error: { code: string; message: string; requestId?: string };
};
