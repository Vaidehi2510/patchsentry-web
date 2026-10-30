import nodemailer from "nodemailer";
import { z } from "zod";

export type SignInLink = { email: string; url: string; purpose?: 'reset'|'change' };
export type SendSignInLink = (message: SignInLink) => Promise<void>;
export type SendSecurityCode = (message:{email:string;code:string}) => Promise<void>;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function signInEmail({ email, url, purpose }: SignInLink, origin: string) {
  const link = new URL(url);
  if (link.origin !== origin || (purpose==='change' ? link.pathname !== '/api/auth/verify-email' || !link.searchParams.get('token') : purpose==='reset' ? !/^\/api\/auth\/reset-password\/[A-Za-z0-9_-]+$/.test(link.pathname) : link.pathname !== "/api/auth/magic-link/verify" || !link.searchParams.get("token")))
    throw new Error("Invalid authentication email link");
  if (!z.email().safeParse(email).success) throw new Error("Invalid email recipient");
  const safeUrl = escapeHtml(link.href);
  if(purpose==='change')return {to:email,subject:'Confirm your Patchsentry email change',text:`Confirm your email change using this link:\n${link.href}\n\nWe confirm your current inbox first, then verify your new inbox. Your existing address stays active until both steps finish. This link expires in ten minutes. If you did not request this, do not click it.`,html:`<h1>Confirm your email change</h1><p>We confirm the current inbox first, then verify the new address. Your sign-in address changes only after both steps.</p><p><a href="${safeUrl}">Confirm this email address</a></p><p>Expires in ten minutes. If you did not request this, ignore the message.</p>`,disableFileAccess:true,disableUrlAccess:true};
  if(purpose==='reset')return {to:email,subject:'Reset your Patchsentry password',text:`Reset your password using this single-use link:\n${link.href}\n\nIf you did not request it, ignore this email. Resetting your password does not disable two-step verification.`,html:`<h1>Reset your password</h1><p><a href="${safeUrl}">Choose a new password</a></p><p>Your second factor remains required to sign in.</p>`,disableFileAccess:true,disableUrlAccess:true};
  return {
    to: email,
    subject: "Verify your email for Patchsentry",
    text: `Verify your email for Patchsentry\n\nOpen this link, then choose your password and set up two-step verification:\n${link.href}\n\nThis link expires in 10 minutes and works once. If this is your first visit, your account will only be created after you verify your email.\n\nIf you did not request this email, you can ignore it.\nPatchsentry — QA for your personal projects and your team's products.`,
    html: `<div style="background:#f7f7f2;padding:32px 16px;font-family:Arial,sans-serif;color:#20231f"><div style="max-width:520px;margin:auto;background:white;border:1px solid #e1e4dc;border-radius:20px;padding:36px"><p style="font-size:22px;font-weight:bold;margin:0 0 36px">patchsentry<span style="color:#7460c5">.</span></p><p style="color:#636b5d;font-size:13px;letter-spacing:1px">A LITTLE LESS FRICTION. A LOT MORE CONFIDENCE.</p><h1 style="font-size:30px;line-height:1.2">Your next release starts here.</h1><p style="font-size:16px;line-height:1.7">Verify your email, then choose a password and set up two-step verification. This verification step creates your account.</p><p style="margin:30px 0"><a href="${safeUrl}" style="display:inline-block;background:#7460c5;color:white;text-decoration:none;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:bold">Verify email &amp; continue →</a></p><p style="font-size:14px;line-height:1.7;color:#636b5d">This link expires in <strong>10 minutes</strong> and can only be used once. If you didn't request it, you can ignore this email.</p><p style="font-size:13px;line-height:1.7;word-break:break-all">Button not working? Open this link:<br><a href="${safeUrl}" style="color:#6350b1">${safeUrl}</a></p></div></div>`,
    headers: { "X-Auto-Response-Suppress": "All" },
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

function gmailTransport(env: Record<string, string | undefined>) {
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
  return {transport,user};
}
/** No console-mail fallback: a missing sender must never pretend to deliver. */
export function gmailSender(origin: string, env: Record<string, string | undefined> = process.env): SendSignInLink | undefined {
  const smtp=gmailTransport(env);if(!smtp)return;const {transport,user}=smtp;
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

export function gmailSecuritySender(env:Record<string,string|undefined>=process.env):SendSecurityCode|undefined {
  const smtp=gmailTransport(env);if(!smtp)return;
  return async({email,code})=>{if(!z.email().safeParse(email).success||!/^\d{6}$/.test(code))throw new Error('Invalid security code message');
    try{const result=await smtp.transport.sendMail({from:{name:'Patchsentry',address:smtp.user},to:email,subject:'Your Patchsentry verification code',text:`Your code is ${code}.\n\nIt expires in five minutes and works once. Never share it. If you did not request it, ignore this message.`,html:`<h1>Complete your sign-in</h1><p>Your verification code is:</p><p style="font-size:32px;letter-spacing:8px;font-family:monospace">${code}</p><p>Expires in five minutes. Do not share this code.</p>`,disableFileAccess:true,disableUrlAccess:true});if(!result.accepted?.length||result.rejected?.length)throw new Error('Delivery failed');}
    catch{throw new Error('We could not deliver your verification code. Try again shortly.');}
  };
}

export type SendInvitation=(message:{email:string;url:string;projectName:string;inviter:string;role:string})=>Promise<void>;
export function invitationEmail(message:Parameters<SendInvitation>[0],origin:string){const url=new URL(message.url);if(url.origin!==origin||url.pathname!=='/invite'||url.search||!/^#token=[A-Za-z0-9_-]{43}$/.test(url.hash)||!z.email().safeParse(message.email).success)throw new Error('Invalid invitation');const project=message.projectName.replace(/[\r\n]/g,' ').slice(0,80),inviter=message.inviter.slice(0,100);return {to:message.email,subject:`You are invited to ${project} on Patchsentry`,text:`${inviter} invited you to ${project} as ${message.role}.\n\nOpen your invitation: ${url.href}\n\nSign in or create an account with this exact email address, then accept. The link expires in seven days and works once. A Patchsentry role does not grant GitHub access. Ignore this message if unexpected.`,html:`<h1>Join ${escapeHtml(project)}</h1><p>${escapeHtml(inviter)} invited you as <strong>${escapeHtml(message.role)}</strong>.</p><p><a href="${escapeHtml(url.href)}">Review invitation</a></p><p>Sign in or create an account with this invited email address. Expires in seven days. Your GitHub permissions do not change.</p>`,disableFileAccess:true,disableUrlAccess:true};}
export function gmailInvitationSender(origin:string,env:Record<string,string|undefined>=process.env):SendInvitation|undefined{const smtp=gmailTransport(env);if(!smtp)return;return async message=>{try{const r=await smtp.transport.sendMail({...invitationEmail(message,origin),from:{name:'Patchsentry',address:smtp.user}});if(!r.accepted?.length||r.rejected?.length)throw new Error();}catch{throw new Error('Invitation delivery could not be confirmed');}};}

export type SendWeeklyReport=(message:{email:string;projectName:string;period:string;url:string;summary:string})=>Promise<void>;
export function gmailWeeklyReportSender(origin:string,env:Record<string,string|undefined>=process.env):SendWeeklyReport|undefined{const smtp=gmailTransport(env);if(!smtp)return;return async m=>{const url=new URL(m.url);if(url.origin!==origin||url.pathname!=='/app'||!z.email().safeParse(m.email).success)throw new Error('Invalid weekly report delivery');const project=m.projectName.replace(/[\r\n]/g,' ').slice(0,80);try{const r=await smtp.transport.sendMail({from:{name:'Patchsentry',address:smtp.user},to:m.email,subject:`Weekly QA report · ${project} · ${m.period}`,text:`${project} · ${m.period}\n\n${m.summary}\n\n${url.href}\n\nManage weekly delivery in your project’s Automation settings.`,html:`<h1>Weekly QA report</h1><p>${escapeHtml(project)} · ${escapeHtml(m.period)}</p><p>${escapeHtml(m.summary)}</p><p><a href="${escapeHtml(url.href)}">Open coverage and evidence</a></p><p>Manage delivery in Automation settings.</p>`,disableFileAccess:true,disableUrlAccess:true});if(!r.accepted?.length||r.rejected?.length)throw Error();}catch{throw Error('Weekly report delivery could not be confirmed');}};}
