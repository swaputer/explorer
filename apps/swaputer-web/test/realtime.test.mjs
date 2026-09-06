import assert from "node:assert/strict";
import test from "node:test";

import { explorerWebSocketURL, subscribeExplorerRealtime } from "../src/lib/realtime.ts";

class FakeSocket {
  listeners = new Map();
  closed = false;

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  close() {
    this.closed = true;
  }
}

test("builds direct and reverse-proxied WebSocket URLs", () => {
  assert.equal(
    explorerWebSocketURL("/api", "https://swaputer.example"),
    "wss://swaputer.example/api/v1/ws"
  );
  assert.equal(
    explorerWebSocketURL("http://127.0.0.1:8080", "https://swaputer.example"),
    "ws://127.0.0.1:8080/v1/ws"
  );
});

test("reconnects with backoff and forwards committed events", () => {
  const sockets = [];
  const timers = [];
  const delays = [];
  let events = 0;
  const stop = subscribeExplorerRealtime("/api", () => { events += 1; }, {
    origin: "http://127.0.0.1:4174",
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    schedule: (callback, delay) => {
      timers.push(callback);
      delays.push(delay);
      return timers.length;
    },
    cancelSchedule: () => {},
    minimumDelay: 100,
    maximumDelay: 400
  });

  assert.equal(sockets.length, 1);
  sockets[0].emit("close");
  assert.deepEqual(delays, [100]);
  timers.shift()();
  assert.equal(sockets.length, 2);

  sockets[1].emit("message", { data: JSON.stringify({ type: "svm.executions" }) });
  sockets[1].emit("message", { data: JSON.stringify({ type: "system.connected" }) });
  assert.equal(events, 1);

  sockets[1].emit("open");
  sockets[1].emit("close");
  assert.deepEqual(delays, [100, 100]);
  timers.shift()();
  assert.equal(sockets.length, 3);
  stop();
  assert.equal(sockets[2].closed, true);
});
