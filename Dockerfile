FROM node:20-alpine
WORKDIR /app
COPY package.json server.mjs models.example.json ./
COPY public ./public/
RUN mkdir -p /data
ENV NODE_ENV=production
ENV GATEWAY_HTTP_ONLY=1
ENV GATEWAY_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server.mjs"]
