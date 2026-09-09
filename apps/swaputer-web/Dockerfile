FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build

WORKDIR /workspace
COPY apps/swaputer-web/package.json apps/swaputer-web/package-lock.json ./apps/swaputer-web/
ARG WEB_NPM_REGISTRY=https://registry.npmjs.org
RUN npm ci --prefix apps/swaputer-web \
    --registry="$WEB_NPM_REGISTRY" \
    --replace-registry-host=always \
    --fetch-retries=5
COPY apps/swaputer-web/ ./apps/swaputer-web/

ARG VITE_SVM_API_URL=/api
ARG VITE_DOCS_URL=https://docs.swaputer.xyz
ARG VITE_STUDIO_URL=https://studio.swaputer.xyz
ENV VITE_SVM_API_URL=$VITE_SVM_API_URL \
    VITE_DOCS_URL=$VITE_DOCS_URL \
    VITE_STUDIO_URL=$VITE_STUDIO_URL
RUN npm run build --prefix apps/swaputer-web

FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:442753882674b49ae2c1de83ed67896131c0777f56df5005e356e62bc3f7e7ce
COPY infra/testnet/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/swaputer-web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
