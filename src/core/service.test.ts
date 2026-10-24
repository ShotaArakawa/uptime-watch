import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpChecker, createMockChecker } from "./check.ts";
import type { Notifier } from "./notifier.ts";
import { formatMessage } from "./notifier.ts";
import { MemoryRepo } from "./repo.ts";
import { runDueChecks } from "./service.ts";
import type { Monitor, StatusEvent } from "./types.ts";

function monitor(id: string, url: string, lastCheckedAt: string | null = null): Monitor {
  return {
    id,
    name: id,
    url,
    intervalMin: 5,
    status: "up",
    failCount: 0,
    lastCheckedAt,
    lastChangedAt: null,
    createdAt: "2026-10-24T00:00:00.000Z",
    history: [],
  };
}

function recorder(): Notifier & { sent: StatusEvent[] } {
  const sent: StatusEvent[] = [];
  return { sent, async notify(e) { sent.push(e); } };
}

test("期限が来たものだけチェックし、連続失敗で通知する", async () => {
  const t0 = Date.parse("2026-10-24T00:10:00.000Z");
  const repo = new MemoryRepo({
    monitors: [
      monitor("ok", "https://ok.example/"),
      monitor("ng", "https://ng.example/"),
      monitor("fresh", "https://fresh.example/", "2026-10-24T00:09:00.000Z"),
    ],
    events: [],
  });
  const notifier = recorder();
  let clock = t0;
  let n = 0;
  const run = () =>
    runDueChecks({
      repo,
      checker: createMockChecker((u) => u.includes("ng."), () => clock),
      notifier,
      now: () => clock,
      newId: () => `e${++n}`,
    });

  const first = await run();
  assert.equal(first.checked, 2, "fresh は間隔前なのでスキップ");
  assert.equal(notifier.sent.length, 0, "1 回目の失敗では通知しない");

  clock += 5 * 60_000;
  const second = await run();
  assert.equal(second.checked, 3);
  assert.equal(notifier.sent.length, 1);
  assert.equal(notifier.sent[0].monitorId, "ng");
  assert.equal((await repo.listEvents()).length, 1);
  const ng = (await repo.listMonitors()).find((m) => m.id === "ng")!;
  assert.equal(ng.status, "down");
});

test("force なら間隔に関係なく全件チェックする", async () => {
  const repo = new MemoryRepo({ monitors: [monitor("a", "https://a.example/", new Date().toISOString())], events: [] });
  const summary = await runDueChecks({ repo, checker: createMockChecker(() => false), notifier: recorder(), force: true });
  assert.equal(summary.checked, 1);
});

test("通知に失敗しても監視結果は保存される", async () => {
  const repo = new MemoryRepo({ monitors: [{ ...monitor("a", "https://a.example/"), failCount: 1 }], events: [] });
  const broken: Notifier = { async notify() { throw new Error("boom"); } };
  const origError = console.error;
  console.error = () => {};
  try {
    const s = await runDueChecks({ repo, checker: createMockChecker(() => true), notifier: broken });
    assert.equal(s.events.length, 1);
  } finally {
    console.error = origError;
  }
  assert.equal((await repo.listMonitors())[0].status, "down");
});

test("HTTP チェッカー: ステータスとタイムアウトの判定", async () => {
  const fake = (status: number) => (async () => new Response("x", { status })) as typeof fetch;
  assert.equal((await createHttpChecker({ fetchFn: fake(200) })("https://a.example/")).ok, true);
  const r500 = await createHttpChecker({ fetchFn: fake(500) })("https://a.example/");
  assert.equal(r500.ok, false);
  assert.equal(r500.error, "HTTP 500");

  const hang = ((_u: string, init?: RequestInit) =>
    new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
  const timeout = await createHttpChecker({ fetchFn: hang, timeoutMs: 50 })("https://a.example/");
  assert.equal(timeout.ok, false);
  assert.match(timeout.error!, /タイムアウト/);
});

test("通知文", () => {
  const text = formatMessage({
    id: "e1",
    kind: "down",
    monitorId: "a",
    monitorName: "公式サイト",
    url: "https://a.example/",
    at: "2026-10-24T00:00:00.000Z",
    detail: "HTTP 503",
  });
  assert.match(text, /^【停止】公式サイト/);
  assert.match(text, /HTTP 503/);
});
