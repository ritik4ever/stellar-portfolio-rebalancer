#!/bin/bash
# Health smoke test for production
ENDPOINTS=("https://api.example.com/health" "https://api.example.com/ready")
for url in "${ENDPOINTS[@]}"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  if [ "$status" = "200" ]; then echo "✅ $url"; else echo "❌ $url ($status)"; fi
done
