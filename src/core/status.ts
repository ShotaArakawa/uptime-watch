import type { CheckResult, Monitor, StatusEvent } from "./types.ts";

/** この回数連続で失敗したら「停止」と判定する(一時的な揺れで通知しないため) */
export const CONFIRM_FAILURES = 2;
export const HISTORY_LIMIT = 60;

export interface ApplyOutcome {
  monitor: Monitor;
  event: StatusEvent | null;
}

/** チェック結果を監視対象に反映し、状態が変わったら通知イベントを返す */
export function applyResult(monitor: Monitor, result: CheckResult, eventId: string): ApplyOutcome {
  const history = [result, ...monitor.history].slice(0, HISTORY_LIMIT);
  const base: Monitor = { ...monitor, history, lastCheckedAt: result.at };

  if (result.ok) {
    const next: Monitor = { ...base, status: "up", failCount: 0 };
    if (monitor.status === "up") return { monitor: next, event: null };
    next.lastChangedAt = result.at;
    if (monitor.status === "pending") return { monitor: next, event: null };
    return {
      monitor: next,
      event: makeEvent(eventId, "recovered", next, result, downtimeDetail(monitor, result)),
    };
  }

  const failCount = monitor.failCount + 1;
  if (monitor.status === "down" || failCount < CONFIRM_FAILURES) {
    return { monitor: { ...base, failCount }, event: null };
  }
  const next: Monitor = { ...base, status: "down", failCount, lastChangedAt: result.at };
  return {
    monitor: next,
    event: makeEvent(eventId, "down", next, result, result.error ?? "応答なし"),
  };
}

function makeEvent(
  id: string,
  kind: StatusEvent["kind"],
  m: Monitor,
  r: CheckResult,
  detail: string,
): StatusEvent {
  return { id, kind, monitorId: m.id, monitorName: m.name, url: m.url, at: r.at, detail };
}

function downtimeDetail(prev: Monitor, r: CheckResult): string {
  if (!prev.lastChangedAt) return "復旧しました";
  const minutes = Math.round((Date.parse(r.at) - Date.parse(prev.lastChangedAt)) / 60_000);
  return `停止時間 約${Math.max(minutes, 1)}分`;
}

/** 次のチェック時刻を過ぎているか */
export function isDue(monitor: Monitor, nowMs: number): boolean {
  if (!monitor.lastCheckedAt) return true;
  // cron の起動が数秒ずれても取りこぼさないよう 5 秒の余裕を持たせる
  return nowMs - Date.parse(monitor.lastCheckedAt) >= monitor.intervalMin * 60_000 - 5_000;
}

/** 履歴に残っている範囲の稼働率(%)。履歴がなければ null */
export function uptimePercent(history: CheckResult[]): number | null {
  if (history.length === 0) return null;
  const ok = history.filter((h) => h.ok).length;
  return Math.round((ok / history.length) * 1000) / 10;
}

export function averageResponseMs(history: CheckResult[]): number | null {
  const values = history.filter((h) => h.ok && h.responseMs !== null).map((h) => h.responseMs!);
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
