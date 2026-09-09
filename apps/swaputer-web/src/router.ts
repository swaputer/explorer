import { createRouter, createWebHistory } from "vue-router";
import ExplorerView from "@/views/ExplorerView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "overview", component: ExplorerView },
    { path: "/transactions", name: "transactions", component: () => import("@/views/TransactionsView.vue") },
    { path: "/contracts", name: "contracts", component: () => import("@/views/ContractsView.vue") },
    { path: "/tx/:hash", name: "transaction-detail", component: () => import("@/views/TransactionDetailView.vue") },
    { path: "/address/:address", name: "address-detail", component: () => import("@/views/AddressDetailView.vue") },
    { path: "/contract/:program", name: "contract-detail", component: () => import("@/views/ContractDetailView.vue") },
    { path: "/tokens", redirect: "/contracts" },
    { path: "/token/:program", redirect: (to) => ({ path: `/contract/${String(to.params.program)}` }) },
    { path: "/src20", redirect: "/contracts" },
    { path: "/src20/:program", redirect: (to) => ({ path: `/contract/${String(to.params.program)}` }) },
    { path: "/docs", name: "docs", component: () => import("@/views/DocsRedirectView.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" }
  ],
  scrollBehavior: () => ({ top: 0 })
});
