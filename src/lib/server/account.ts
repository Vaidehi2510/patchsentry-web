import { z } from "zod";
import type { Runtime } from "./runtime";
import {
  securityState,
  SecurityError,
  authCall,
  mergedHeaders,
  proof,
  rate,
} from "./session-security";
import { strictMfa, revokeDevices, browserLabel } from "./trusted-devices";
const json = (v: unknown, status = 200) =>
  Response.json(v, { status, headers: { "cache-control": "no-store" } });
const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new SecurityError(
      400,
      r.error.issues[0]?.message || "Check the account fields.",
    );
  return r.data;
};
export async function accountEndpoint(
  request: Request,
  runtime: Runtime,
  body?: unknown,
) {
  const state = await securityState(request, runtime);
  if (state.step !== "complete" || !state.session)
    throw new SecurityError(401, "Complete sign-in and verification first.");
  const user = state.session.user,
    path = new URL(request.url).pathname;
  if (path === "/api/account" && request.method === "GET") {
    const sessions = (
      await runtime.database.query<{
        id: string;
        createdAt: string;
        expiresAt: string;
        userAgent: string | null;
      }>(
        'SELECT id,"createdAt","expiresAt","userAgent" FROM "session" WHERE "userId"=$1 AND "expiresAt">now() ORDER BY "createdAt" DESC',
        [user.id],
      )
    ).rows;
    const devices = (
      await runtime.database.query(
        "SELECT id,label,created_at,expires_at FROM qa_trusted_devices WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC",
        [user.id],
      )
    ).rows;
    return json({
      user,
      method: state.profile.method,
      strictMfa: await strictMfa(runtime, user.id),
      freshMfa: Boolean(
        state.proof?.mfa_verified &&
          state.proof.mfa_verified_at &&
          Date.now() - Date.parse(state.proof.mfa_verified_at) < 15 * 60000,
      ),
      sessions: sessions.map((s) => ({
        id: s.id,
        current: s.id === state.session!.session.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        browser: browserLabel(s.userAgent || ""),
      })),
      devices,
    });
  }
  if (!["POST", "PATCH", "DELETE"].includes(request.method))
    throw new SecurityError(405, "Method not allowed.");
  await rate(runtime, "account:" + user.id, 15);
  if (path === "/api/account/profile" && request.method === "PATCH") {
    const input = parse(
      z
        .object({
          name: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .regex(/^[^\x00-\x1f\x7f]+$/),
        })
        .strict(),
      body,
    );
    await runtime.database.query(
      'UPDATE "user" SET name=$2,"updatedAt"=now() WHERE id=$1',
      [user.id, input.name],
    );
    return json({ saved: true });
  }
  if (path === "/api/account/devices/revoke" && request.method === "POST") {
    await revokeDevices(runtime, user.id);
    return json({ revoked: true });
  }
  if (path === "/api/account/sessions/revoke" && request.method === "POST") {
    const input = parse(
      z
        .object({
          id: z.string().max(200).optional(),
          allOthers: z.boolean().optional(),
        })
        .strict()
        .refine(
          (v) => Boolean(v.id) !== Boolean(v.allOthers),
          "Choose a session or all other sessions.",
        ),
      body,
    );
    if (input.allOthers) {
      await runtime.database.query(
        'DELETE FROM "session" WHERE "userId"=$1 AND id<>$2',
        [user.id, state.session.session.id],
      );
      await revokeDevices(runtime, user.id);
    } else {
      const r = await runtime.database.query(
        'DELETE FROM "session" WHERE "userId"=$1 AND id=$2 AND id<>$3 RETURNING id',
        [user.id, input.id, state.session.session.id],
      );
      if (!r.rows.length)
        throw new SecurityError(404, "Other session not found.");
    }
    return json({ revoked: true });
  }
  if (
    !state.proof?.mfa_verified ||
    !state.proof.mfa_verified_at ||
    Date.now() - Date.parse(state.proof.mfa_verified_at) > 15 * 60000
  )
    throw new SecurityError(
      403,
      "Verify your second factor again before changing your password or email. Use “Verify MFA for account changes”.",
    );
  if (path === "/api/account/password" && request.method === "POST") {
    const input = parse(
      z
        .object({
          currentPassword: z.string().min(1).max(128),
          newPassword: z.string().min(12).max(128),
          confirmPassword: z.string(),
        })
        .strict()
        .refine(
          (v) => v.newPassword === v.confirmPassword,
          "Passwords must match.",
        )
        .refine(
          (v) => v.currentPassword !== v.newPassword,
          "Choose a different new password.",
        ),
      body,
    );
    const r = await authCall(request, runtime, "/change-password", {
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      revokeOtherSessions: true,
    });
    if (!r.ok)
      throw new SecurityError(
        400,
        "Password change failed. Check your current password or sign in again.",
      );
    const fresh = await runtime.auth.api.getSession({
      headers: mergedHeaders(request, r),
    });
    if (!fresh || fresh.user.id !== user.id)
      throw new SecurityError(401, "Sign in with your new password.");
    await proof(runtime, fresh, true);
    await revokeDevices(runtime, user.id);
    await runtime.database.query(
      "DELETE FROM qa_auth_challenges WHERE user_id=$1",
      [user.id],
    );
    const out = json({ saved: true });
    for (const cookie of r.headers.getSetCookie())
      out.headers.append("set-cookie", cookie);
    return out;
  }
  if (path === "/api/account/email" && request.method === "POST") {
    await rate(runtime, "email-change:" + user.id, 3, 3600);
    if (!runtime.config.sendSignInLink)
      throw new SecurityError(503, "Email delivery is unavailable.");
    const input = parse(
      z
        .object({
          newEmail: z.email().max(254),
          password: z.string().min(1).max(128),
        })
        .strict(),
      body,
    );
    const verified = await authCall(request, runtime, "/verify-password", {
      password: input.password,
    });
    if (!verified.ok)
      throw new SecurityError(400, "Current password was not accepted.");
    const r = await authCall(request, runtime, "/change-email", {
      newEmail: input.newEmail,
      callbackURL: "/login?email=changed",
    });
    if (!r.ok)
      throw new SecurityError(
        400,
        "Could not send the email-change confirmation. Try again or sign in again.",
      );
    return json({
      sent: true,
      message:
        "Confirm the link in your current inbox first, then the link in your new inbox. Your address changes only after both steps. You will then sign in again.",
    });
  }
  throw new SecurityError(404, "Account action not found.");
}
