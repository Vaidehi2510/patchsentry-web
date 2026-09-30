import type { CatalogModel } from "../contracts";
let cache: {
  models: CatalogModel[];
  fetchedAt: string;
  expires: number;
} | null = null;
let pending: Promise<{ models: CatalogModel[]; fetchedAt: string }> | null =
  null;
export async function getCatalog() {
  if (cache && cache.expires > Date.now())
    return { models: cache.models, fetchedAt: cache.fetchedAt };
  if (pending) return pending;
  pending = (async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error("The OpenRouter catalog is temporarily unavailable.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing catalog response.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8000000) {
        await reader.cancel();
        throw new Error("Catalog exceeds size limit.");
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!Array.isArray(body.data)) throw new Error("Invalid model catalog.");
    const price = (value: unknown) => {
      if (typeof value !== "string" && typeof value !== "number") return null;
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? n * 1000000 : null;
    };
    const models: CatalogModel[] = body.data
      .slice(0, 3000)
      .filter(
        (m: Record<string, any>) =>
          typeof m.id === "string" &&
          m.id.length <= 160 &&
          m.architecture?.input_modalities?.includes("text") &&
          m.architecture?.output_modalities?.includes("text") &&
          !["openrouter/auto", "openrouter/free"].includes(m.id),
      )
      .map((m: Record<string, any>) => ({
        id: m.id,
        name: typeof m.name === "string" ? m.name.slice(0, 180) : m.id,
        contextLength: Number.isFinite(m.context_length) ? m.context_length : 0,
        tools:
          Array.isArray(m.supported_parameters) &&
          m.supported_parameters.includes("tools"),
        vision:
          Array.isArray(m.architecture?.input_modalities) &&
          m.architecture.input_modalities.includes("image"),
        promptPrice: price(m.pricing?.prompt),
        completionPrice: price(m.pricing?.completion),
      }));
    const fetchedAt = new Date().toISOString();
    cache = { models, fetchedAt, expires: Date.now() + 300000 };
    return { models, fetchedAt };
  })().finally(() => {
    pending = null;
  });
  return pending;
}
