import assert from "node:assert/strict";
import test from "node:test";
import { useCursorTable } from "../src/composables/useCursorTable.ts";

test("uses server cursors and keeps the current page during realtime refresh", async () => {
  const calls = [];
  const table = useCursorTable(async cursor => {
    calls.push(cursor);
    return { items: [cursor ?? "first"], nextCursor: cursor ? undefined : "page-two" };
  }, assert.fail);
  await table.load();
  await table.next();
  await table.load();
  assert.equal(table.page, 2);
  assert.deepEqual(calls, [undefined, "page-two", "page-two"]);
  assert.equal(table.nextCursor, undefined);
  assert.equal(table.page > 1 || Boolean(table.nextCursor), true, "last page retains backward navigation");
  await table.previous();
  assert.equal(table.page, 1);
});

test("single and empty pages need no pagination", async () => {
  for (const items of [[], ["one"]]) {
    const table = useCursorTable(async () => ({ items }), assert.fail);
    await table.load();
    assert.equal(table.page > 1 || Boolean(table.nextCursor), false);
  }
});

test("failed navigation retains the previous page and allows retry", async () => {
  let fail = true;
  const errors = [];
  const table = useCursorTable(async cursor => {
    if (cursor && fail) throw new Error("Offline");
    return { items: [cursor ?? "first"], nextCursor: cursor ? undefined : "next" };
  }, e => errors.push(e.message));
  await table.load();
  await table.next();
  assert.equal(table.page, 1);
  assert.deepEqual(table.items, ["first"]);
  assert.deepEqual(errors, ["Offline"]);
  fail = false;
  await table.next();
  assert.equal(table.page, 2);
});

test("reset invalidates slow results from a previous side, route or wallet", async () => {
  let resolve;
  let old = true;
  const table = useCursorTable(() => old ? new Promise(r => { resolve = r; }) : Promise.resolve({ items: ["new"] }), assert.fail);
  const pending = table.load();
  table.reset();
  old = false;
  await table.load();
  resolve({ items: ["stale"], nextCursor: "stale-cursor" });
  await pending;
  assert.deepEqual(table.items, ["new"]);
  assert.equal(table.nextCursor, undefined);
  assert.equal(table.loading, false);
});

test("concurrent refreshes cannot duplicate requests or jump pages", async () => {
  let resolve;
  let calls = 0;
  const table = useCursorTable(() => { calls++; return new Promise(r => { resolve = r; }); }, assert.fail);
  const pending = table.load();
  await table.load();
  await table.next();
  assert.equal(calls, 1);
  resolve({ items: [], nextCursor: "next" });
  await pending;
  assert.equal(table.page, 1);
});
