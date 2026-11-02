import { MASK } from "@/lib/mask";

export type VariableDTO = {
  id: string;
  key: string;
  value: string; // the mask for sensitive variables, never the secret
  isSensitive: boolean;
  masked: boolean;
  version: number;
  updatedByName: string;
};

type VariableRow = {
  id: string;
  key: string;
  value: string;
  isSensitive: boolean;
  version: number;
  updatedBy: { name: string };
};

// Picks fields explicitly, so ciphertext, iv and authTag can never slip through
export function toVariableDTO(row: VariableRow): VariableDTO {
  return {
    id: row.id,
    key: row.key,
    value: row.isSensitive ? MASK : row.value,
    isSensitive: row.isSensitive,
    masked: row.isSensitive,
    version: row.version,
    updatedByName: row.updatedBy.name,
  };
}