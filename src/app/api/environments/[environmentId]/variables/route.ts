import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { createVariableSchema } from "@/lib/validation";
import { createVariable } from "@/lib/variables";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ environmentId: string }> }
) {
  try {
    const user = await requireUser();
    const { environmentId } = await params;
    const { key, value, isSensitive } = await parseBody(request, createVariableSchema);
    const variable = await createVariable(user.id, environmentId, key, value, isSensitive);
    return NextResponse.json({ variable }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}