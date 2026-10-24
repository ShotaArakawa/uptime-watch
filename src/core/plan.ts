import type { Monitor } from "./types.ts";

export type Plan = "free" | "pro";

export interface PlanLimit {
  label: string;
  maxMonitors: number;
  /** 設定できる最短のチェック間隔(分) */
  minIntervalMin: number;
}

export const PLANS: Record<Plan, PlanLimit> = {
  free: { label: "無料", maxMonitors: 3, minIntervalMin: 5 },
  pro: { label: "有料(モック)", maxMonitors: 50, minIntervalMin: 1 },
};

export const INTERVAL_CHOICES = [1, 5, 10, 30, 60];

export interface NewMonitorInput {
  name: string;
  url: string;
  intervalMin: number;
}

export interface TargetOptions {
  /** localhost やプライベート IP を許可するか(ローカル検証用。本番では false) */
  allowPrivate: boolean;
}

/** 監視先 URL の検査。問題があればエラーメッセージを返す */
export function validateTarget(raw: string, options: TargetOptions): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "URL の形式が正しくありません(https:// から入力してください)";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "http または https の URL のみ監視できます";
  }
  if (url.username || url.password) {
    return "ID・パスワード入りの URL は登録できません";
  }
  if (!options.allowPrivate && isPrivateHost(url.hostname)) {
    return "社内・ローカルのアドレスは監視できません";
  }
  return null;
}

/** SSRF 対策の簡易判定。名前解決後の IP までは見ていない(本実装で要強化) */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** 入力を検査して新しい監視対象を作る。エラー時は文字列を返す */
export function createMonitor(
  input: NewMonitorInput,
  existing: Monitor[],
  plan: Plan,
  options: TargetOptions & { id: string; now: Date },
): Monitor | string {
  const limit = PLANS[plan];
  if (existing.length >= limit.maxMonitors) {
    return `${limit.label}プランで監視できるのは ${limit.maxMonitors} 件までです`;
  }
  const error = validateTarget(input.url, options);
  if (error) return error;
  const url = new URL(input.url.trim()).toString();
  if (existing.some((m) => m.url === url)) return "この URL はすでに登録されています";
  if (!INTERVAL_CHOICES.includes(input.intervalMin)) return "チェック間隔が不正です";
  if (input.intervalMin < limit.minIntervalMin) {
    return `${limit.label}プランのチェック間隔は ${limit.minIntervalMin} 分以上です`;
  }
  return {
    id: options.id,
    name: input.name.trim() || new URL(url).hostname,
    url,
    intervalMin: input.intervalMin,
    status: "pending",
    failCount: 0,
    lastCheckedAt: null,
    lastChangedAt: null,
    createdAt: options.now.toISOString(),
    history: [],
  };
}
