import { config } from 'dotenv';
import Database from 'better-sqlite3';
import { Markup, Telegraf } from 'telegraf';

config();

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is missing in .env');
}

type CatProfile = {
  userId: number;
  name: string;
  kotost: number;
  fedCount: number;
  pettedCount: number;
  washedCount: number;
  pendingName: number;
  lastMessageId: number | null;
};

const db = new Database('kotnost.sqlite');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS cats (
    user_id INTEGER PRIMARY KEY,
    name TEXT,
    kotost INTEGER NOT NULL DEFAULT 0,
    fed_count INTEGER NOT NULL DEFAULT 0,
    petted_count INTEGER NOT NULL DEFAULT 0,
    washed_count INTEGER NOT NULL DEFAULT 0,
    pending_name INTEGER NOT NULL DEFAULT 0,
    last_message_id INTEGER
  );
`);

const getCatStmt = db.prepare(
  'SELECT user_id as userId, name, kotost, fed_count as fedCount, petted_count as pettedCount, washed_count as washedCount, pending_name as pendingName, last_message_id as lastMessageId FROM cats WHERE user_id = ?'
);
const upsertUserStmt = db.prepare('INSERT INTO cats (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING');
const setPendingStmt = db.prepare('UPDATE cats SET pending_name = ? WHERE user_id = ?');
const createCatStmt = db.prepare(
  'UPDATE cats SET name = ?, kotost = 0, fed_count = 0, petted_count = 0, washed_count = 0, pending_name = 0 WHERE user_id = ?'
);
const updateLastMessageStmt = db.prepare('UPDATE cats SET last_message_id = ? WHERE user_id = ?');

const bot = new Telegraf(token);

const mainKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🍗 Покормить', 'feed')],
  [Markup.button.callback('🖐 Погладить', 'pet')],
  [Markup.button.callback('🛁 Помыть', 'wash')],
  [Markup.button.callback('📊 Профиль', 'profile')],
  [Markup.button.callback('🏆 Лидерборд', 'leaderboard')],
]);

const ensureUser = (userId: number) => {
  upsertUserStmt.run(userId);
  return getCatStmt.get(userId) as CatProfile;
};

const gainKotost = (userId: number, action: 'feed' | 'pet' | 'wash') => {
  const cat = ensureUser(userId);
  if (!cat.name) return null;

  let score = 0;
  if (action === 'feed') {
    score = 3;
    db.prepare('UPDATE cats SET fed_count = fed_count + 1, kotost = kotost + ? WHERE user_id = ?').run(score, userId);
  }
  if (action === 'pet') {
    score = 2;
    db.prepare('UPDATE cats SET petted_count = petted_count + 1, kotost = kotost + ? WHERE user_id = ?').run(score, userId);
  }
  if (action === 'wash') {
    score = 4;
    db.prepare('UPDATE cats SET washed_count = washed_count + 1, kotost = kotost + ? WHERE user_id = ?').run(score, userId);
  }

  return { cat: ensureUser(userId), score };
};

const profileText = (cat: CatProfile) =>
  `🐱 Кличка: ${cat.name}\n` +
  `✨ Котость: ${cat.kotost}\n` +
  `🍗 Кормлений: ${cat.fedCount}\n` +
  `🖐 Поглаживаний: ${cat.pettedCount}\n` +
  `🛁 Помывок: ${cat.washedCount}`;

const sendOrEditMain = async (ctx: any, userId: number, text: string) => {
  const cat = ensureUser(userId);

  if (cat.lastMessageId) {
    try {
      await ctx.telegram.editMessageText(ctx.chat.id, cat.lastMessageId, undefined, text, {
        reply_markup: mainKeyboard.reply_markup,
      });
      return;
    } catch {
      // If we can't edit previous message (deleted/too old), fall back to a new one.
    }
  }

  const sent = await ctx.reply(text, mainKeyboard);
  updateLastMessageStmt.run(sent.message_id, userId);
};

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const cat = ensureUser(userId);

  if (!cat.name) {
    setPendingStmt.run(1, userId);
    await sendOrEditMain(
      ctx,
      userId,
      'Добро пожаловать в Котность! 🐾\nПридумай кличку для своего кота и отправь её сообщением.'
    );
    return;
  }

  setPendingStmt.run(0, userId);
  await sendOrEditMain(ctx, userId, 'С возвращением в Котность! Выбирай действие:');
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const cat = ensureUser(userId);

  if (!cat.pendingName) return;

  const name = ctx.message.text.trim().slice(0, 24);
  if (!name) {
    await sendOrEditMain(ctx, userId, 'Кличка не может быть пустой. Попробуй ещё раз.');
    return;
  }

  createCatStmt.run(name, userId);
  await sendOrEditMain(ctx, userId, `Отлично! Твой кот "${name}" создан. Начинаем качать котость!`);
});

bot.action(['feed', 'pet', 'wash'], async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  const cat = ensureUser(userId);
  if (!cat.name) {
    setPendingStmt.run(1, userId);
    await sendOrEditMain(ctx, userId, 'Сначала создай кота: отправь его кличку сообщением.');
    return;
  }

  const action = ctx.match[0] as 'feed' | 'pet' | 'wash';
  const result = gainKotost(userId, action);

  if (!result) return;

  const actionText: Record<typeof action, string> = {
    feed: 'покормил',
    pet: 'погладил',
    wash: 'помыл',
  };

  await sendOrEditMain(
    ctx,
    userId,
    `Ты ${actionText[action]} кота ${result.cat.name}. +${result.score} котости!\n` +
      `Текущая котость: ${result.cat.kotost}`
  );
});

bot.action('profile', async (ctx) => {
  await ctx.answerCbQuery();

  const cat = ensureUser(ctx.from.id);
  if (!cat.name) {
    setPendingStmt.run(1, ctx.from.id);
    await sendOrEditMain(ctx, ctx.from.id, 'Сначала создай кота: отправь его кличку сообщением.');
    return;
  }

  await sendOrEditMain(ctx, ctx.from.id, profileText(cat));
});

bot.action('leaderboard', async (ctx) => {
  await ctx.answerCbQuery();

  const leadersRows = db
    .prepare('SELECT name, kotost FROM cats WHERE name IS NOT NULL ORDER BY kotost DESC LIMIT 10')
    .all() as Array<{ name: string; kotost: number }>;

  if (leadersRows.length === 0) {
    await sendOrEditMain(ctx, ctx.from.id, 'Пока никто не прокачал котость. Будь первым!');
    return;
  }

  const leaders = leadersRows.map((cat, index) => `${index + 1}. ${cat.name} — ${cat.kotost}`).join('\n');

  await sendOrEditMain(ctx, ctx.from.id, `🏆 Топ по котости:\n${leaders}`);
});

bot.catch((err) => {
  console.error('Bot runtime error:', err);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const launchWithRetry = async () => {
  const retryDelayMs = Number(process.env.RETRY_DELAY_MS ?? 10000);

  while (true) {
    try {
      await bot.launch();
      console.log('Kotnost bot started');
      return;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      console.error(
        `Bot launch failed (${error.code ?? 'UNKNOWN'}). Retrying in ${retryDelayMs / 1000}s...`
      );
      await sleep(retryDelayMs);
    }
  }
};

void launchWithRetry();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
