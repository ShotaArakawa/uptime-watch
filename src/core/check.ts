import type { CheckResult } from "./types.ts";

/** URL を 1 回チェックする関数。本番は HTTP、デモ・テストはモックに差し替える */
export type Checker = (url: string) => Promise<CheckResult>;

export interface HttpCheckerOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export const DEFAULT_TIMEOUT_MS = 10_000;

/** 2xx / 3xx を正常とみなす(リダイレクトは追従後のステータスで判定) */
export function isHealthyStatus(code: number): boolean {
  return code >= 200 && code < 400;
}

export function createHttpChecker(options: HttpCheckerOptions = {}): Checker {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;

  return async (url) => {
    const started = now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "uptime-watch/0.1 (+monitor)" },
      });
      // 本文は使わないので読み捨てて接続を解放する
      await res.body?.cancel();
      const ok = isHealthyStatus(res.status);
      return {
        at: new Date(started).toISOString(),
        ok,
        statusCode: res.status,
        responseMs: now() - started,
        error: ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (e) {
      const aborted = controller.signal.aborted;
      return {
        at: new Date(started).toISOString(),
        ok: false,
        statusCode: null,
        responseMs: aborted ? timeoutMs : null,
        error: aborted ? `タイムアウト(${timeoutMs / 1000}秒)` : `接続失敗: ${(e as Error).message}`,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * デモ用のチェッカー。ブラウザからは CORS で任意の URL を確認できないため、
 * isDown が true の URL を失敗、それ以外を成功として返す。
 */
export function createMockChecker(isDown: (url: string) => boolean, now: () => number = Date.now): Checker {
  return async (url) => {
    const at = new Date(now()).toISOString();
    if (isDown(url) || new URL(url).hostname.endsWith(".invalid")) {
      return { at, ok: false, statusCode: 503, responseMs: 120, error: "HTTP 503(模擬障害)" };
    }
    // 長さに応じて少しばらつく応答時間(見た目用)
    const responseMs = 80 + ((url.length * 37 + Math.floor(now() / 1000)) % 220);
    return { at, ok: true, statusCode: 200, responseMs };
  };
}
