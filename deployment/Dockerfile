FROM node:24.18.1-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY config ./config
COPY deployment/*.ts ./deployment/
USER node
ENV NODE_ENV=production
EXPOSE 3214
# Persistent /var/lib/vice-wire volume permissions and env must be configured by the owner.
CMD ["node", "deployment/foundation-entry.ts"]
