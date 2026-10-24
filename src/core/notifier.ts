import type { StatusEvent } from "./types.ts";

/** 通知の差し替えポイント。今はコンソール出力、本実装でメール(Resend 等)や Slack/Discord */
export interface Notifier {
  notify(event: StatusEvent): Promise<void>;
}

export function formatMessage(e: StatusEvent): string {
  const head = e.kind === "down" ? `【停止】${e.monitorName} に接続できません` : `【復旧】${e.monitorName} が復旧しました`;
  return `${head}\nURL: ${e.url}\n詳細: ${e.detail}\n時刻: ${e.at}`;
}

export const consoleNotifier: Notifier = {
  async notify(e) {
    console.log(`[notify:mock] ${formatMessage(e).replace(/\n/g, " / ")}`);
  },
};

/**
 * Slack / Discord などの Incoming Webhook に送る骨格。
 * Slack は { text }、Discord は { content } を受け付けるので両方入れて送る。
 */
export function createWebhookNotifier(webhookUrl: string, fetchFn: typeof fetch = fetch): Notifier {
  return {
    async notify(e) {
      const text = formatMessage(e);
      const res = await fetchFn(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, content: text }),
      });
      if (!res.ok) throw new Error(`webhook failed: HTTP ${res.status}`);
    },
  };
}

/** 複数の通知先に送る。1 つ失敗しても他は送る */
export function combineNotifiers(list: Notifier[]): Notifier {
  return {
    async notify(e) {
      const results = await Promise.allSettled(list.map((n) => n.notify(e)));
      for (const r of results) {
        if (r.status === "rejected") console.error("[notify] failed:", r.reason);
      }
    },
  };
}
