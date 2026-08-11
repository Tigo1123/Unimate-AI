import { env } from '../../config/env.js';

export type WelcomeEmailInput = {
  userId: string;
  email: string;
  fullName: string;
};

type ResendEmailResponse = { id?: string; message?: string; name?: string };

class ResendEmailError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!,
  );
}

export function welcomeEmailContent(fullName: string) {
  const name = fullName.trim() || 'there';
  const safeName = escapeHtml(name);
  return {
    subject: 'Welcome to UniMate AI',
    text: `Hi ${name},

Welcome to UniMate AI!

UniMate AI turns your course materials into clear explanations, summaries, and study tools.

Upload your first lecture to begin.

Happy studying,
The UniMate AI Team`,
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#172033">
    <div style="max-width:560px;margin:0 auto;padding:40px 20px">
      <div style="background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e7e9f0">
        <h1 style="margin:0 0 20px;font-size:26px">Welcome to UniMate AI</h1>
        <p style="margin:0 0 16px;line-height:1.6">Hi ${safeName},</p>
        <p style="margin:0 0 16px;line-height:1.6">UniMate AI turns your course materials into clear explanations, summaries, and study tools.</p>
        <p style="margin:0 0 24px;line-height:1.6"><strong>Upload your first lecture to begin.</strong></p>
        <p style="margin:0;line-height:1.6">Happy studying,<br>The UniMate AI Team</p>
      </div>
    </div>
  </body>
</html>`,
  };
}

export async function sendWelcomeEmail(input: WelcomeEmailInput) {
  const content = welcomeEmailContent(input.fullName);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      'idempotency-key': `welcome-${input.userId}`,
    },
    body: JSON.stringify({
      from: `UniMate AI <${env.EMAIL_FROM}>`,
      to: [input.email],
      subject: content.subject,
      text: content.text,
      html: content.html,
      tags: [{ name: 'category', value: 'welcome' }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = (await response.json().catch(() => ({}))) as ResendEmailResponse;
  if (!response.ok || !result.id)
    throw new ResendEmailError(
      response.status,
      `Resend welcome email failed (${response.status}): ${result.message ?? result.name ?? 'unknown error'}`,
    );
  console.info('Welcome email accepted by Resend', { userId: input.userId, emailId: result.id });
  return { id: result.id };
}

export function dispatchWelcomeEmail(input: WelcomeEmailInput) {
  void sendWelcomeEmail(input).catch((error) => {
    if (
      error instanceof ResendEmailError &&
      error.status === 403 &&
      error.message.includes('only send testing emails to your own email address')
    ) {
      console.warn('Welcome email skipped: known Resend shared-domain limitation', {
        limitation: 'RESEND_TEST_DOMAIN_RECIPIENT_RESTRICTION',
        userId: input.userId,
      });
      return;
    }
    console.error('Welcome email delivery failed', {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
