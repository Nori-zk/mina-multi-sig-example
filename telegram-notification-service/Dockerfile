FROM node:24-bookworm AS builder

WORKDIR /build
COPY . .
RUN npm ci
RUN npm run build

FROM node:24-slim

COPY --from=builder /build/dist /app/dist
COPY --from=builder /build/node_modules /app/node_modules
COPY --from=builder /build/package.json /app/package.json

WORKDIR /app

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
