import assert from "node:assert/strict";
import { test } from "node:test";
import { createMonitor, isPrivateHost, validateTarget } from "./plan.ts";
import type { Monitor } from "./types.ts";

const opts = { allowPrivate: false, id: "id1", now: new Date("2026-10-24T00:00:00.000Z") };

test("URL の検査", () => {
  assert.equal(validateTarget("https://example.com", { allowPrivate: false }), null);
  assert.match(validateTarget("example.com", { allowPrivate: false })!, /形式/);
  assert.match(validateTarget("ftp://example.com", { allowPrivate: false })!, /http/);
  assert.match(validateTarget("https://user:pass@example.com", { allowPrivate: false })!, /パスワード/);
  assert.match(validateTarget("http://localhost:3000", { allowPrivate: false })!, /ローカル/);
  assert.equal(validateTarget("http://localhost:3000", { allowPrivate: true }), null);
});

test("プライベートアドレスの判定", () => {
  for (const h of ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.1", "169.254.169.254", "[::1]", "nas.local"]) {
    assert.equal(isPrivateHost(h), true, h);
  }
  for (const h of ["8.8.8.8", "172.32.0.1", "example.com"]) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

test("プランの上限と間隔の下限", () => {
  const m = createMonitor({ name: "", url: "https://example.com", intervalMin: 5 }, [], "free", opts);
  assert.equal(typeof m, "object");
  assert.equal((m as Monitor).name, "example.com");
  assert.equal((m as Monitor).url, "https://example.com/");

  assert.match(createMonitor({ name: "", url: "https://a.example", intervalMin: 1 }, [], "free", opts) as string, /5 分以上/);
  assert.equal(typeof createMonitor({ name: "", url: "https://a.example", intervalMin: 1 }, [], "pro", opts), "object");

  const three = [1, 2, 3].map((i) => ({ ...(m as Monitor), id: `x${i}`, url: `https://${i}.example/` }));
  assert.match(createMonitor({ name: "", url: "https://b.example", intervalMin: 5 }, three, "free", opts) as string, /3 件まで/);
});

test("同じ URL は重複登録できない", () => {
  const m = createMonitor({ name: "", url: "https://example.com", intervalMin: 5 }, [], "free", opts) as Monitor;
  assert.match(createMonitor({ name: "", url: "https://example.com/", intervalMin: 5 }, [m], "free", opts) as string, /すでに/);
});
