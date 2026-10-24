export type MonitorStatus = "up" | "down" | "pending";

/** 1 回のチェック結果 */
export interface CheckResult {
  at: string;
  ok: boolean;
  statusCode: number | null;
  responseMs: number | null;
  error?: string;
}

/** 監視対象の URL と、その現在の状態 */
export interface Monitor {
  id: string;
  name: string;
  url: string;
  intervalMin: number;
  status: MonitorStatus;
  /** 連続で失敗した回数。CONFIRM_FAILURES に達したら停止と判定する */
  failCount: number;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  createdAt: string;
  /** 新しい順 */
  history: CheckResult[];
}

/** 状態が変わった時に通知するイベント */
export interface StatusEvent {
  id: string;
  kind: "down" | "recovered";
  monitorId: string;
  monitorName: string;
  url: string;
  at: string;
  detail: string;
}
