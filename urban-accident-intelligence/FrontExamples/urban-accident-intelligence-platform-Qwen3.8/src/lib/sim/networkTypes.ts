import type { GraphNode, GraphSegment } from "@/lib/geo/graph";

/** Local re-export shim to avoid a circular import in the generator. */
export function polyLineLengthLocal(shape: Array<[number, number]>): number {
  let len = 0;
  for (let i = 1; i < shape.length; i++) {
    len += Math.hypot(shape[i][0] - shape[i - 1][0], shape[i][1] - shape[i - 1][1]);
  }
  return len;
}

export type { GraphNode, GraphSegment };
