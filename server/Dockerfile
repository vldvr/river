FROM node:24-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY relay.mjs accounts.mjs rating.mjs ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV PORT=8080 DB_FILE=/app/data/river.db NODE_NO_WARNINGS=1
EXPOSE 8080
CMD ["node", "relay.mjs"]
