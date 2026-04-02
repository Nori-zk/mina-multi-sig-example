FROM node:18-bookworm AS builder

WORKDIR /build
COPY . .
RUN npm ci
RUN npm run build

FROM gcr.io/distroless/nodejs18-debian12

COPY --from=builder /build/dist /app/dist
COPY --from=builder /build/node_modules /app/node_modules
COPY --from=builder /build/package.json /app/package.json

WORKDIR /app

EXPOSE 3000

CMD ["dist/index.js"]
