import "@fontsource-variable/inter";
import { Buffer } from "buffer";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";
import "./theme-dark.css";

(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

createApp(App).use(router).mount("#app");
