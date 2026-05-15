import { config } from 'dotenv';
import { Markup, Telegraf } from 'telegraf';

import {
  applyIgnorePenalty,
  createCatStmt,
  ensureUser,
  gainKotost,
  getInactiveCatsForReminder,
  getLeaders,
  markReminderSent,
  profileText,
  setPendingStmt,
  touchInteraction,
  updateLastMessageStmt,
} from './catLogic';
import type { CatAction } from './types';

config();

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is missing in .env');
}

const bot = new Telegraf(token);
const DEBUG_UPDATES = process.env.DEBUG_UPDATES === '1';

if (DEBUG_UPDATES) {
  bot.use(async (ctx, next) => {
    const updateType = ctx.updateType;
    const messageText = 'message' in ctx.update && 'text' in (ctx.update as { message?: { text?: string } }).message!
      ? (ctx.update as { message?: { text?: string } }).message?.text
      : undefined;
    console.log('Incoming update:', {
      updateType,
      from: ctx.from?.id,
      chat: ctx.chat?.id,
      messageText,
      callbackData: ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined,
    });
    await next();
  });
}

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
  withKeyboard: boolean = true,
  forceNew: boolean = false
) => {
  const cat = ensureUser(userId);

  if (!forceNew && cat.lastMessageId) {
    try {
      await ctx.telegram.editMessageText(ctx.chat.id, cat.lastMessageId, undefined, text, {
        reply_markup: withKeyboard ? mainKeyboard.reply_markup : undefined,
      });
      return;
    } catch (err) {
      const description = (err as { response?: { description?: string } })?.response?.description ??
        (err as Error).message ??
        '';

      if (description.toLowerCase().includes('message is not modified')) {
        return;
      }
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
      false,
      true
    );
    return;
  }

  setPendingStmt.run(0, userId);
  touchInteraction(userId);
  await sendOrEditMain(ctx, userId, 'С возвращением в Котность! Выбирай действие:', true, true);
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
  touchInteraction(userId);
  await sendOrEditMain(
    ctx,
    userId,
    `Отлично! Твой кот "${name}" создан. Начинаем качать котость!`,
    true,
    true
  );
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

  touchInteraction(ctx.from.id);
  await sendOrEditMain(ctx, ctx.from.id, profileText(cat));
});

bot.action('leaderboard', async (ctx) => {
  await ctx.answerCbQuery();

  touchInteraction(ctx.from.id);
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


const INACTIVITY_SECONDS = 8 * 60 * 60;
const IGNORE_PENALTY = 2;
const REMINDER_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const startInactivityReminderLoop = () => {
  setInterval(async () => {
    try {
      const inactiveCats = getInactiveCatsForReminder(INACTIVITY_SECONDS);

      for (const cat of inactiveCats) {
        const updatedCat = applyIgnorePenalty(cat.userId, IGNORE_PENALTY);
        const penaltyText = updatedCat.kotost < cat.kotost
          ? `
⚠️ За игнор напоминания -${IGNORE_PENALTY} котости.`
          : '';

        try {
          await bot.telegram.sendMessage(
            cat.userId,
            `🐾 Ты давно не взаимодействовал(а) с котом ${cat.name}. Загляни к нему!${penaltyText}
✨ Текущая котость: ${updatedCat.kotost}`,
            mainKeyboard
          );
          markReminderSent(cat.userId);
        } catch (err) {
          console.error(`Failed to send inactivity reminder to user ${cat.userId}:`, err);
        }
      }
    } catch (err) {
      console.error('Inactivity reminder loop iteration failed:', err);
    }
  }, REMINDER_CHECK_INTERVAL_MS);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const launchWithRetry = async () => {
  const retryDelayMs = Number(process.env.RETRY_DELAY_MS ?? 10000);

  while (true) {
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: false });
      const me = await bot.telegram.getMe();
      await bot.launch({
        allowedUpdates: ['message', 'callback_query'],
      });
      console.log(`Kotnost bot started as @${me.username} (id=${me.id})`);
      startInactivityReminderLoop();
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
