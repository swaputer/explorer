FROM golang:1.25-alpine AS build

WORKDIR /src/services/svm-indexer
COPY services/svm-indexer/go.mod services/svm-indexer/go.sum ./
RUN go mod download
COPY services/svm-indexer/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/svm-indexer ./cmd/server \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/svm-indexer-admin ./cmd/admin

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -S -g 10001 swaputer \
 && adduser -S -D -H -u 10001 -G swaputer swaputer
COPY --from=build /out/svm-indexer /usr/local/bin/svm-indexer
COPY --from=build /out/svm-indexer-admin /usr/local/bin/svm-indexer-admin
COPY deployments/active/base-sepolia.json /app/deployments/active/base-sepolia.json

ENV SVM_DEPLOYMENT_MANIFEST=/app/deployments/active/base-sepolia.json \
    SVM_HTTP_ADDR=0.0.0.0:8080
USER swaputer
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=90s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/readyz || exit 1
ENTRYPOINT ["/usr/local/bin/svm-indexer"]
