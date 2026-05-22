FROM node:22-alpine
WORKDIR /app
COPY frontend ./frontend
EXPOSE 3000
CMD ["sh", "-c", "cd /app/frontend && node node_modules/next/dist/bin/next start"]
