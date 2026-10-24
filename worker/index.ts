/**
 * Cloudflare Workers のエントリ。
 * - fetch: 画面から使う API(監視対象の登録・一覧・削除、今すぐチェック、通知履歴)
 * - scheduled: cron(wrangler.toml の triggers)で毎分起動し、期限が来た URL をチェックする
 *
 * 保存はメモリ(MemoryRepo)なので isolate が入れ替わると消える。本実装で D1 / KV に差し替える。
 */
import { createHttpChecker } from "../src/core/check.ts";
import { combineNotifiers, consoleNotifier, createWebhookNotifier, type Notifier } from "../src/core/notifier.ts";
import { createMonitor, type Plan } from "../src/core/plan.ts";
import { MemoryRepo } from "../src/core/repo.ts";
import { runDueChecks } from "../src/core/service.ts";

export interface Env {
  /** "1" のとき localhost などへの監視を許可する(ローカル検証専用) */
  ALLOW_PRIVATE_HOSTS?: string;
  /** Slack / Discord の Incoming Webhook。未設定ならコンソール出力のみ */
  WEBHOOK_URL?: string;
  /** 課金実装までの仮のプラン指定 */
  PLAN?: string;
}

const repo = new MemoryRepo();

function notifierFor(env: Env): Notifier {
  return env.WEBHOOK_URL
    ? combineNotifiers([consoleNotifier, createWebhookNotifier(env.WEBHOOK_URL)])
    : consoleNotifier;
}

const CORS = {
  // 雛形ではどこからでも呼べる。本実装では Pages のドメインに絞り、認証を入れる
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (path === "/api/health") return json({ ok: true });

  if (path === "/api/monitors" && req.method === "GET") {
    return json({ monitors: await repo.listMonitors() });
  }

  if (path === "/api/monitors" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as { name?: string; url?: string; intervalMin?: number } | null;
    if (!body?.url) return json({ error: "url は必須です" }, 400);
    const plan: Plan = env.PLAN === "pro" ? "pro" : "free";
    const created = createMonitor(
      { name: body.name ?? "", url: body.url, intervalMin: Number(body.intervalMin ?? 5) },
      await repo.listMonitors(),
      plan,
      { allowPrivate: env.ALLOW_PRIVATE_HOSTS === "1", id: crypto.randomUUID(), now: new Date() },
    );
    if (typeof created === "string") return json({ error: created }, 400);
    await repo.saveMonitor(created);
    return json({ monitor: created }, 201);
  }

  const del = path.match(/^\/api\/monitors\/([\w-]+)$/);
  if (del && req.method === "DELETE") {
    await repo.removeMonitor(del[1]);
    return json({ ok: true });
  }

  if (path === "/api/check" && req.method === "POST") {
    const summary = await runDueChecks({
      repo,
      checker: createHttpChecker(),
      notifier: notifierFor(env),
      force: url.searchParams.get("force") === "1",
    });
    return json(summary);
  }

  if (path === "/api/events" && req.method === "GET") {
    return json({ events: await repo.listEvents() });
  }

  return json({ error: "not found" }, 404);
}

export default {
  fetch: handle,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runDueChecks({ repo, checker: createHttpChecker(), notifier: notifierFor(env) }).then((s) => {
        console.log(`[cron] checked=${s.checked} events=${s.events.length}`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
