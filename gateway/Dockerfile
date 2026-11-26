FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src/ ./src/
USER node
ENV NODE_ENV=production
ENV GATEWAY_HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "src/index.ts"]
