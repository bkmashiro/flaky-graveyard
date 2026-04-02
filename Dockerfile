FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --prod --frozen-lockfile
COPY dist/ ./dist/
EXPOSE 3000
CMD ["node", "dist/server.js"]
