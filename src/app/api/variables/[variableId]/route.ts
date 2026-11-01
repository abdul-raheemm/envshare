import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { updateVariableSchema } from "@/lib/validation";
import { deleteVariable, updateVariable } from "@/lib/variables";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ variableId: string }> }
) {
  try {
    const user = await requireUser();
    const { variableId } = await params;
    const input = await parseBody(request, updateVariableSchema);
    const variable = await updateVariable(user.id, variableId, input);
    return NextResponse.json({ variable });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ variableId: string }> }
) {
  try {
    const user = await requireUser();
    const { variableId } = await params;
    await deleteVariable(user.id, variableId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}