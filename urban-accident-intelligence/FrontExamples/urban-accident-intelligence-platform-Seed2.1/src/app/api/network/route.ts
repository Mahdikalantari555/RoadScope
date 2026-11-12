import { NextResponse } from "next/server";
import {
  getNetworkGeoJson,
  getNodesGeoJson,
  getLixelsGeoJson,
  getDataset,
} from "@/lib/db/repo";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const layer = searchParams.get("layer") ?? "segments"; // segments | nodes | lixels
  if (layer === "segments") {
    const fc = await getNetworkGeoJson();
    return NextResponse.json(fc);
  }
  if (layer === "nodes") {
    const fc = await getNodesGeoJson();
    return NextResponse.json(fc);
  }
  if (layer === "lixels") {
    const fc = await getLixelsGeoJson();
    return NextResponse.json(fc);
  }
  if (layer === "summary") {
    const ds = await getDataset();
    return NextResponse.json({ dataset: ds });
  }
  return NextResponse.json({ error: "unknown layer" }, { status: 400 });
}
