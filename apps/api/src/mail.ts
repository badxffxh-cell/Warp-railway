import nodemailer from 'nodemailer';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
export type AccountMail = { to: string; subject: string; text: string };
export type Mailer = (mail: AccountMail) => Promise<void>;
export function createMailer(cfg: Config, send: typeof fetch = fetch): Mailer {
  if (cfg.NODE_ENV !== 'production' && cfg.DEV_MAIL_DIR) {
    const dir = resolve(cfg.DEV_MAIL_DIR);
    return async (mail) => {
      await mkdir(dir, { recursive: true });
      await writeFile(
        resolve(dir, `${Date.now()}-${randomUUID()}.json`),
        JSON.stringify(mail, null, 2),
        { mode: 0o600 },
      );
    };
  }
  if (cfg.MAIL_PROVIDER === 'resend') {
    if (!cfg.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required.');
    return async (mail) => {
      const response = await send('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: cfg.MAIL_FROM,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Mail provider rejected request (${response.status}).`);
      }
      const result = (await response.json()) as { id?: string };
      if (!result.id) throw new Error('Mail provider returned an invalid response.');
    };
  }
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE === 'true',
    requireTLS: cfg.NODE_ENV === 'production',
    connectionTimeout: 10000,
    socketTimeout: 15000,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD } : undefined,
  });
  return async (mail) => {
    await transport.sendMail({ ...mail, from: cfg.MAIL_FROM });
  };
}
