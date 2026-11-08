import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/errors";
import { previewImportSchema } from "@/lib/importSchemas";
import { previewImport } from "@/lib/importPlan";
import { requireUser } from "@/lib/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ environmentId: string }> }
) {
  try {
    const user = await requireUser();
    const { environmentId } = await params;
    const input = await parseBody(request, previewImportSchema);
    const result = await previewImport(user.id, environmentId, input);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}