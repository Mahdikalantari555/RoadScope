FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-mod-spatialite \
    libgeos-c1v5 \
    libproj-dev \
    proj-data \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY migrations /workspace/migrations
COPY backend/requirements.txt /workspace/backend/requirements.txt
RUN pip install --no-cache-dir -r /workspace/backend/requirements.txt

COPY backend /workspace/backend
WORKDIR /workspace/backend

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
