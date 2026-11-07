import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { listHistory } from "@/lib/historyRead";
import { requireUser } from "@/lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ environmentId: string }> }
) {
  try {
    const user = await requireUser();
    const { environmentId } = await params;
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const result = await listHistory(user.id, environmentId, {
      cursor,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}