import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/errors";
import { revealHistoryValue } from "@/lib/historyRead";
import { requireUser } from "@/lib/session";
import { revealHistorySchema } from "@/lib/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  try {
    const user = await requireUser();
    const { entryId } = await params;
    const { which } = await parseBody(request, revealHistorySchema);
    const value = await revealHistoryValue(user.id, entryId, which);
    return NextResponse.json({ value }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}