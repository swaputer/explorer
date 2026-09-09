FROM golang:1.25-alpine@sha256:1ae0735f00daffa3aaf1363a5184c0d2dc55c78e3db4ec70241cdac97bf84b59 AS build

WORKDIR /src/services/svm-indexer
COPY services/svm-indexer/go.mod services/svm-indexer/go.sum ./
RUN go mod download
COPY services/svm-indexer/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/svm-indexer ./cmd/server \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/svm-indexer-admin ./cmd/admin

FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce

RUN apk add --no-cache \
      'libcrypto3>=3.5.8-r0' \
      'libssl3>=3.5.8-r0' \
      ca-certificates \
      tzdata \
 && addgroup -S -g 10001 swaputer \
 && adduser -S -D -H -u 10001 -G swaputer swaputer
COPY --from=build /out/svm-indexer /usr/local/bin/svm-indexer
COPY --from=build /out/svm-indexer-admin /usr/local/bin/svm-indexer-admin

ENV SVM_HTTP_ADDR=0.0.0.0:8080
USER swaputer
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=90s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/readyz || exit 1
ENTRYPOINT ["/usr/local/bin/svm-indexer"]
