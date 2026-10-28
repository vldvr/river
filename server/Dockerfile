FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY relay.mjs ./
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "relay.mjs"]
