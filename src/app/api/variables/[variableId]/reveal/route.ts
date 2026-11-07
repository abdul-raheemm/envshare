import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { revealVariable } from "@/lib/reveal";
import { requireUser } from "@/lib/session";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ variableId: string }> }
) {
  try {
    const user = await requireUser();
    const { variableId } = await params;
    const value = await revealVariable(user.id, variableId);
    return NextResponse.json({ value }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}