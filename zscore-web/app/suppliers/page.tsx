import { listSuppliers } from "@/lib/db";
import SuppliersClient from "./SuppliersClient";

export const dynamic = "force-dynamic";

export default function SuppliersPage() {
  const suppliers = listSuppliers();
  return <SuppliersClient suppliers={suppliers} />;
}