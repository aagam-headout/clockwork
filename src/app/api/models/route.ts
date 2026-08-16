import { NextResponse } from "next/server";
import { getModelCatalogForUser } from "@/lib/models";
import { requireUserApi } from "@/lib/auth/user";

// Backs the model picker. The catalog depends on the account's provider and
// is fetched with that account's own key.
export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  const items = await getModelCatalogForUser(auth.user.id);
  return NextResponse.json({ items });
}
