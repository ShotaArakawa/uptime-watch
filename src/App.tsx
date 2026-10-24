import { useCallback, useEffect, useMemo, useState } from "react";
import { createApi, LocalApi, type Snapshot } from "./api.ts";
import { INTERVAL_CHOICES, PLANS, type Plan } from "./core/plan.ts";
import { averageResponseMs, uptimePercent } from "./core/status.ts";
import type { Monitor, MonitorStatus } from "./core/types.ts";

/** 画面を開いている間の自動チェック間隔。本番では Workers の cron が担当する */
const AUTO_CHECK_MS = 30_000;
const SETTINGS_KEY = "uptime-watch:settings";

interface Settings {
  plan: Plan;
  email: string;
  webhook: string;
}

const DEFAULT_SETTINGS: Settings = { plan: "free", email: "", webhook: "" };

const STATUS_LABEL: Record<MonitorStatus, string> = { up: "正常", down: "停止", pending: "確認待ち" };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function App() {
  const api = useMemo(createApi, []);
  const [data, setData] = useState<Snapshot>({ monitors: [], events: [] });
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [form, setForm] = useState({ name: "", url: "", intervalMin: 5 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setData(await api.load());
    } catch (e) {
      setError(`データを読み込めませんでした: ${(e as Error).message}`);
    }
  }, [api]);

  const check = useCallback(
    async (force: boolean) => {
      setBusy(true);
      try {
        await api.checkAll(force);
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [api, refresh],
  );

  useEffect(() => {
    // 初回表示で期限切れのものをチェックし、以降は一定間隔で回す
    void check(false);
    const id = setInterval(() => void check(false), AUTO_CHECK_MS);
    return () => clearInterval(id);
  }, [check]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // 保存できなくても画面は使える
    }
  }, [settings]);

  const limit = PLANS[settings.plan];
  const counts = useMemo(() => {
    const c = { up: 0, down: 0, pending: 0 };
    for (const m of data.monitors) c[m.status]++;
    return c;
  }, [data.monitors]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const message = await api.add(form, settings.plan);
    if (message) {
      setError(message);
      return;
    }
    setForm({ name: "", url: "", intervalMin: Math.max(form.intervalMin, limit.minIntervalMin) });
    await check(false);
  }

  async function onRemove(m: Monitor) {
    if (!confirm(`「${m.name}」の監視をやめますか?`)) return;
    await api.remove(m.id);
    await refresh();
  }

  function toggleSimulated(m: Monitor) {
    if (!(api instanceof LocalApi)) return;
    api.setSimulatedDown(m.id, !api.isSimulatedDown(m.id));
    setTick((t) => t + 1);
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>かんたん死活監視</h1>
          <p className="lead">URL を登録すると定期的に確認し、落ちたら通知します。</p>
        </div>
        <div className="header-side">
          <span className={`mode mode-${api.mode}`}>{api.mode === "local" ? "デモモード(ブラウザ内で模擬チェック)" : "API 接続中"}</span>
          <label className="plan">
            <input
              type="checkbox"
              checked={settings.plan === "pro"}
              onChange={(e) => setSettings({ ...settings, plan: e.target.checked ? "pro" : "free" })}
            />
            有料プラン(モック)
          </label>
        </div>
      </header>

      <section className="tiles" aria-label="概要">
        <div className="tile">
          <span className="tile-label">監視中</span>
          <strong>
            {data.monitors.length}
            <small> / {limit.maxMonitors}</small>
          </strong>
        </div>
        <div className="tile tile-up">
          <span className="tile-label">正常</span>
          <strong>{counts.up}</strong>
        </div>
        <div className="tile tile-down">
          <span className="tile-label">停止</span>
          <strong>{counts.down}</strong>
        </div>
        <div className="tile">
          <span className="tile-label">確認待ち</span>
          <strong>{counts.pending}</strong>
        </div>
      </section>

      <div className="layout">
        <main>
          <section className="panel">
            <h2>URL を登録</h2>
            <form className="add-form" onSubmit={onAdd}>
              <label>
                名前(任意)
                <input value={form.name} placeholder="公式サイト" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="grow">
                URL
                <input
                  value={form.url}
                  placeholder="https://example.com/"
                  required
                  inputMode="url"
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                />
              </label>
              <label>
                間隔
                <select value={form.intervalMin} onChange={(e) => setForm({ ...form, intervalMin: Number(e.target.value) })}>
                  {INTERVAL_CHOICES.map((n) => (
                    <option key={n} value={n} disabled={n < limit.minIntervalMin}>
                      {n} 分{n < limit.minIntervalMin ? "(有料)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit">登録</button>
            </form>
            {error && <p className="error" role="alert">{error}</p>}
            <p className="muted small">
              {limit.label}プラン: {limit.maxMonitors} 件まで、最短 {limit.minIntervalMin} 分間隔。2 回続けて失敗したら「停止」と判定します。
            </p>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>ステータス</h2>
              <button type="button" className="secondary" disabled={busy} onClick={() => void check(true)}>
                {busy ? "確認中…" : "今すぐ全部チェック"}
              </button>
            </div>
            {data.monitors.length === 0 ? (
              <p className="muted">まだ登録がありません。上のフォームから URL を追加してください。</p>
            ) : (
              <ul className="monitors">
                {data.monitors.map((m) => (
                  <MonitorRow
                    key={m.id}
                    monitor={m}
                    simulated={api instanceof LocalApi ? api.isSimulatedDown(m.id) : null}
                    onToggleSimulated={() => toggleSimulated(m)}
                    onRemove={() => void onRemove(m)}
                  />
                ))}
              </ul>
            )}
          </section>
        </main>

        <aside>
          <section className="panel">
            <h2>通知先</h2>
            <label className="stack">
              メール
              <input
                type="email"
                value={settings.email}
                placeholder="you@example.com"
                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
              />
            </label>
            <label className="stack">
              Slack / Discord の Webhook URL
              <input
                value={settings.webhook}
                placeholder="https://hooks.slack.com/..."
                onChange={(e) => setSettings({ ...settings, webhook: e.target.value })}
              />
            </label>
            <p className="muted small">
              雛形では実際には送信しません(通知はコンソール出力のモック)。本実装で Workers からメール・Webhook に送ります。
            </p>
          </section>

          <section className="panel">
            <h2>通知履歴</h2>
            {data.events.length === 0 ? (
              <p className="muted small">停止・復旧があるとここに表示されます。</p>
            ) : (
              <ol className="events">
                {data.events.slice(0, 20).map((e) => (
                  <li key={e.id} className={`event event-${e.kind}`}>
                    <span className="event-kind">{e.kind === "down" ? "停止" : "復旧"}</span>
                    <span className="event-name">{e.monitorName}</span>
                    <span className="muted small">
                      {formatTime(e.at)} ・ {e.detail}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

interface RowProps {
  monitor: Monitor;
  /** デモモード以外では null */
  simulated: boolean | null;
  onToggleSimulated: () => void;
  onRemove: () => void;
}

function MonitorRow({ monitor: m, simulated, onToggleSimulated, onRemove }: RowProps) {
  const uptime = uptimePercent(m.history);
  const avg = averageResponseMs(m.history);
  const last = m.history[0];
  // 古い順に並べ、右端を最新にする
  const bars = [...m.history].slice(0, 30).reverse();

  return (
    <li className={`monitor monitor-${m.status}`}>
      <div className="monitor-main">
        <span className={`badge badge-${m.status}`}>{STATUS_LABEL[m.status]}</span>
        <div className="monitor-title">
          <strong>{m.name}</strong>
          <a href={m.url} target="_blank" rel="noreferrer noopener" className="muted small">
            {m.url}
          </a>
        </div>
        <div className="monitor-actions">
          {simulated !== null && (
            <button type="button" className={simulated ? "danger" : "secondary"} onClick={onToggleSimulated}>
              {simulated ? "模擬障害を解除" : "障害を模擬"}
            </button>
          )}
          <button type="button" className="link" onClick={onRemove}>
            削除
          </button>
        </div>
      </div>
      <div className="history" aria-label="直近のチェック結果">
        {bars.length === 0 && <span className="muted small">まだチェックしていません</span>}
        {bars.map((h, i) => (
          <span key={i} className={`bar ${h.ok ? "bar-ok" : "bar-ng"}`} title={`${formatTime(h.at)} ${h.ok ? `${h.responseMs}ms` : h.error}`} />
        ))}
      </div>
      <dl className="stats">
        <div>
          <dt>稼働率</dt>
          <dd>{uptime === null ? "—" : `${uptime}%`}</dd>
        </div>
        <div>
          <dt>平均応答</dt>
          <dd>{avg === null ? "—" : `${avg}ms`}</dd>
        </div>
        <div>
          <dt>最終チェック</dt>
          <dd>{formatTime(m.lastCheckedAt)}</dd>
        </div>
        <div>
          <dt>結果</dt>
          <dd>{last ? (last.ok ? `HTTP ${last.statusCode}` : last.error) : "—"}</dd>
        </div>
        <div>
          <dt>間隔</dt>
          <dd>{m.intervalMin} 分</dd>
        </div>
      </dl>
    </li>
  );
}
