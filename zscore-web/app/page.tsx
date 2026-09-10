import { listSuppliers } from "@/lib/db";
import HomeClient from "./HomeClient";

export const dynamic = "force-dynamic";

export default function Home() {
  const suppliers = listSuppliers();
  return <HomeClient suppliers={suppliers} />;
}