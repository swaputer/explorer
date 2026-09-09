import "@fontsource-variable/inter";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";
import "./theme-dark.css";

createApp(App).use(router).mount("#app");
