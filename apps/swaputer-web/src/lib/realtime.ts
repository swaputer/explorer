type SocketEvent = { data?: unknown };
type SocketListener = (event: SocketEvent) => void;

interface RealtimeSocket {
  addEventListener(type: "open" | "close" | "error" | "message", listener: SocketListener): void;
  close(): void;
}

interface RealtimeOptions {
  origin?: string;
  createSocket?: (url: string) => RealtimeSocket;
  schedule?: (callback: () => void, delay: number) => number;
  cancelSchedule?: (handle: number) => void;
  minimumDelay?: number;
  maximumDelay?: number;
}

export function explorerWebSocketURL(apiBase: string, origin: string): string {
  const url = new URL(apiBase, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function subscribeExplorerRealtime(
  apiBase: string,
  onEvent: () => void,
  options: RealtimeOptions = {}
): () => void {
  const origin = options.origin ?? window.location.origin;
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const schedule = options.schedule ?? ((callback, delay) => window.setTimeout(callback, delay));
  const cancelSchedule = options.cancelSchedule ?? ((handle) => window.clearTimeout(handle));
  const minimumDelay = options.minimumDelay ?? 1_000;
  const maximumDelay = options.maximumDelay ?? 30_000;
  const url = explorerWebSocketURL(apiBase, origin);

  let stopped = false;
  let attempts = 0;
  let socket: RealtimeSocket | undefined;
  let reconnectTimer: number | undefined;

  const connect = () => {
    if (stopped) return;
    socket = createSocket(url);
    socket.addEventListener("open", () => { attempts = 0; });
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as { type?: string };
        if (payload.type === "svm.executions") onEvent();
      } catch { /* ignore malformed realtime messages */ }
    });
    socket.addEventListener("error", () => socket?.close());
    socket.addEventListener("close", () => {
      socket = undefined;
      if (stopped) return;
      const delay = Math.min(minimumDelay * (2 ** attempts), maximumDelay);
      attempts += 1;
      reconnectTimer = schedule(connect, delay);
    });
  };

  connect();
  return () => {
    stopped = true;
    if (reconnectTimer !== undefined) cancelSchedule(reconnectTimer);
    socket?.close();
  };
}
