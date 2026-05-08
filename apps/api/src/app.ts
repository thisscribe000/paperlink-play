import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { roomsRoutes } from "./routes/rooms";
import { authRoutes } from "./routes/auth";
import { wsRoutes } from "./routes/ws";

const app = Fastify({ logger: true });

app.register(cors, { origin: true });
app.register(websocket);

app.get("/health", async () => ({ ok: true }));

app.register(authRoutes, { prefix: "/v1" });
app.register(wsRoutes);
app.register(roomsRoutes, { prefix: "/v1" });

export default app;