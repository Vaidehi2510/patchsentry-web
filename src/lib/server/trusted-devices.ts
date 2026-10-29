import { createHash, createHmac, randomBytes } from "node:crypto";
import { createCookieGetter } from "better-auth/cookies";
import { serializeSignedCookie } from "better-call";
import type { Runtime } from "./runtime";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const name = (runtime: Runtime) =>
  runtime.config.production ? "__Host-ps-device" : "ps-device";
const value = (request: Request, runtime: Runtime) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name(runtime) + "="))
    ?.slice(name(runtime).length + 1);
export function browserLabel(agent: string) {
  const browser = /Edg\//.test(agent)
    ? "Microsoft Edge"
    : /(?:Chrome|Chromium)\//.test(agent)
      ? "Chrome"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser";
  const system = /Android/.test(agent)
    ? "Android"
    : /iPhone|iPad/.test(agent)
      ? "iOS"
      : /Windows/.test(agent)
        ? "Windows"
        : /Macintosh|Mac OS/.test(agent)
          ? "macOS"
          : /Linux/.test(agent)
            ? "Linux"
            : "unknown device";
  return `${browser} on ${system}`;
}
export async function strictMfa(runtime: Runtime, userId: string) {
  return Boolean(
    (
      await runtime.database.query(
        "SELECT id FROM projects WHERE owner_id=$1 UNION ALL SELECT project_id AS id FROM qa_members WHERE user_id=$1 AND role='admin' LIMIT 1",
        [userId],
      )
    ).rows.length,
  );
}
export async function rememberedDevice(
  request: Request,
  runtime: Runtime,
  userId: string,
) {
  const token = value(request, runtime);
  if (
    !token ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    (await strictMfa(runtime, userId))
  )
    return null;
  return (
    (
      await runtime.database.query<{ id: string }>(
        "SELECT id FROM qa_trusted_devices WHERE id=$1 AND user_id=$2 AND agent_hash=$3 AND expires_at>now()",
        [
          hash(token),
          userId,
          hash(request.headers.get("user-agent") || "unknown"),
        ],
      )
    ).rows[0]?.id || null
  );
}
export function withoutNativeTrust(request: Request) {
  const headers = new Headers(request.headers);
  headers.set(
    "cookie",
    (headers.get("cookie") || "")
      .split(";")
      .filter(
        (v) => !v.trim().split("=")[0].endsWith("better-auth.trust_device"),
      )
      .join(";"),
  );
  return new Request(request.url, { method: request.method, headers });
}
/** Mirrors Better Auth 1.7.6's trusted-device protocol using its cookie serializer and adapter.
 * Only called after the actual configured second factor has been verified. */
export async function rememberBrowser(
  request: Request,
  runtime: Runtime,
  userId: string,
  response: Response,
) {
  if (await strictMfa(runtime, userId)) return;
  const ctx = await runtime.auth.$context,
    identifier = "trust-device-" + randomBytes(24).toString("hex"),
    token = randomBytes(32).toString("base64url");
  const cookie = createCookieGetter(ctx.options)("trust_device", {
    maxAge: 30 * 86400,
  });
  const signature = createHmac("sha256", ctx.secret)
    .update(`${userId}!${identifier}`)
    .digest("base64url");
  await ctx.internalAdapter.createVerificationValue({
    identifier,
    value: userId,
    expiresAt: new Date(Date.now() + 30 * 86400000),
  });
  const prior = value(request, runtime);
  if (prior)
    await runtime.database.query(
      "DELETE FROM qa_trusted_devices WHERE user_id=$1 AND id=$2",
      [userId, hash(prior)],
    );
  await runtime.database.query(
    "INSERT INTO qa_trusted_devices (id,user_id,agent_hash,label,expires_at) VALUES ($1,$2,$3,$4,now()+interval '30 days')",
    [
      hash(token),
      userId,
      hash(request.headers.get("user-agent") || "unknown"),
      browserLabel(request.headers.get("user-agent") || ""),
    ],
  );
  await runtime.database.query(
    "DELETE FROM qa_trusted_devices WHERE user_id=$1 AND (expires_at<=now() OR id IN (SELECT id FROM qa_trusted_devices WHERE user_id=$1 ORDER BY created_at DESC OFFSET 20))",
    [userId],
  );
  response.headers.append(
    "set-cookie",
    await serializeSignedCookie(
      cookie.name,
      `${signature}!${identifier}`,
      ctx.secret,
      cookie.attributes,
    ),
  );
  response.headers.append(
    "set-cookie",
    `${name(runtime)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${runtime.config.production ? "; Secure" : ""}`,
  );
}
export async function revokeDevices(runtime: Runtime, userId: string) {
  await runtime.database.query(
    "DELETE FROM qa_trusted_devices WHERE user_id=$1",
    [userId],
  );
  await runtime.database.query(
    "DELETE FROM verification WHERE value=$1 AND identifier LIKE 'trust-device-%'",
    [userId],
  );
}
