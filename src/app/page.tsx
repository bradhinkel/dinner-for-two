import { App } from "@/components/App";
import { loadCatalog } from "@/catalog/loadCatalog";

export default function Home() {
  // Server-side: count live rooms for the brief footer (no extra round-trip).
  let rooms = 0;
  try {
    rooms = loadCatalog().filter((r) => r.status === "open").length;
  } catch {
    rooms = 0;
  }
  return <App roomCount={rooms} />;
}
