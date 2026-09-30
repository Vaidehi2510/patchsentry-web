import { getCatalog } from "@/lib/server/catalog";
export async function GET() {
  try {
    return Response.json(await getCatalog(), {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch {
    return Response.json(
      {
        error:
          "OpenRouter’s model catalog is unavailable. Please retry in a moment.",
      },
      { status: 503 },
    );
  }
}
