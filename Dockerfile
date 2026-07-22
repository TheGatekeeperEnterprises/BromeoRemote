FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY website/package*.json ./
RUN npm ci --omit=dev

COPY website/src ./src
COPY website/public ./public

EXPOSE 3000
CMD ["node", "src/server.js"]
