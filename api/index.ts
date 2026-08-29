// You MUST import from "hono" for Vercel to detect this as a Hono app.
import { Hono } from "hono";
import { registry } from "../src/registry.ts";

const app = new Hono();

app.all("/api/rivet/*", (c) => registry.handler(c.req.raw));

export default app;
