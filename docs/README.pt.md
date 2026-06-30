# Stellar Portfolio Rebalancer — README (Português)

> **Nota:** Esta tradução pode estar uma versão atrás do README em inglês. Consulte o [README principal](../README.md) para as informações mais recentes.

[English](../README.md) | **Português** | [Español](README.es.md)

---

## Visão Geral

Stellar Portfolio Rebalancer é uma **plataforma inteligente de gestão de portfólios DeFi** construída na blockchain Stellar que rebalanceia automaticamente portfólios de criptomoedas usando dados de preço em tempo real dos oráculos Reflector.

Ele ajuda os usuários a manter uma alocação ideal de ativos através de rebalanceamento automatizado acionado por limites de deriva configuráveis, aproveitando a infraestrutura rápida e de baixo custo da Stellar.

---

## Funcionalidades

- **Rebalanceamento Inteligente** – Manutenção automática das alocações alvo baseada em gatilhos de limite
- **Suporte a Múltiplas Carteiras** – Compatível com Freighter, Rabet, xBull e outras carteiras Stellar
- **Preços em Tempo Real** – Alimentados por oráculos Reflector com fallbacks de API
- **Gestão de Risco** – Circuit breakers, limites de concentração, detecção de volatilidade
- **Interface Profissional** – Interface responsiva com visualização de portfólio em tempo real
- **Modo Demo** – Portfólio simulado de $10.000 para testes
- **Confiança e Transparência** – A landing page resume arquitetura, controles de risco e observabilidade; documentos legais mostram versão fixa e data de vigência

---

## Início Rápido

### Pré-requisitos

- Node.js 18+
- Rust + Cargo
- Soroban CLI
- Carteira Stellar (Freighter ou Rabet recomendada)

### Instalação

```bash
# Clonar o repositório
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

### Configuração de Ambiente

```bash
# Backend
cp backend/.env.example backend/.env
# Frontend
cp frontend/.env.example frontend/.env
```

> Edite os arquivos `.env` com sua própria configuração (endereços de contratos, chaves de API, etc.)

Referência completa de ambiente do backend: [`docs/ENVIRONMENT.md`](ENVIRONMENT.md)

### Desenvolvimento

Inicie os servidores de desenvolvimento:

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

1. Conecte sua carteira Stellar
2. Crie um portfólio e defina as alocações alvo (soma deve ser 100%, máximo de 10 ativos por portfólio)
3. Configure os limites de rebalanceamento (1–50%)
4. Ative/desative o rebalanceamento automático
5. Envie a transação

---

## Referência da API

Canônico: `/api/v1/*`
Legado (obsoleto): `/api/*`

```bash
# Criar portfólio
POST /api/v1/portfolio
{
  "userAddress": "ENDERECO_STELLAR",
  "allocations": {"XLM": 40, "USDC": 35, "BTC": 25},
  "threshold": 5
}

# Obter portfólio
GET /api/v1/portfolio/:id

# Executar rebalanceamento
POST /api/v1/portfolio/:id/rebalance

# Status do rebalanceamento
GET /api/v1/portfolio/:id/rebalance-status
```

Notificações:
```bash
# Inscrever-se
POST /api/v1/notifications/subscribe
# Obter preferências
GET /api/v1/notifications/preferences?userId=ENDERECO_STELLAR
# Cancelar inscrição
DELETE /api/v1/notifications/unsubscribe?userId=ENDERECO_STELLAR
```

Dados de Preço:
```bash
GET /api/v1/prices
GET /api/v1/portfolio/:id/rebalance-plan
```

---

## Testes

```bash
# Frontend
cd frontend && npm test

# Backend
cd backend && npm test

# Smart contracts
cd contracts && cargo test
```

---

## Contribuindo

Veja **[CONTRIBUTING.md](../CONTRIBUTING.md)** para o guia canônico do contribuidor. Ele inclui configuração local mínima, serviços opcionais (Redis, PostgreSQL, SMTP), comandos de teste, geração de documentação da API, expectativas de queue workers e configuração de testes E2E do frontend.

Para usuários Windows e WSL, veja o [Guia de Desenvolvimento Local Windows/WSL](windows-wsl-workflow.md).

**PRs devem estar vinculados a uma issue** ou fornecer uma justificativa quando não houver issue. Uma verificação de CI reforça isso.

Passos rápidos:
1. Faça um fork do repositório
2. Crie um branch de funcionalidade: `git checkout -b feature/funcionalidade-incrivel`
3. Siga a configuração em [docs/CONTRIBUTING.md](CONTRIBUTING.md)
4. Garanta que os testes passem: `cd backend && npm test && cd ../frontend && npm test`
5. Abra um Pull Request

---

## Licença

Este projeto está licenciado sob a [Licença MIT](https://opensource.org/licenses/MIT).
