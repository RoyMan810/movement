import { config } from 'dotenv';
import { Markup, Telegraf } from 'telegraf';

import {
  createCatStmt,
  ensureUser,
  gainKotost,
  getLeaders,
  profileText,
  setPendingStmt,
  updateLastMessageStmt,
} from './catLogic';
import type { CatAction } from './types';

config();

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is missing in .env');
}

const bot = new Telegraf(token);

const mainKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback('🍗 Покормить', 'feed'),
    Markup.button.callback('🖐 Погладить', 'pet'),
  ],
  [
    Markup.button.callback('🛁 Помыть', 'wash'),
    Markup.button.callback('📊 Профиль', 'profile'),
  ],
  [Markup.button.callback('🏆 Лидерборд', 'leaderboard')],
]);


const sendOrEditMain = async (
  ctx: any,
  userId: number,
  text: string,
  withKeyboard: boolean = true
) => {
  const cat = ensureUser(userId);

  if (cat.lastMessageId) {
    try {
      await ctx.telegram.editMessageText(ctx.chat.id, cat.lastMessageId, undefined, text, {
        reply_markup: withKeyboard ? mainKeyboard.reply_markup : undefined,
      });
      return;
    } catch {
      // If we can't edit previous message (deleted/too old), fall back to a new one.
    }
  }

  const sent = withKeyboard ? await ctx.reply(text, mainKeyboard) : await ctx.reply(text);
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
      'Добро пожаловать в Котность! 🐾\nПридумай кличку для своего кота и отправь её сообщением.',
      false
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

  const action = ctx.match[0] as CatAction;
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

  const leadersRows = getLeaders();

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
