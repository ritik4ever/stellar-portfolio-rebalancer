# Stellar Portfolio Rebalancer — README (Español)

[![GitHub Repo](https://img.shields.io/badge/repo-Stellar%20Portfolio%20Rebalancer-blue?style=flat-square)](https://github.com/ritik4ever/stellar-portfolio-rebalancer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Nota:** Esta traducción puede estar una versión por detrás del README en inglés. Consulte el [README principal](../README.md) para obtener la información más actualizada.

[English](../README.md) | [Português](README.pt.md) | **Español**

---

## Descripción General

Stellar Portfolio Rebalancer es una **plataforma inteligente de gestión de carteras DeFi** construida sobre la blockchain Stellar que rebalancea automáticamente carteras de criptomonedas utilizando datos de precios en tiempo real de los oráculos Reflector.

Ayuda a los usuarios a mantener una asignación óptima de activos mediante rebalanceo automatizado activado por umbrales de desviación configurables, aprovechando la infraestructura rápida y de bajo costo de Stellar.

---

## Características

- **Rebalanceo Inteligente** – Mantenimiento automático de las asignaciones objetivo basado en disparadores de umbral
- **Soporte Multi-Billetera** – Compatible con Freighter, Rabet, xBull y otras billeteras Stellar
- **Precios en Tiempo Real** – Impulsados por oráculos Reflector con respaldos de API
- **Gestión de Riesgos** – Circuit breakers, límites de concentración, detección de volatilidad
- **Interfaz Profesional** – Interfaz responsiva con visualización de cartera en tiempo real
- **Modo Demo** – Cartera simulada de $10,000 para pruebas
- **Confianza y Transparencia** – La página de inicio resume la arquitectura, controles de riesgo y observabilidad; los documentos legales muestran una versión fija y fecha de vigencia

---

## Hoja de Ruta del Proyecto

Vea hacia dónde se dirige Stellar Portfolio Rebalancer.

| **Ahora** (Sprint Actual)          | **Próximamente** (1-2 meses) | **Más Adelante** (3-6+ meses) |
| :---------------------------------- | :----------------------------- | :------------------------------ |
| Algoritmo de rebalanceo principal   | Panel de control de cartera    | Aplicación móvil                |
| Integración de oráculo Reflector    | Informes históricos            | Estrategias personalizadas      |
| Estabilidad de conexión de billetera| Sistema de notificaciones      | Integración DeFi                |
| Corrección de errores               | Soporte multi-activo           | Optimización fiscal             |

**[Ver hoja de ruta detallada →](ROADMAP.md)**

---

## Arquitectura

```text
stellar-portfolio-rebalancer/
├── contracts/     # Contratos inteligentes Soroban
├── frontend/      # Frontend React + TypeScript
├── backend/       # API Node.js + Express
├── deployment/    # Archivos de despliegue Docker
└── docs/          # Documentación (incluyendo ADRs)
```

### Términos Clave

Los nuevos contribuidores deben leer el glosario antes de profundizar en la configuración o el trabajo con el contrato.

- **Portfolio (Cartera)**: El objeto de asignación gestionado por el usuario, identificado por `portfolio_id`.
- **Target Allocation, Rebalance Threshold y Slippage Tolerance**: Los principales parámetros del contrato para el rebalanceo automatizado.
- **Reflector Oracle**: La fuente de precios que usa el contrato para decidir sobre desviación (drift) y rebalanceo.
- **Cooldown Period y Emergency Stop**: Controles de seguridad integrados para los rebalanceos.

📘 **Acceso al Glosario:** Consulte [docs/GLOSSARY.md](GLOSSARY.md) para el glosario central y enlaces cruzados a la documentación de contrato, API y despliegue.

### Stack Tecnológico

| Capa                | Tecnología                          |
| -------------------- | ------------------------------------ |
| Contratos Inteligentes | Rust + Soroban                     |
| Frontend             | React + TypeScript + Tailwind CSS    |
| Backend              | Node.js + Express + TypeScript       |
| Datos de Precios     | Reflector + CoinGecko API            |

---

## Inicio Rápido

### Requisitos Previos

- Node.js 18+
- Rust + Cargo
- Soroban CLI
- Billetera Stellar (se recomienda Freighter o Rabet)

### Instalación

```bash
# Clonar el repositorio
git clone https://github.com/ritik4ever/stellar-portfolio-rebalancer.git
cd stellar-portfolio-rebalancer

# Frontend
cd frontend
npm install

# Backend
cd ../backend
npm install

# Smart Contracts
cd ../contracts
cargo build
```

### Configuración del Entorno

```bash
# Backend
cp backend/.env.example backend/.env
# Frontend
cp frontend/.env.example frontend/.env
```

> Edite los archivos `.env` con su propia configuración (direcciones de contratos, claves API, etc.)

Referencia completa del entorno del backend: [`docs/ENVIRONMENT.md`](ENVIRONMENT.md)

**Versionado de la API:** El cliente HTTP del frontend apunta a `/api/v1/*` para las rutas de recursos de forma predeterminada (`VITE_API_VERSION=v1` en `frontend/.env.example`). La autenticación JWT sigue usando `/api/auth/*`. Consulte [API.md](API.md) para detalles completos de versionado.

**Ejemplos de Cliente API:** Consulte el ejemplo de cliente API en Python (o el archivo de ejemplos correspondiente) para ver integraciones de referencia.

### Configuración de la Base de Datos

Las migraciones de PostgreSQL están disponibles para entornos configurados con `DATABASE_URL` o las variables `PGHOST` / `PGDATABASE` / `PGUSER`.

```bash
cd backend
npm run db:migrate                 # Aplicar migraciones
npm run db:migrate -- --dry-run    # Previsualizar migraciones
```

**Desarrollo local:** Para el desarrollo local con SQLite, deje las variables de PostgreSQL sin definir y use `DB_PATH` en su lugar. La ruta predeterminada es `backend/data/portfolio.db`. El backend crea el archivo de la base de datos y su directorio padre automáticamente al iniciar. Los clones nuevos no deben incluir archivos `.db`, `.db-wal` o `.db-shm` preconstruidos.

**Siembra de demo:** Los datos de demostración de SQLite solo aparecen cuando la siembra de demo está habilitada mediante `ENABLE_DEMO_DB_SEED` o el Modo Demo. De lo contrario, la base de datos local inicia vacía y se inicializa a partir del esquema y las fuentes de semillas registradas en el repositorio.

### Notificaciones por Correo (Opcional)

Ejemplo de configuración con Gmail:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```

También se admiten otros proveedores como SendGrid, Mailgun y AWS SES.

Prueba de notificaciones:

```bash
curl -X POST http://localhost:3001/api/v1/notifications/subscribe \
  -H "Content-Type: application/json" \
  -d '{"userId": "YOUR_STELLAR_ADDRESS", "eventType": "rebalance"}'
```

### Desarrollo

Inicie los servidores de desarrollo:

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

### Despliegue del Contrato Inteligente

```bash
cd contracts

# Construir el contrato
soroban contract build

# Desplegar en testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
  --source deployer \
  --network testnet

# Inicializar el contrato
soroban contract invoke \
  --id YOUR_CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin YOUR_ADMIN_ADDRESS \
  --reflector_address CDSWUUXGPWDZG76ISK6SUCVPZJMD5YUV66J2FXFXFGDX25XKZJIEITAO
```

Ejemplo de dirección de contrato: `CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I`

Para un checklist completo por entorno (local, testnet, staging, producción), vea [Contract Deployment Checklist](CONTRACT_DEPLOYMENT_CHECKLIST.md).

### Verificación del Hash WASM

Antes de desplegar, puede calcular y auditar el hash SHA-256 canónico del contrato WASM compilado para garantizar la reproducibilidad y la seguridad:

```bash
cd contracts
make hash
```

Este target genera el hash tanto del WASM de release como del WASM optimizado (si está disponible). El mismo cálculo de hash se ejecuta automáticamente en las compilaciones de release/PR para simplificar las auditorías de despliegue.

**Recursos para desarrolladores:**

- Referencia de la interfaz del contrato (funciones, errores, notas de tipos): [contracts/CONTRACT_ABI.md](../contracts/CONTRACT_ABI.md)
- Comandos y ejemplos comunes de invocación de Soroban: [docs/soroban-cookbook.md](soroban-cookbook.md)
- Matriz de compatibilidad y capacidades del frontend (mapeo de degradación): [docs/CONTRACT_CAPABILITY_MATRIX.md](CONTRACT_CAPABILITY_MATRIX.md)

---

## Uso

📸 ¿Nuevo en la plataforma? Consulte nuestro [Recorrido Visual de la Demo](DEMO_WALKTHROUGH.md) con capturas de pantalla paso a paso y explicaciones detalladas.

### Flujo Rápido

1. Conecte su billetera Stellar
2. Cree una cartera y establezca las asignaciones objetivo (la suma debe ser 100%, máximo 10 activos por cartera)
3. Configure los umbrales de rebalanceo (1–50%)
4. Active/desactive el rebalanceo automático
5. Envíe la transacción

**Detección de Volatilidad:** Pausa el rebalanceo durante condiciones de mercado extremas.

**Límites de Concentración:** Evita la sobreasignación a un único activo.

**Circuit Breakers:** Múltiples verificaciones de seguridad antes de ejecutar operaciones.

### Notificaciones

Notificaciones por correo electrónico y webhook para eventos de rebalanceo.

Tipos de evento: rebalanceo, circuit breaker, movimiento de precio, cambios de riesgo.

Configurable por usuario.

---

## Referencia de la API

Canónico: `/api/v1/*`
Legado (obsoleto): `/api/*`

```bash
# Crear cartera
POST /api/v1/portfolio
{
  "userAddress": "DIRECCION_STELLAR",
  "allocations": {"XLM": 40, "USDC": 35, "BTC": 25},
  "threshold": 5
}

# Obtener cartera
GET /api/v1/portfolio/:id

# Ejecutar rebalanceo
POST /api/v1/portfolio/:id/rebalance

# Simulación de rebalanceo (plan de solo lectura, sin escrituras en BD ni llamada al contrato)
POST /api/v1/portfolio/:id/rebalance/dry-run

# Estado del rebalanceo
GET /api/v1/portfolio/:id/rebalance-status
```

Notificaciones:
```bash
# Suscribirse
POST /api/v1/notifications/subscribe
# Obtener preferencias
GET /api/v1/notifications/preferences?userId=DIRECCION_STELLAR
# Cancelar suscripción
DELETE /api/v1/notifications/unsubscribe?userId=DIRECCION_STELLAR
```

Datos de Precios:
```bash
GET /api/v1/prices
GET /api/v1/portfolio/:id/rebalance-plan
```

### Integración con Stellar DEX

Operaciones reales ejecutadas en la testnet de Stellar usando `@stellar/stellar-sdk`.

Ejecución con conciencia de slippage, ejecuciones parciales y reversión (rollback) automatizada.

El historial de rebalanceos registra los resultados y las métricas explícitas de slippage.

---

## Pruebas

```bash
# Frontend
cd frontend && npm test

# Backend
cd backend && npm test

# Smart contracts
cd contracts && cargo test

# Benchmarks de gas de smart contracts
cd contracts && make bench
```

---

## Despliegue con Docker

```bash
docker compose -f deployment/docker-compose.yml config
docker compose -f deployment/docker-compose.yml build frontend backend
docker compose -f deployment/docker-compose.yml up --build -d
```

---

## Contribuir

Consulte **[CONTRIBUTING.md](../CONTRIBUTING.md)** para la guía canónica del contribuidor. Incluye configuración local mínima, servicios opcionales (Redis, PostgreSQL, SMTP), comandos de prueba, generación de documentación de API, expectativas de queue workers y configuración de pruebas E2E del frontend.

Para usuarios de Windows y WSL, consulte la [Guía de Desarrollo Local Windows/WSL](windows-wsl-workflow.md).

**Los PRs deben estar vinculados a una issue** o proporcionar una justificación cuando no exista una issue. Una verificación de CI lo exige.

Pasos rápidos:
1. Haga un fork del repositorio
2. Cree una rama de funcionalidad: `git checkout -b feature/funcionalidad-increible`
3. Siga la configuración en [docs/CONTRIBUTING.md](CONTRIBUTING.md)
4. Asegúrese de que las pruebas pasen: `cd backend && npm test && cd ../frontend && npm test`
5. Abra un Pull Request bien documentado

---

## Solución de Problemas

### Problemas con la Billetera

¿Tiene problemas para conectar su billetera Stellar? Consulte las [Preguntas Frecuentes de Solución de Problemas de Billetera](WALLET_TROUBLESHOOTING.md) para soluciones paso a paso de:

- Errores de "la billetera no está instalada"
- Tiempos de espera y rechazos de conexión
- Fallos en la firma de transacciones
- Discrepancia de red entre la billetera y la aplicación
- Peculiaridades específicas de cada billetera (Freighter, Rabet, xBull)

### Problemas Comunes de Configuración

Consulte CONTRIBUTING.md §10 "Common setup failures" para problemas de backend, base de datos y entorno.

---

## Licencia

Este proyecto está licenciado bajo la [Licencia MIT](https://opensource.org/licenses/MIT).

## Agradecimientos

- Stellar Development Foundation
- Reflector Protocol
- Soroban
- Integraciones de billeteras de la comunidad

Construido con ❤️ para el ecosistema Stellar.
