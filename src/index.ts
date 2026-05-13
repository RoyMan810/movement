import { config } from 'dotenv';
import { Markup, Telegraf } from 'telegraf';

config();

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is missing in .env');
}

type CatProfile = {
  name: string;
  kotost: number;
  fedCount: number;
  pettedCount: number;
  washedCount: number;
};

const cats = new Map<number, CatProfile>();
const pendingName = new Set<number>();

const bot = new Telegraf(token);

const mainKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🍗 Покормить', 'feed')],
  [Markup.button.callback('🖐 Погладить', 'pet')],
  [Markup.button.callback('🛁 Помыть', 'wash')],
  [Markup.button.callback('📊 Профиль', 'profile')],
  [Markup.button.callback('🏆 Лидерборд', 'leaderboard')],
]);

const gainKotost = (userId: number, action: 'feed' | 'pet' | 'wash') => {
  const cat = cats.get(userId);
  if (!cat) return null;

  let score = 0;
  if (action === 'feed') {
    score = 3;
    cat.fedCount += 1;
  }
  if (action === 'pet') {
    score = 2;
    cat.pettedCount += 1;
  }
  if (action === 'wash') {
    score = 4;
    cat.washedCount += 1;
  }

  cat.kotost += score;
  return { cat, score };
};

const profileText = (cat: CatProfile) =>
  `🐱 Кличка: ${cat.name}\n` +
  `✨ Котость: ${cat.kotost}\n` +
  `🍗 Кормлений: ${cat.fedCount}\n` +
  `🖐 Поглаживаний: ${cat.pettedCount}\n` +
  `🛁 Помывок: ${cat.washedCount}`;

bot.start(async (ctx) => {
  const userId = ctx.from.id;

  if (!cats.has(userId)) {
    pendingName.add(userId);
    await ctx.reply(
      'Добро пожаловать в Котность! 🐾\nПридумай кличку для своего кота и отправь её сообщением.'
    );
    return;
  }

  await ctx.reply('С возвращением в Котность! Выбирай действие:', mainKeyboard);
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;

  if (!pendingName.has(userId)) return;

  const name = ctx.message.text.trim().slice(0, 24);
  if (!name) {
    await ctx.reply('Кличка не может быть пустой. Попробуй ещё раз.');
    return;
  }

  cats.set(userId, {
    name,
    kotost: 0,
    fedCount: 0,
    pettedCount: 0,
    washedCount: 0,
  });
  pendingName.delete(userId);

  await ctx.reply(`Отлично! Твой кот \"${name}\" создан. Начинаем качать котость!`, mainKeyboard);
});

bot.action(['feed', 'pet', 'wash'], async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from.id;
  if (!cats.has(userId)) {
    pendingName.add(userId);
    await ctx.reply('Сначала создай кота: отправь его кличку сообщением.');
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

  await ctx.reply(
    `Ты ${actionText[action]} кота ${result.cat.name}. +${result.score} котости!\n` +
      `Текущая котость: ${result.cat.kotost}`,
    mainKeyboard
  );
});

bot.action('profile', async (ctx) => {
  await ctx.answerCbQuery();

  const cat = cats.get(ctx.from.id);
  if (!cat) {
    pendingName.add(ctx.from.id);
    await ctx.reply('Сначала создай кота: отправь его кличку сообщением.');
    return;
  }

  await ctx.reply(profileText(cat), mainKeyboard);
});

bot.action('leaderboard', async (ctx) => {
  await ctx.answerCbQuery();

  if (cats.size === 0) {
    await ctx.reply('Пока никто не прокачал котость. Будь первым!');
    return;
  }

  const leaders = [...cats.entries()]
    .sort((a, b) => b[1].kotost - a[1].kotost)
    .slice(0, 10)
    .map(([_, cat], index) => `${index + 1}. ${cat.name} — ${cat.kotost}`)
    .join('\n');

  await ctx.reply(`🏆 Топ по котости:\n${leaders}`, mainKeyboard);
});

bot.catch((err) => {
  console.error('Bot error:', err);
});

bot.launch().then(() => {
  console.log('Kotnost bot started');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
