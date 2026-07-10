# syntax=docker/dockerfile:1

FROM node:24-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
WORKDIR /app

COPY backend/ /app/backend/
RUN pip install --no-cache-dir /app/backend

COPY --from=frontend-builder /frontend/dist /app/backend/app/static

COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
VOLUME ["/data"]

CMD ["/app/entrypoint.sh"]
