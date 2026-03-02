import { Bot, InlineKeyboard } from "grammy";
import * as dotenv from "dotenv";

dotenv.config();

if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN missing");

const bot = new Bot(process.env.BOT_TOKEN);

bot.command("start", async (ctx) => {
  const url = process.env.MINIAPP_URL;

  // If URL is not https, don't send it (Telegram will reject localhost/http)
  if (!url || !url.startsWith("https://")) {
    await ctx.reply(
      "🎮 PaperLink Play\nMini App link not set yet.\n\nDeploy the Mini App to an https URL (Vercel), then set MINIAPP_URL."
    );
    return;
  }

  const kb = new InlineKeyboard().url("Open PaperLink Play", url);
  await ctx.reply("🎮 PaperLink Play\nChoose a game:", { reply_markup: kb });
});

bot.catch((err) => console.error("Bot error:", err));

bot.start();