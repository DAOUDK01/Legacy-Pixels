import type { HttpMethod } from "@/lib/api/transport";
import type { MockReq } from "./helpers";

export interface RouteDef {
  method: HttpMethod;
  path: string;
  public?: boolean;
  handler: (req: MockReq) => unknown | Promise<unknown>;
}

export const route = (method: HttpMethod, path: string, handler: RouteDef["handler"], opts: { public?: boolean } = {}): RouteDef => ({
  method,
  path,
  handler,
  ...opts,
});
