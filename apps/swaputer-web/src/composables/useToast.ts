import { readonly, ref } from "vue";

export type ToastTone = "error" | "success" | "info";

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const items = ref<ToastItem[]>([]);
let nextId = 0;
const timers = new Map<number, number>();

function dismiss(id: number) {
  const timer = timers.get(id);
  if (timer) window.clearTimeout(timer);
  timers.delete(id);
  items.value = items.value.filter((item) => item.id !== id);
}

function show(message: string, tone: ToastTone = "info", duration = tone === "error" ? 6_000 : 4_000) {
  const duplicate = items.value.find((item) => item.message === message && item.tone === tone);
  if (duplicate) dismiss(duplicate.id);
  const id = ++nextId;
  items.value = [...items.value, { id, message, tone }].slice(-4);
  timers.set(id, window.setTimeout(() => dismiss(id), duration));
  return id;
}

export const toast = Object.freeze({
  show,
  info: (message: string) => show(message, "info"),
  success: (message: string) => show(message, "success"),
  error: (message: string) => show(message, "error")
});

export function useToast() {
  return { items: readonly(items), dismiss };
}
