#!/bin/bash
# One-command local observability bootstrap
# Starts Prometheus, Grafana, and Loki for local development

set -e

echo "🚀 Starting observability stack..."
cd "$(dirname "$0")/.."

if [ ! -f docker-compose.observability.yml ]; then
  cat > docker-compose.observability.yml << 'COMPOSE'
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin

  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"
COMPOSE
  fi

docker compose -f docker-compose.observability.yml up -d
echo "✅ Observability stack running:"
echo "   Grafana: http://localhost:3001 (admin/admin)"
echo "   Prometheus: http://localhost:9090"
echo ""
echo "To stop: docker compose -f docker-compose.observability.yml down"
