import type { Checker } from "./check.ts";
import type { Notifier } from "./notifier.ts";
import type { MonitorRepo } from "./repo.ts";
import { applyResult, isDue } from "./status.ts";
import type { Monitor, StatusEvent } from "./types.ts";

export interface RunOptions {
  repo: MonitorRepo;
  checker: Checker;
  notifier: Notifier;
  now?: () => number;
  /** true なら間隔を無視して全件チェック(「今すぐチェック」用) */
  force?: boolean;
  newId?: () => string;
  /** 同時に投げるリクエスト数の上限 */
  concurrency?: number;
}

export interface RunSummary {
  checked: number;
  events: StatusEvent[];
}

/** 期限が来た監視対象をチェックし、状態変化があれば保存・通知する。cron からも画面からも呼ぶ */
export async function runDueChecks(options: RunOptions): Promise<RunSummary> {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const monitors = await options.repo.listMonitors();
  const targets = options.force ? monitors : monitors.filter((m) => isDue(m, now()));
  const events: StatusEvent[] = [];

  const queue = [...targets];
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const event = await checkOne(m, options, newId);
      if (event) events.push(event);
    }
  };
  const lanes = Math.max(1, Math.min(options.concurrency ?? 5, queue.length));
  await Promise.all(Array.from({ length: lanes }, worker));

  return { checked: targets.length, events };
}

async function checkOne(m: Monitor, options: RunOptions, newId: () => string): Promise<StatusEvent | null> {
  const result = await options.checker(m.url);
  const { monitor, event } = applyResult(m, result, newId());
  await options.repo.saveMonitor(monitor);
  if (!event) return null;
  await options.repo.addEvent(event);
  try {
    await options.notifier.notify(event);
  } catch (e) {
    // 通知に失敗しても監視は止めない
    console.error("[notify] failed:", e);
  }
  return event;
}
