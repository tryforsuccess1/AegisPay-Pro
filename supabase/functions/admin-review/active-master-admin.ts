export interface AdminActorStatus {
  role?: unknown;
  status?: unknown;
}

export function isActiveMasterAdmin(actor: AdminActorStatus | null | undefined): boolean {
  const role = String(actor?.role ?? "").trim().toUpperCase();
  const status = String(actor?.status ?? "").trim().toUpperCase();

  return role === "MASTER ADMIN" && (status === "ACTIVE" || status === "NORMAL");
}
