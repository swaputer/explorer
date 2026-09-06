FROM node:22-alpine AS build

WORKDIR /workspace
COPY tooling/tinysol/package.json tooling/tinysol/package-lock.json ./tooling/tinysol/
RUN npm ci --prefix tooling/tinysol
COPY tooling/tinysol/ ./tooling/tinysol/
COPY docs/spec/SwapVM-ISA-v2.json docs/spec/SwapVM-v1.2-freeze-manifest.json ./docs/spec/
COPY src/SwapVMMiniVM.sol ./src/SwapVMMiniVM.sol
COPY reference/ ./reference/
RUN npm run build --prefix tooling/tinysol

COPY apps/swaputer-web/package.json apps/swaputer-web/package-lock.json ./apps/swaputer-web/
ARG WEB_NPM_REGISTRY=https://registry.npmjs.org
RUN npm ci --prefix apps/swaputer-web \
    --registry="$WEB_NPM_REGISTRY" \
    --replace-registry-host=always \
    --fetch-retries=5
COPY deployments/active/base-sepolia.json ./deployments/active/base-sepolia.json
COPY apps/swaputer-web/ ./apps/swaputer-web/

ARG VITE_RPC_URL
ARG VITE_SVM_API_URL=/api
ARG VITE_DOCS_URL=https://docs.swaputer.xyz
ENV VITE_RPC_URL=$VITE_RPC_URL \
    VITE_SVM_API_URL=$VITE_SVM_API_URL \
    VITE_DOCS_URL=$VITE_DOCS_URL
RUN npm run build --prefix apps/swaputer-web

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY infra/testnet/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/swaputer-web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
