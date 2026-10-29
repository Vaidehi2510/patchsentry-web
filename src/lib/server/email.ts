import nodemailer from "nodemailer";
import { z } from "zod";

export type SignInLink = { email: string; url: string };
export type SendSignInLink = (message: SignInLink) => Promise<void>;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function signInEmail({ email, url }: SignInLink, origin: string) {
  const link = new URL(url);
  if (link.origin !== origin || link.pathname !== "/api/auth/magic-link/verify" || !link.searchParams.get("token"))
    throw new Error("Invalid authentication email link");
  if (!z.email().safeParse(email).success) throw new Error("Invalid email recipient");
  const safeUrl = escapeHtml(link.href);
  return {
    to: email,
    subject: "Your secure sign-in link for Patchsentry",
    text: `Sign in to Patchsentry\n\nOpen this link to verify your email and continue:\n${link.href}\n\nThis link expires in 10 minutes and works once. If this is your first visit, your account will only be created after you verify your email.\n\nIf you did not request this email, you can ignore it.\nPatchsentry — QA for your personal projects and your team's products.`,
    html: `<div style="background:#f7f7f2;padding:32px 16px;font-family:Arial,sans-serif;color:#20231f"><div style="max-width:520px;margin:auto;background:white;border:1px solid #e1e4dc;border-radius:20px;padding:36px"><p style="font-size:22px;font-weight:bold;margin:0 0 36px">patchsentry<span style="color:#7460c5">.</span></p><p style="color:#636b5d;font-size:13px;letter-spacing:1px">A LITTLE LESS FRICTION. A LOT MORE CONFIDENCE.</p><h1 style="font-size:30px;line-height:1.2">Your next release starts here.</h1><p style="font-size:16px;line-height:1.7">Verify your email to sign in. On your first visit, this is the step that creates your account.</p><p style="margin:30px 0"><a href="${safeUrl}" style="display:inline-block;background:#7460c5;color:white;text-decoration:none;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:bold">Verify email &amp; continue →</a></p><p style="font-size:14px;line-height:1.7;color:#636b5d">This link expires in <strong>10 minutes</strong> and can only be used once. If you didn't request it, you can ignore this email.</p><p style="font-size:13px;line-height:1.7;word-break:break-all">Button not working? Open this link:<br><a href="${safeUrl}" style="color:#6350b1">${safeUrl}</a></p></div></div>`,
    headers: { "X-Auto-Response-Suppress": "All" },
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/** No console-mail fallback: a missing sender must never pretend to deliver. */
export function gmailSender(origin: string, env: Record<string, string | undefined> = process.env): SendSignInLink | undefined {
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD?.replace(/\s/g, "");
  if (!user || !password) return undefined;
  if (!z.email().safeParse(user).success || !/@(?:gmail|googlemail)\.com$/i.test(user))
    throw new Error("SMTP_USER must be the connected Gmail address");
  if (!/^[A-Za-z0-9]{16}$/.test(password))
    throw new Error("SMTP_PASSWORD must be a Google app password");
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user, pass: password },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    logger: false, debug: false,
  });
  return async message => {
    try {
      const result = await transport.sendMail({ ...signInEmail(message, origin), from: { name: "Patchsentry", address: user } });
      if (!result.accepted?.length || result.rejected?.length) throw new Error("Recipient not accepted");
    } catch {
      // Never expose SMTP responses, passwords, recipients, or verification URLs.
      throw new Error("We couldn't send your sign-in link. Please try again shortly.");
    }
  };
}
