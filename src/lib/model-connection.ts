import { z } from "zod";
export const RunnerId = z.string().regex(/^[a-f0-9]{32,64}$/);
export const LocalEndpoint = z
  .string()
  .max(120)
  .regex(/^https?:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?\/v1\/?$/)
  .refine((v) => {
    try {
      const p = new URL(v).port;
      return !p || (Number(p) > 0 && Number(p) <= 65535);
    } catch {
      return false;
    }
  }, "Use your runner’s loopback server, such as http://127.0.0.1:11434/v1.");
const Model = z
  .string()
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/@+-]*$/);
export const LocalProfile = z
  .object({
    id: Model,
    contextLength: z.number().int().min(1024).max(2000000),
    tools: z.boolean(),
    vision: z.boolean(),
  })
  .strict();
export const SetupRequest = z
  .object({
    runnerId: RunnerId,
    backend: z.enum(["openrouter", "local"]),
    action: z.enum(["configure", "discover", "test", "disconnect"]),
    model: Model.optional(),
    apiKey: z
      .string()
      .max(256)
      .regex(/^[!-~]*$/)
      .optional(),
    local: z
      .object({
        baseUrl: LocalEndpoint,
        models: z.array(LocalProfile).max(100),
      })
      .strict()
      .optional(),
    consent: z.literal(true),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.backend === "openrouter" &&
      v.action === "configure" &&
      (!v.apiKey || v.apiKey.length < 16)
    )
      c.addIssue({ code: "custom", message: "Enter your OpenRouter API key." });
    if (
      v.backend === "local" &&
      ["configure", "discover"].includes(v.action) &&
      !v.local
    )
      c.addIssue({
        code: "custom",
        message: "Enter the local server address.",
      });
    if (v.action === "test" && !v.model)
      c.addIssue({
        code: "custom",
        message: "Select the exact model to test.",
      });
    if (
      v.backend === "local" &&
      v.action === "configure" &&
      !v.local?.models.length
    )
      c.addIssue({
        code: "custom",
        message: "Declare at least one local model profile.",
      });
    if (v.backend === "openrouter" && v.action === "discover")
      c.addIssue({
        code: "custom",
        message: "OpenRouter uses the public catalog.",
      });
  });
export type ModelSetupRequest = z.infer<typeof SetupRequest>;
export type ConnectionView = {
  id: string;
  runnerId: string;
  backend: "openrouter" | "local";
  action: string;
  model?: string;
  status: string;
  keyVerifiedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  result: {
    message: string;
    models?: Array<{ id: string }>;
    credentialPresent?: boolean;
    inferencePassed?: boolean;
    endpoint?: string;
  } | null;
};
