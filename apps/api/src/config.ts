import { z } from 'zod';
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  WEB_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  MAIL_PROVIDER: z.enum(['smtp', 'resend']).default('smtp'),
  RESEND_API_KEY: z.string().min(1).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Warp <noreply@example.com>'),
  DEV_MAIL_DIR: z.string().optional(),
});
export type Config = z.infer<typeof configSchema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg = configSchema.parse(env);
  const origins = cfg.CORS_ORIGINS.split(',').map((v) => v.trim());
  for (const origin of origins)
    if (new URL(origin).origin !== origin)
      throw new Error('CORS_ORIGINS must contain exact origins.');
  if (cfg.NODE_ENV === 'production') {
    if (
      (cfg.MAIL_PROVIDER === 'resend' ? !cfg.RESEND_API_KEY : !cfg.SMTP_HOST) ||
      cfg.DEV_MAIL_DIR ||
      !cfg.WEB_URL.startsWith('https://') ||
      origins.some((v) => !v.startsWith('https://')) ||
      cfg.SESSION_SECRET.startsWith('replace-')
    )
      throw new Error(
        'Production requires HTTPS, a configured mail provider and a random session secret.',
      );
  }
  if (cfg.COOKIE_SAME_SITE === 'none' && cfg.NODE_ENV !== 'production')
    throw new Error('SameSite=None requires production HTTPS.');
  return cfg;
}
