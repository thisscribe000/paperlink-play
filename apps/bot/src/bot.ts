import { Bot, InlineKeyboard } from "grammy";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
});

if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN missing");

const bot = new Bot(process.env.BOT_TOKEN);

bot.command("start", async (ctx) => {
  const url = process.env.MINIAPP_URL;

  if (!url || !url.startsWith("https://")) {
    await ctx.reply("Mini App link not set yet. Set MINIAPP_URL to an https URL.");
    return;
  }

  // This opens inside Telegram as a Mini App
  const kb = new InlineKeyboard().webApp("Play", url);

  await ctx.reply("🎮 PaperLink Play\nChoose a game:", { reply_markup: kb });
});

bot.catch((err) => console.error("Bot error:", err));

bot.start();