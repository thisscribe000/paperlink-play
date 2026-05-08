import { Bot, InlineKeyboard, Context } from "grammy";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
});

if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN missing");

const API_URL = process.env.API_URL || "http://localhost:4000";
const MINIAPP_URL = process.env.MINIAPP_URL;

const bot = new Bot(process.env.BOT_TOKEN);

interface PendingChallenge {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  game: string;
}

const pendingChallenges = new Map<string, PendingChallenge>();

async function createRoom(userId: string, game: string = "chess"): Promise<{ roomId: string; joinCode: string } | null> {
  try {
    const res = await fetch(`${API_URL}/v1/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, name: game }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { roomId: data.roomId, joinCode: data.joinCode };
  } catch {
    return null;
  }
}

function getMainKeyboard() {
  return new InlineKeyboard().webApp("Play", MINIAPP_URL || "");
}

bot.command("start", async (ctx) => {
  if (!MINIAPP_URL || !MINIAPP_URL.startsWith("https://")) {
    await ctx.reply("Mini App link not set yet. Set MINIAPP_URL to an https URL.");
    return;
  }

  const kb = new InlineKeyboard().webApp("Play", MINIAPP_URL);

  await ctx.reply(
    "🎮 *PaperLink Play*\n\nTelegram-native gaming platform\n\nPlay chess against friends or find a match!",
    { reply_markup: kb, parse_mode: "Markdown" }
  );
});

bot.command("play", async (ctx) => {
  const userId = ctx.from?.id.toString();
  if (!userId) return;

  if (!MINIAPP_URL) {
    await ctx.reply("Game server not configured.");
    return;
  }

  const room = await createRoom(userId);
  if (!room) {
    await ctx.reply("Failed to create game. Try again later.");
    return;
  }

  const gameUrl = `${MINIAPP_URL}?room=${room.joinCode}`;

  const kb = new InlineKeyboard().webApp("Play Now", gameUrl);

  await ctx.reply(
    `🎮 *Game Room Created!*\n\nJoin code: \`${room.joinCode}\`\n\nTap below to start playing:`,
    { reply_markup: kb, parse_mode: "Markdown" }
  );
});

bot.command("challenge", async (ctx) => {
  const fromId = ctx.from?.id.toString();
  const fromName = ctx.from?.first_name || "Player";

  if (!fromId) return;

  const msg = ctx.message?.text;
  const mention = msg?.replace("/challenge", "").trim();

  if (!mention) {
    await ctx.reply("Usage: /challenge @username");
    return;
  }

  const toUsername = mention.replace("@", "");
  const toId = toUsername.replace(/\D/g, "");

  if (!toId || toId === fromId) {
    await ctx.reply("Invalid user. Usage: /challenge @username");
    return;
  }

  const pending: PendingChallenge = {
    fromId,
    fromName,
    toId,
    toName: `@${toUsername}`,
    game: "chess",
  };

  pendingChallenges.set(`${toId}:${fromId}`, pending);

  const kb = new InlineKeyboard()
    .text("Accept", "accept_challenge")
    .text("Decline", "decline_challenge");

  await ctx.reply(`Challenge sent to @${toUsername}!`);
});

bot.callbackQuery("accept_challenge", async (ctx) => {
  const userId = ctx.from?.id.toString();
  const fromId = ctx.callbackQuery?.from.id.toString();

  if (!userId || !fromId) return;

  const key = `${userId}:${fromId}`;
  const challenge = pendingChallenges.get(key);

  if (!challenge) {
    await ctx.answerCallbackQuery("No pending challenge found.");
    return;
  }

  pendingChallenges.delete(key);

  const room = await createRoom(userId);
  if (!room) {
    await ctx.answerCallbackQuery("Failed to create game.");
    return;
  }

  await ctx.answerCallbackQuery("Challenge accepted!");

  const kb = new InlineKeyboard().webApp("Play", `${MINIAPP_URL}?room=${room.joinCode}`);

  await ctx.editMessageText(
    `🎮 *Game Started!*\n\nJoin code: \`${room.joinCode}\`\n\nTap below to play:`,
    { reply_markup: kb, parse_mode: "Markdown" }
  );
});

bot.callbackQuery("decline_challenge", async (ctx) => {
  const userId = ctx.from?.id.toString();
  const fromId = ctx.callbackQuery?.from.id.toString();

  if (!userId || !fromId) return;

  const key = `${userId}:${fromId}`;
  const challenge = pendingChallenges.get(key);

  if (!challenge) {
    await ctx.answerCallbackQuery("No pending challenge found.");
    return;
  }

  pendingChallenges.delete(key);
  await ctx.answerCallbackQuery("Challenge declined.");
  await ctx.editMessageText("❌ Challenge declined.");
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `🎮 *PaperLink Play Commands*\n\n` +
    `/start - Open the game\n` +
    `/play - Create a new game room\n` +
    `/challenge @username - Challenge a friend\n` +
    `/help - Show this help`,
    { parse_mode: "Markdown" }
  );
});

bot.catch((err) => console.error("Bot error:", err));

bot.start();