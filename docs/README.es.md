# Stellar Portfolio Rebalancer — README (Español)

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

### Uso

1. Conecte su billetera Stellar
2. Cree una cartera y establezca las asignaciones objetivo (la suma debe ser 100%, máximo 10 activos por cartera)
3. Configure los umbrales de rebalanceo (1–50%)
4. Active/desactive el rebalanceo automático
5. Envíe la transacción

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

---

## Pruebas

```bash
# Frontend
cd frontend && npm test

# Backend
cd backend && npm test

# Smart contracts
cd contracts && cargo test
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
5. Abra un Pull Request

---

## Licencia

Este proyecto está licenciado bajo la [Licencia MIT](https://opensource.org/licenses/MIT).
