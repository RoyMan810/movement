import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const loadLogic = async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kotnost-test-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  process.env.SQLITE_PATH = dbPath;
  const mod = await import(`../src/catLogic.ts?${Date.now()}-${Math.random()}`);
  return { ...mod, dbPath, tmpDir };
};

test('ensureUser creates default profile', async () => {
  const { ensureUser } = await loadLogic();
  const cat = ensureUser(1001);
  assert.equal(cat.userId, 1001);
  assert.equal(cat.kotost, 0);
  assert.equal(cat.pendingName, 0);
  assert.equal(cat.name, null);
});

test('gainKotost updates score and counters by action', async () => {
  const { ensureUser, createCatStmt, gainKotost } = await loadLogic();
  ensureUser(1002);
  createCatStmt.run('Барсик', 1002);

  let result = gainKotost(1002, 'feed');
  assert.ok(result);
  assert.equal(result.score, 3);
  assert.equal(result.cat.kotost, 3);
  assert.equal(result.cat.fedCount, 1);

  result = gainKotost(1002, 'pet');
  assert.ok(result);
  assert.equal(result.score, 2);
  assert.equal(result.cat.kotost, 5);
  assert.equal(result.cat.pettedCount, 1);

  result = gainKotost(1002, 'wash');
  assert.ok(result);
  assert.equal(result.score, 4);
  assert.equal(result.cat.kotost, 9);
  assert.equal(result.cat.washedCount, 1);
});

test('applyIgnorePenalty never drops kotost below zero', async () => {
  const { ensureUser, createCatStmt, gainKotost, applyIgnorePenalty } = await loadLogic();
  ensureUser(1003);
  createCatStmt.run('Муся', 1003);
  gainKotost(1003, 'pet');

  let cat = applyIgnorePenalty(1003, 1);
  assert.equal(cat.kotost, 1);

  cat = applyIgnorePenalty(1003, 50);
  assert.equal(cat.kotost, 0);
});

test('inactive reminder query respects reminder timestamps', async () => {
  const { ensureUser, createCatStmt, getInactiveCatsForReminder, markReminderSent } = await loadLogic();
  ensureUser(1004);
  createCatStmt.run('Снежок', 1004);

  await new Promise((resolve) => setTimeout(resolve, 1200));

  const firstBatch = getInactiveCatsForReminder(1);
  assert.ok(firstBatch.some((cat) => cat.userId === 1004));

  markReminderSent(1004);
  const secondBatch = getInactiveCatsForReminder(1);
  assert.ok(!secondBatch.some((cat) => cat.userId === 1004));
});
