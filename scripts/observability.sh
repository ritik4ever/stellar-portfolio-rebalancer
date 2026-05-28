#!/bin/bash
set -euo pipefail

# One-command local observability bootstrap
# Starts Prometheus, Grafana, and other monitoring tools

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.observability.yml"

echo "🔭 Starting observability stack..."

# Check if docker compose is available
if ! command -v docker &> /dev/null; then
  echo "❌ Docker is not installed"
  exit 1
fi

# Create the observability compose file if it doesn't exist
if [ ! -f "$COMPOSE_FILE" ]; then
  cat > "$COMPOSE_FILE" << 'COMPOSEEOF'
version: "3.8"
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_INSTALL_PLUGINS=
COMPOSEEOF
fi

# Create basic prometheus config
if [ ! -f "$PROJECT_DIR/prometheus.yml" ]; then
  cat > "$PROJECT_DIR/prometheus.yml" << 'PROMEOF'
global:
  scrape_interval: 15s
scrape_configs:
  - job_name: "backend"
    static_configs:
      - targets: ["localhost:3000"]
PROMEOF
fi

echo "  ✓ Prometheus config ready"
echo "  ✓ Docker Compose file ready"

docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "✅ Observability stack is running!"
echo "   Prometheus: http://localhost:9090"
echo "   Grafana:    http://localhost:3001 (admin/admin)"
