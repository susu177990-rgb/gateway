FROM node:20-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public/
ENV NODE_ENV=production
ENV GATEWAY_HTTP_ONLY=1
EXPOSE 8080
CMD ["node", "server.mjs"]
