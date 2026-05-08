import { FastifyInstance } from "fastify";
import { validateTelegramInitData } from "../auth";

export async function authRoutes(app: FastifyInstance) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN not set");
  }

  app.post("/auth/verify", async (req, reply) => {
    const body = (req.body ?? {}) as { initData?: string };

    if (!body.initData) {
      return reply.code(400).send({ error: "initData required" });
    }

    const validated = validateTelegramInitData(body.initData, BOT_TOKEN);
    if (!validated || !validated.user) {
      return reply.code(401).send({ error: "invalid initData" });
    }

    return reply.send({
      ok: true,
      userId: validated.user.id.toString(),
      username: validated.user.username,
      firstName: validated.user.first_name,
      lastName: validated.user.last_name,
    });
  });
}