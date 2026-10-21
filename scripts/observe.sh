#!/usr/bin/env bash
#
# bootstrap-observability.sh
#
# Bootstraps the local observability stack with minimal manual setup.
# Checks for Docker prerequisites, port conflicts, directories, spins up
# the containers under the monitoring profile, and runs health verification.
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_status() {
  echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
  echo -e "${RED}✗${NC} $1"
}

print_info() {
  echo -e "${CYAN}ℹ${NC} $1"
}

# Resolve script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/deployment/docker-compose.yml"

cd "$PROJECT_ROOT"

echo "=========================================================="
echo "🌟 Local Observability Stack Bootstrap Tool"
echo "=========================================================="

# 1. Check prerequisites
print_info "Validating prerequisites..."
if ! command -v docker &> /dev/null; then
  print_error "Docker is not installed. Please install Docker first."
  exit 1
fi

if ! docker info &> /dev/null; then
  print_error "Docker daemon is not running. Please start Docker."
  exit 1
fi
print_status "Docker is running."

# 2. Check port collisions
is_port_in_use() {
  local port=$1
  if command -v nc &> /dev/null; then
    nc -z -w 1 127.0.0.1 "$port" &>/dev/null
    return $?
  elif command -v lsof &> /dev/null; then
    lsof -i :"$port" -sTCP:LISTEN -t &>/dev/null
    return $?
  else
    # Fallback bash socket check
    (exec 3<>/dev/tcp/127.0.0.1/"$port") &>/dev/null
    local rc=$?
    exec 3>&- 2>/dev/null
    return $rc
  fi
}

print_info "Checking port availability..."
PORTS=(3000 3001 3003 9090 9093 3100 9115 6379 5432)
SERVICES=("Frontend" "Backend API" "Grafana" "Prometheus" "Alertmanager" "Loki" "Blackbox Exporter" "Redis" "Postgres")
COLLISION=false

# Check if the stack is already running
STACK_RUNNING=false
if docker compose -f "$COMPOSE_FILE" --profile monitoring ps -q &>/dev/null; then
  if [ -n "$(docker compose -f "$COMPOSE_FILE" --profile monitoring ps -q)" ]; then
    STACK_RUNNING=true
  fi
fi

for i in "${!PORTS[@]}"; do
  PORT="${PORTS[$i]}"
  SERVICE="${SERVICES[$i]}"
  if is_port_in_use "$PORT"; then
    if [ "$STACK_RUNNING" = "true" ]; then
      print_warning "Port $PORT ($SERVICE) is in use (expected, compose stack is already active)."
    else
      print_error "Port $PORT ($SERVICE) is already in use by another process!"
      COLLISION=true
    fi
  fi
done

if [ "$COLLISION" = "true" ]; then
  print_error "Port collisions detected. Please free up the ports or stop conflicting services."
  exit 1
fi
print_status "Ports verified."

# 3. Ensure logs directory exists
print_info "Ensuring log directories exist..."
mkdir -p "$PROJECT_ROOT/deployment/logs"
print_status "Log directories prepared."

# 4. Boot stack
print_info "Booting observability stack via docker compose..."
docker compose -f "$COMPOSE_FILE" --profile monitoring up --build -d

# 5. Poll endpoints
poll_endpoint() {
  local url=$1
  local expected_regex=$2
  local service_name=$3
  local max_attempts=30
  local delay=2

  echo -n -e "  ⏳ Waiting for ${CYAN}$service_name${NC}..."
  for _ in $(seq 1 $max_attempts); do
    local status
    status=$(curl -sS -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [[ "$status" =~ $expected_regex ]]; then
      echo -e " ${GREEN}OK${NC} ($status)"
      return 0
    fi
    echo -n "."
    sleep $delay
  done
  echo -e " ${RED}FAILED${NC} (timeout, last status: $status)"
  return 1
}

print_info "Polling stack services for health status..."
EXIT_CODE=0

poll_endpoint "http://localhost:3000" "^(200|301|302|304)$" "frontend" || EXIT_CODE=1
poll_endpoint "http://localhost:3001/ready" "^200$" "backend" || EXIT_CODE=1
poll_endpoint "http://localhost:9090/-/healthy" "^200$" "prometheus" || EXIT_CODE=1
poll_endpoint "http://localhost:9093/-/healthy" "^200$" "alertmanager" || EXIT_CODE=1
poll_endpoint "http://localhost:3003/api/health" "^200$" "grafana" || EXIT_CODE=1
poll_endpoint "http://localhost:3100/ready" "^200$" "loki" || EXIT_CODE=1
poll_endpoint "http://localhost:9115/" "^200$" "blackbox-exporter" || EXIT_CODE=1

if [ $EXIT_CODE -ne 0 ]; then
  print_error "One or more services failed to boot successfully."
  echo "----------------------------------------------------------"
  echo "Dumping container logs for troubleshooting:"
  docker compose -f "$COMPOSE_FILE" --profile monitoring logs --tail=30
  echo "----------------------------------------------------------"
  exit 1
fi
print_status "All stack services are healthy!"

# 6. Run health-smoke.sh
print_info "Running operational smoke tests..."
if bash "$SCRIPT_DIR/health-smoke.sh" local; then
  print_status "Operational smoke tests passed!"
else
  print_error "Operational smoke tests failed."
  exit 1
fi

echo "=========================================================="
print_status "Observability stack successfully booted! 🚀"
echo "=========================================================="
echo -e "Services are available at the following endpoints:"
echo -e "  - Frontend:           ${CYAN}http://localhost:3000${NC}"
echo -e "  - Backend API:        ${CYAN}http://localhost:3001${NC}"
echo -e "  - Prometheus:         ${CYAN}http://localhost:9090${NC}"
echo -e "  - Grafana:            ${CYAN}http://localhost:3003${NC} (admin/admin)"
echo -e "  - Alertmanager:       ${CYAN}http://localhost:9093${NC}"
echo -e "  - Loki logs:          ${CYAN}http://localhost:3100${NC}"
echo -e "  - Blackbox Exporter:  ${CYAN}http://localhost:9115${NC}"
echo "=========================================================="
echo "To shut down the stack, run:"
echo "  npm run observability:down"
echo "=========================================================="
