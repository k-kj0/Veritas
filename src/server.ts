import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { registry } from "./registry.ts";

const app = new Hono();

// Rivet actor API lives under /api/rivet/*. The browser client points here.
app.all("/api/rivet/*", (c) => registry.handler(c.req.raw));

// Static demo frontend (public/index.html + built bundle.js).
app.use("/*", serveStatic({ root: "./public" }));

const port = Number(process.env.PORT) || 8080;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`NPC memory demo running at http://localhost:${info.port}`);
});
