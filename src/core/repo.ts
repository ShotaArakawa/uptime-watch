import type { Monitor, StatusEvent } from "./types.ts";

export const EVENT_LIMIT = 100;

/** 保存先の差し替えポイント。今はメモリ / localStorage、本実装では D1・KV・Supabase など */
export interface MonitorRepo {
  listMonitors(): Promise<Monitor[]>;
  saveMonitor(monitor: Monitor): Promise<void>;
  removeMonitor(id: string): Promise<void>;
  /** 新しい順 */
  listEvents(): Promise<StatusEvent[]>;
  addEvent(event: StatusEvent): Promise<void>;
}

export interface RepoSnapshot {
  monitors: Monitor[];
  events: StatusEvent[];
}

/** メモリ上の実装。onChange を渡すと変更のたびに中身を渡す(localStorage 保存用) */
export class MemoryRepo implements MonitorRepo {
  private data: RepoSnapshot;
  private onChange?: (snapshot: RepoSnapshot) => void;

  constructor(initial?: RepoSnapshot, onChange?: (snapshot: RepoSnapshot) => void) {
    this.data = initial ?? { monitors: [], events: [] };
    this.onChange = onChange;
  }

  async listMonitors() {
    return [...this.data.monitors];
  }

  async saveMonitor(monitor: Monitor) {
    const i = this.data.monitors.findIndex((m) => m.id === monitor.id);
    const monitors = [...this.data.monitors];
    if (i >= 0) monitors[i] = monitor;
    else monitors.push(monitor);
    this.update({ ...this.data, monitors });
  }

  async removeMonitor(id: string) {
    this.update({ ...this.data, monitors: this.data.monitors.filter((m) => m.id !== id) });
  }

  async listEvents() {
    return [...this.data.events];
  }

  async addEvent(event: StatusEvent) {
    this.update({ ...this.data, events: [event, ...this.data.events].slice(0, EVENT_LIMIT) });
  }

  private update(next: RepoSnapshot) {
    this.data = next;
    this.onChange?.(next);
  }
}
