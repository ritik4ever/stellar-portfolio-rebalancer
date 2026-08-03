# Stellar Portfolio Rebalancer — README (Português)

[![GitHub Repo](https://img.shields.io/badge/repo-Stellar%20Portfolio%20Rebalancer-blue?style=flat-square)](https://github.com/ritik4ever/stellar-portfolio-rebalancer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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

## Roteiro do Projeto

Veja para onde o Stellar Portfolio Rebalancer está caminhando.

| **Agora** (Sprint Atual)             | **A seguir** (1-2 meses)   | **Mais adiante** (3-6+ meses) |
| :------------------------------------ | :--------------------------- | :------------------------------ |
| Algoritmo de rebalanceamento principal| Painel de portfólio           | Aplicativo móvel                |
| Integração com o oráculo Reflector    | Relatórios históricos         | Estratégias personalizadas      |
| Estabilidade da conexão de carteira   | Sistema de notificações       | Integração DeFi                 |
| Correção de bugs                      | Suporte a múltiplos ativos    | Otimização fiscal               |

**[Ver roteiro detalhado →](ROADMAP.md)**

---

## Arquitetura

```text
stellar-portfolio-rebalancer/
├── contracts/     # Contratos inteligentes Soroban
├── frontend/      # Frontend React + TypeScript
├── backend/       # API Node.js + Express
├── deployment/    # Arquivos de implantação Docker
└── docs/          # Documentação (incluindo ADRs)
```

### Termos Fundamentais

Novos contribuidores devem ler o glossário antes de aprofundar na configuração ou no trabalho com o contrato.

- **Portfolio**: O objeto de alocação gerenciado pelo usuário, rastreado por `portfolio_id`.
- **Target Allocation, Rebalance Threshold e Slippage Tolerance**: Os principais parâmetros do contrato para o rebalanceamento automatizado.
- **Reflector Oracle**: A fonte de preços usada pelo contrato para decisões de deriva (drift) e rebalanceamento.
- **Cooldown Period e Emergency Stop**: Controles de segurança integrados para os rebalanceamentos.

📘 **Acesso ao Glossário:** Veja [docs/GLOSSARY.md](GLOSSARY.md) para o glossário central e links cruzados para a documentação de contrato, API e implantação.

### Stack Tecnológica

| Camada                  | Tecnologia                          |
| ------------------------ | ------------------------------------ |
| Contratos Inteligentes   | Rust + Soroban                       |
| Frontend                 | React + TypeScript + Tailwind CSS    |
| Backend                  | Node.js + Express + TypeScript       |
| Dados de Preço           | Reflector + CoinGecko API            |

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

**Versionamento da API:** O cliente HTTP do frontend aponta para `/api/v1/*` nas rotas de recursos por padrão (`VITE_API_VERSION=v1` em `frontend/.env.example`). A autenticação JWT ainda usa `/api/auth/*`. Veja [API.md](API.md) para detalhes completos de versionamento.

**Exemplos de Cliente da API:** Confira o exemplo de cliente da API em Python (ou o arquivo de exemplos correspondente) para integrações de referência.

### Configuração do Banco de Dados

Migrações do PostgreSQL estão disponíveis para ambientes configurados com `DATABASE_URL` ou as variáveis `PGHOST` / `PGDATABASE` / `PGUSER`.

```bash
cd backend
npm run db:migrate                 # Aplicar migrações
npm run db:migrate -- --dry-run    # Pré-visualizar migrações
```

**Desenvolvimento local:** Para desenvolvimento local com SQLite, deixe as variáveis do PostgreSQL sem definir e use `DB_PATH` em vez disso. O caminho padrão é `backend/data/portfolio.db`. O backend cria o arquivo do banco de dados e seu diretório pai automaticamente na inicialização. Clones novos não devem incluir arquivos `.db`, `.db-wal` ou `.db-shm` pré-construídos.

**Seed de demo:** Os dados de demonstração do SQLite só aparecem quando o seed de demo está habilitado via `ENABLE_DEMO_DB_SEED` ou pelo Modo Demo. Caso contrário, o banco de dados local inicia vazio e é inicializado a partir do esquema e das fontes de seed registradas no repositório.

### Notificações por E-mail (Opcional)

Exemplo de configuração com Gmail:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```

Outros provedores suportados incluem SendGrid, Mailgun e AWS SES.

Testar notificações:

```bash
curl -X POST http://localhost:3001/api/v1/notifications/subscribe \
  -H "Content-Type: application/json" \
  -d '{"userId": "YOUR_STELLAR_ADDRESS", "eventType": "rebalance"}'
```

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

### Implantação do Smart Contract

```bash
cd contracts

# Construir o contrato
soroban contract build

# Implantar na testnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/portfolio_rebalancer.wasm \
  --source deployer \
  --network testnet

# Inicializar o contrato
soroban contract invoke \
  --id YOUR_CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin YOUR_ADMIN_ADDRESS \
  --reflector_address CDSWUUXGPWDZG76ISK6SUCVPZJMD5YUV66J2FXFXFGDX25XKZJIEITAO
```

Exemplo de endereço de contrato: `CCQ4LISQJFTZJKQDRJHRLXQ2UML45GVXUECN5NGSQKAT55JKAK2JAX7I`

Para um checklist completo por ambiente (local, testnet, staging, produção), veja o [Contract Deployment Checklist](CONTRACT_DEPLOYMENT_CHECKLIST.md).

### Verificação do Hash WASM

Antes de implantar, você pode calcular e auditar o hash SHA-256 canônico do contrato WASM compilado para garantir reprodutibilidade e segurança:

```bash
cd contracts
make hash
```

Esse target gera o hash tanto do WASM de release quanto do WASM otimizado (se disponível). O mesmo cálculo de hash roda automaticamente nas builds de release/PR para simplificar as auditorias de implantação.

**Recursos para Desenvolvedores:**

- Referência da interface do contrato (funções, erros, notas de tipos): [contracts/CONTRACT_ABI.md](../contracts/CONTRACT_ABI.md)
- Comandos e exemplos comuns de invocação do Soroban: [docs/soroban-cookbook.md](soroban-cookbook.md)
- Matriz de compatibilidade e capacidades do frontend (mapeamento de degradação): [docs/CONTRACT_CAPABILITY_MATRIX.md](CONTRACT_CAPABILITY_MATRIX.md)

---

## Uso

📸 Novo na plataforma? Confira nosso [Tour Visual da Demo](DEMO_WALKTHROUGH.md) com capturas de tela passo a passo e explicações detalhadas.

### Fluxo Rápido

1. Conecte sua carteira Stellar
2. Crie um portfólio e defina as alocações alvo (soma deve ser 100%, máximo de 10 ativos por portfólio)
3. Configure os limites de rebalanceamento (1–50%)
4. Ative/desative o rebalanceamento automático
5. Envie a transação

**Detecção de Volatilidade:** Pausa o rebalanceamento durante condições extremas de mercado.

**Limites de Concentração:** Evita a super-alocação em um único ativo.

**Circuit Breakers:** Múltiplas verificações de segurança antes de executar operações.

### Notificações

Notificações por e-mail e webhook para eventos de rebalanceamento.

Tipos de evento: rebalanceamento, circuit breaker, movimento de preço, mudanças de risco.

Configurável por usuário.

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

# Simulação de rebalanceamento (plano somente leitura, sem gravações no BD ou chamada ao contrato)
POST /api/v1/portfolio/:id/rebalance/dry-run

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

### Integração com a Stellar DEX

Negociações reais executadas na testnet da Stellar usando `@stellar/stellar-sdk`.

Execução com consciência de slippage, execuções parciais e tratamento automatizado de rollback.

O histórico de rebalanceamento registra os resultados e as métricas explícitas de slippage.

---

## Testes

```bash
# Testes de frontend
cd frontend && npm test

# Testes de backend
cd backend && npm test

# Testes de smart contract
cd contracts && cargo test

# Benchmarks de gás do smart contract
cd contracts && make bench
```

---

## Implantação com Docker

```bash
docker compose -f deployment/docker-compose.yml config
docker compose -f deployment/docker-compose.yml build frontend backend
docker compose -f deployment/docker-compose.yml up --build -d
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
5. Abra um Pull Request bem documentado

---

## Solução de Problemas

### Problemas com a Carteira

Está tendo problemas para conectar sua carteira Stellar? Veja o [FAQ de Solução de Problemas de Carteira](WALLET_TROUBLESHOOTING.md) para correções passo a passo de:

- Erros de "carteira não instalada"
- Timeouts e recusas de conexão
- Falhas na assinatura de transações
- Incompatibilidade de rede entre a carteira e o aplicativo
- Peculiaridades específicas de cada carteira (Freighter, Rabet, xBull)

### Problemas Comuns de Configuração

Veja CONTRIBUTING.md §10 "Common setup failures" para problemas de backend, banco de dados e ambiente.

---

## Licença

Este projeto está licenciado sob a [Licença MIT](https://opensource.org/licenses/MIT).

## Agradecimentos

- Stellar Development Foundation
- Reflector Protocol
- Soroban
- Integrações de carteiras da comunidade

Feito com ❤️ para o ecossistema Stellar.
