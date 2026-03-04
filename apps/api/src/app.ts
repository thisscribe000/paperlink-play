import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({ logger: true });

app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true }));

export default app;