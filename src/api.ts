import { createMockChecker } from "./core/check.ts";
import { consoleNotifier } from "./core/notifier.ts";
import { createMonitor, type NewMonitorInput, type Plan } from "./core/plan.ts";
import { MemoryRepo, type RepoSnapshot } from "./core/repo.ts";
import { runDueChecks, type RunSummary } from "./core/service.ts";
import type { Monitor, StatusEvent } from "./core/types.ts";

export interface Snapshot {
  monitors: Monitor[];
  events: StatusEvent[];
}

/**
 * 画面から見たデータの出入り口。
 * - LocalApi: ブラウザ内で完結するデモ(localStorage 保存 + 模擬チェッカー)
 * - HttpApi: Workers の /api を呼ぶ(VITE_API_BASE を設定した時)
 */
export interface MonitorApi {
  readonly mode: "local" | "http";
  load(): Promise<Snapshot>;
  /** 失敗時はエラーメッセージを返す */
  add(input: NewMonitorInput, plan: Plan): Promise<string | null>;
  remove(id: string): Promise<void>;
  checkAll(force: boolean): Promise<RunSummary>;
}

interface LocalState extends RepoSnapshot {
  simulatedDown: string[];
}

const KEY = "uptime-watch:v1";

export class LocalApi implements MonitorApi {
  readonly mode = "local";
  private state: LocalState;
  private repo: MemoryRepo;

  constructor() {
    this.state = loadLocal();
    const { monitors, events } = this.state;
    this.repo = new MemoryRepo({ monitors, events }, (snapshot) => {
      // simulatedDown は repo の外で持つので、monitors と events だけ取り込む
      this.state = { ...this.state, monitors: snapshot.monitors, events: snapshot.events };
      saveLocal(this.state);
    });
  }

  async load() {
    return { monitors: await this.repo.listMonitors(), events: await this.repo.listEvents() };
  }

  async add(input: NewMonitorInput, plan: Plan) {
    const created = createMonitor(input, await this.repo.listMonitors(), plan, {
      // デモは実際に通信しないので、ローカルのアドレスも登録できるようにしている
      allowPrivate: true,
      id: crypto.randomUUID(),
      now: new Date(),
    });
    if (typeof created === "string") return created;
    await this.repo.saveMonitor(created);
    return null;
  }

  async remove(id: string) {
    this.setSimulatedDown(id, false);
    await this.repo.removeMonitor(id);
  }

  checkAll(force: boolean) {
    const monitors = this.state.monitors;
    const downUrls = new Set(monitors.filter((m) => this.state.simulatedDown.includes(m.id)).map((m) => m.url));
    return runDueChecks({
      repo: this.repo,
      checker: createMockChecker((url) => downUrls.has(url)),
      notifier: consoleNotifier,
      force,
    });
  }

  /** デモ専用: 障害を起こしたことにする */
  setSimulatedDown(id: string, down: boolean) {
    const rest = this.state.simulatedDown.filter((x) => x !== id);
    this.state = { ...this.state, simulatedDown: down ? [...rest, id] : rest };
    saveLocal(this.state);
  }

  isSimulatedDown(id: string) {
    return this.state.simulatedDown.includes(id);
  }
}

function loadLocal(): LocalState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalState>;
      return { monitors: parsed.monitors ?? [], events: parsed.events ?? [], simulatedDown: parsed.simulatedDown ?? [] };
    }
  } catch {
    // 壊れたデータは捨てて初期状態から始める
  }
  return { monitors: seedMonitors(), events: [], simulatedDown: [] };
}

function saveLocal(state: LocalState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 容量超過やプライベートモードでは保存しない(動作は続ける)
  }
}

function seedMonitors(): Monitor[] {
  const now = new Date();
  const seeds: NewMonitorInput[] = [
    { name: "公式サイト", url: "https://example.com/", intervalMin: 5 },
    { name: "予約ページ", url: "https://reserve.example.com/", intervalMin: 5 },
  ];
  const list: Monitor[] = [];
  for (const s of seeds) {
    const m = createMonitor(s, list, "free", { allowPrivate: true, id: crypto.randomUUID(), now });
    if (typeof m !== "string") list.push(m);
  }
  return list;
}

export class HttpApi implements MonitorApi {
  readonly mode = "http";
  private base: string;

  constructor(base: string) {
    this.base = base.replace(/\/$/, "");
  }

  async load() {
    const [m, e] = await Promise.all([this.get<{ monitors: Monitor[] }>("/api/monitors"), this.get<{ events: StatusEvent[] }>("/api/events")]);
    return { monitors: m.monitors, events: e.events };
  }

  async add(input: NewMonitorInput) {
    const res = await fetch(`${this.base}/api/monitors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? `登録に失敗しました(HTTP ${res.status})`;
  }

  async remove(id: string) {
    await fetch(`${this.base}/api/monitors/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async checkAll(force: boolean) {
    const res = await fetch(`${this.base}/api/check${force ? "?force=1" : ""}`, { method: "POST" });
    return (await res.json()) as RunSummary;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

export function createApi(): MonitorApi {
  const base = import.meta.env.VITE_API_BASE;
  return base ? new HttpApi(base) : new LocalApi();
}
