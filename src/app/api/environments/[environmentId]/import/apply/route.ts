import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/errors";
import { applyImportSchema } from "@/lib/importSchemas";
import { applyImport } from "@/lib/importPlan";
import { requireUser } from "@/lib/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ environmentId: string }> }
) {
  try {
    const user = await requireUser();
    const { environmentId } = await params;
    const input = await parseBody(request, applyImportSchema);
    const result = await applyImport(user.id, environmentId, input);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}