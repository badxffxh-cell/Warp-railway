import { z } from 'zod';

export const passwordSchema = z.string().min(12, 'Use pelo menos 12 caracteres.').max(128);
export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_]+$/, 'Use letras, números ou sublinhado.')
  .transform((v) => v.toLowerCase());
export const emailSchema = z
  .string()
  .trim()
  .email('E-mail inválido.')
  .max(254)
  .transform((v) => v.toLowerCase());
export const registerSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    displayName: z.string().trim().min(1).max(60),
    password: passwordSchema,
    remember: z.boolean().default(false),
  })
  .strict();
export const loginSchema = z
  .object({
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(128),
    remember: z.boolean().default(false),
  })
  .strict();
export const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    bio: z.string().max(240),
    status: z.enum(['ONLINE', 'AWAY', 'BUSY', 'INVISIBLE']),
  })
  .strict();
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .strict();
export const resetPasswordSchema = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: passwordSchema })
  .strict();
export const tokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type UserProfile = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  status: 'ONLINE' | 'AWAY' | 'BUSY' | 'INVISIBLE';
  emailVerified: boolean;
  createdAt: string;
};
export type SessionInfo = {
  id: string;
  device: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  persistent: boolean;
  current: boolean;
};
export type AuthResponse = { user: UserProfile; csrfToken: string; expiresAt: string };
export type ApiError = { error: { code: string; message: string; requestId?: string } };
export const API_VERSION = 'v1';
