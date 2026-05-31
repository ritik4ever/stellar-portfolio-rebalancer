# Blackbox Probes

## Probes
- Frontend: GET / → 200
- API: GET /api/health → 200
- WebSocket: ws://host/ws → connected
- Docs: GET /docs → 200

## AlertManager routing
```yaml
routes:
- match:
    severity: critical
  receiver: pager
- match:
    severity: warning
  receiver: email
```
