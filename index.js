import express from "express";
import { Telegraf } from "telegraf";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const bot = new Telegraf(token);
const app = express();
app.use(express.json());

// ---- Settings (simple) ----
const RULES =
  "📌 Group Rules:\n" +
  "1) No spam links\n" +
  "2) No promos/scams\n" +
  "3) Respect everyone\n" +
  "⚠️ Spam = delete + mute";

const LINK_REGEX = /(https?:\/\/|t\.me\/|telegram\.me\/|www\.)/i;

const SPAM_WORDS = [
  "airdrop",
  "crypto giveaway",
  "double your",
  "earn daily",
  "forex signals",
  "investment"
];

// ---- Helpers ----
const escapeHtml = (s) =>
  String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const mention = (u) => {
  const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ") || "member";
  return `<a href="tg://user?id=${u.id}">${escapeHtml(name)}</a>`;
};

async function del(ctx) {
  try {
    await ctx.deleteMessage();
    return true;
  } catch {
    return false;
  }
}

async function mute(ctx, userId, seconds = 600) {
  try {
    const until = Math.floor(Date.now() / 1000) + seconds;
    await ctx.telegram.restrictChatMember(ctx.chat.id, userId, {
      permissions: { can_send_messages: false },
      until_date: until
    });
    return true;
  } catch {
    return false;
  }
}

// ---- Welcome ----
bot.on("new_chat_members", async (ctx) => {
  const members = ctx.message.new_chat_members || [];
  for (const m of members) {
    // ignore bot itself
    if (m.is_bot) continue;

    await ctx.reply(
      `👋 Welcome ${mention(m)}!\n\n${escapeHtml(RULES)}`,
      { parse_mode: "HTML", disable_web_page_preview: true }
    );
  }
});

// ---- Moderation (basic) ----
bot.on("message", async (ctx) => {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return;

  const msg = ctx.message;
  const userId = msg.from?.id;
  const text = (msg.text || msg.caption || "").toLowerCase();

  // Block forwards (common spam)
  if (msg.forward_origin) {
    await del(ctx);
    return;
  }

  // Block spam keywords
  if (SPAM_WORDS.some((w) => text.includes(w))) {
    await del(ctx);
    if (userId) await mute(ctx, userId, 600);
    return;
  }

  // Block links
  if (LINK_REGEX.test(text)) {
    await del(ctx);
    if (userId) await mute(ctx, userId, 600);
    return;
  }
});

// ---- Webhook server ----
app.get("/", (req, res) => res.send("OK"));

app.post("/telegram", async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
  } catch (e) {
    console.error("Update error:", e);
  }
  res.sendStatus(200);
});

const PORT = process.env.PORT || 8080;

function publicUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  if (process.env.FLY_APP_NAME) return `https://${process.env.FLY_APP_NAME}.fly.dev`;
  return null;
}

async function ensureWebhook() {
  const base = publicUrl();
  if (!base) return;
  const url = `${base.replace(/\/$/, "")}/telegram`;

  try {
    const info = await bot.telegram.getWebhookInfo();
    if (info.url === url) return;
  } catch {}

  await bot.telegram.setWebhook(url);
  console.log("Webhook set:", url);
}

app.listen(PORT, async () => {
  console.log("Running on port", PORT);
  await ensureWebhook();
});
