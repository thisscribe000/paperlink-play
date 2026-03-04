import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({ logger: true });

// No top-level await (CommonJS). Register without await.
app.register(cors, {
  origin: true, // we'll tighten later
});

app.get("/health", async () => {
  return { ok: true };
});

export default app;