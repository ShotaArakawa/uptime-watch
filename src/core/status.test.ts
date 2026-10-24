import assert from "node:assert/strict";
import { test } from "node:test";
import { applyResult, averageResponseMs, CONFIRM_FAILURES, isDue, uptimePercent } from "./status.ts";
import type { CheckResult, Monitor } from "./types.ts";

const base: Monitor = {
  id: "m1",
  name: "テスト",
  url: "https://example.com/",
  intervalMin: 5,
  status: "pending",
  failCount: 0,
  lastCheckedAt: null,
  lastChangedAt: null,
  createdAt: "2026-10-24T00:00:00.000Z",
  history: [],
};

const ok = (at: string): CheckResult => ({ at, ok: true, statusCode: 200, responseMs: 100 });
const ng = (at: string): CheckResult => ({ at, ok: false, statusCode: 503, responseMs: 50, error: "HTTP 503" });

test("最初の成功では通知せず up になる", () => {
  const { monitor, event } = applyResult(base, ok("2026-10-24T00:01:00.000Z"), "e1");
  assert.equal(monitor.status, "up");
  assert.equal(event, null);
});

test("1 回の失敗では停止扱いにせず、連続失敗で down を通知する", () => {
  const up = { ...base, status: "up" as const };
  const first = applyResult(up, ng("2026-10-24T00:05:00.000Z"), "e1");
  assert.equal(first.monitor.status, "up");
  assert.equal(first.monitor.failCount, 1);
  assert.equal(first.event, null);
  assert.equal(CONFIRM_FAILURES, 2);

  const second = applyResult(first.monitor, ng("2026-10-24T00:10:00.000Z"), "e2");
  assert.equal(second.monitor.status, "down");
  assert.equal(second.event?.kind, "down");
  assert.equal(second.event?.detail, "HTTP 503");

  const third = applyResult(second.monitor, ng("2026-10-24T00:15:00.000Z"), "e3");
  assert.equal(third.event, null, "停止中の失敗は再通知しない");
});

test("停止から成功に戻ると停止時間つきで復旧を通知する", () => {
  const down: Monitor = { ...base, status: "down", failCount: 3, lastChangedAt: "2026-10-24T00:10:00.000Z" };
  const { monitor, event } = applyResult(down, ok("2026-10-24T00:40:00.000Z"), "e1");
  assert.equal(monitor.status, "up");
  assert.equal(monitor.failCount, 0);
  assert.equal(event?.kind, "recovered");
  assert.equal(event?.detail, "停止時間 約30分");
});

test("一時的な失敗のあとに成功しても復旧通知は出さない", () => {
  const up: Monitor = { ...base, status: "up", failCount: 1 };
  const { monitor, event } = applyResult(up, ok("2026-10-24T00:05:00.000Z"), "e1");
  assert.equal(monitor.failCount, 0);
  assert.equal(event, null);
});

test("isDue は間隔ごとに true になる(数秒の早まりは許容)", () => {
  const checked = { ...base, lastCheckedAt: "2026-10-24T00:00:00.000Z" };
  const t = Date.parse("2026-10-24T00:00:00.000Z");
  assert.equal(isDue(base, t), true);
  assert.equal(isDue(checked, t + 4 * 60_000), false);
  assert.equal(isDue(checked, t + 5 * 60_000 - 3_000), true);
});

test("稼働率と平均応答時間", () => {
  const history = [ok("a"), ok("b"), ng("c"), ok("d")];
  assert.equal(uptimePercent(history), 75);
  assert.equal(uptimePercent([]), null);
  assert.equal(averageResponseMs(history), 100);
});

test("履歴は上限で切り詰められ、新しい順に並ぶ", () => {
  let m = base;
  for (let i = 0; i < 70; i++) m = applyResult(m, ok(`t${i}`), `e${i}`).monitor;
  assert.equal(m.history.length, 60);
  assert.equal(m.history[0].at, "t69");
});
