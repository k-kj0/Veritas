// Vercel detects this as a Hono app only if Hono is imported from "hono".
import { Hono } from "hono";
import { registry } from "../src/registry.ts";

const app = new Hono();

// Every request under /api/rivet/* is handled by RivetKit.
// In production this needs RIVET_ENDPOINT, RIVET_PUBLIC_ENDPOINT and
// RIVETKIT_RUNTIME_MODE=serverless set in Vercel's environment variables.
app.all("/api/rivet/*", (c) => registry.handler(c.req.raw));

export default app;
