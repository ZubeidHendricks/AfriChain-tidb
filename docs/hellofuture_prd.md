# 📘 Product Requirements Document (PRD)

## 🧠 Project Title: **Counterfeit Guardians: Trust-Layer AI for Global Product Authenticity**

## 🎯 Goal
Build a cross-chain, AI-powered, multi-agent system that autonomously verifies product authenticity across global e-commerce platforms, leveraging TiDB vector search, Hedera HCS/HTS for on-chain verification, and Internet Computer Protocol (ICP) for decentralized backend logic.

---

## 👥 Target Users
- E-commerce platforms and marketplaces
- Global brands and product vendors
- Regulatory bodies and anti-counterfeit organizations
- Compliance officers
- End consumers (via mobile app or scan feature)

---

## 🌐 Core Features

### 🧩 Agentic Architecture
- Modular multi-agent system (LangChain) for ingest → detect → explain → act
- Autonomous product validation workflows

### 📦 Product Ingestion & Matching
- Vector embeddings (CLIP, text) stored in TiDB Serverless
- Semantic similarity search for known product matches

### 🕵️ Authenticity Detection
- LLM-powered scoring & reasoning
- Rule engine for multi-factor abuse detection
- Bias detection and performance tracking

### 🚨 Alert & Action System
- Trigger alerts (Slack, email, backend) for low-trust products
- Auto-flagging, suspension, or NFT revocation workflows
- On-chain proof anchoring (HCS) and product tokenization (HTS)

### 📊 Dashboards & Analytics
- Real-time fraud scoring, precision/recall
- Visual flow of agent actions & product history
- Regulatory reporting exports

---

## 🔐 Advanced Web3 Integration

### ✅ Hedera Usage
- **Hedera Consensus Service (HCS)** for tamper-proof audit logs
- **Hedera Token Service (HTS)** for Authenticity NFTs per SKU
- Smart contract fallback for distributed appeals

### ✅ Internet Computer Protocol (ICP)
- Host parts of backend as decentralized compute
- Enable gasless API and low-trust execution logic (e.g., public scoring model)

### ✅ Chain Fusion Indexing
- Aggregate metadata across **EVM, Solana, ICP** chains
- Bridge-aware scoring engine for multi-chain product state
- Enable cross-chain SKU linking and compliance validation

---

## ⚙️ Technical Stack
- TiDB Serverless (vector & structured DB)
- LangChain + Claude/OpenAI
- Hedera HCS/HTS
- ICP backend modules
- Redis for caching
- Docker/Kubernetes
- React Admin UI

---

## ✅ MVP Scope (Hello Future Submission)
- Product ingestion + vector indexing (TiDB)
- Agentic LLM scoring with reasoning
- HCS write for alerts + HTS token minting for valid products
- Admin dashboard (React) with analytics
- Chain Fusion index prototype for SKU correlation

---

## 🚀 Success Metrics
- Precision/Recall ≥ 90% for counterfeit detection
- Audit logs hashed and stored via HCS
- 1000+ product entries processed during demo
- Live agent collaboration demo (3+ steps)
- <3 sec response time for detection pipeline

---

## 🧪 Evaluation Criteria Alignment (Hello Future)
| Judging Category | Our Focus |
|------------------|-----------|
| Technical Implementation | Multi-agent architecture, vector search, LLM, HCS integration |
| Hedera Usage | HTS minting, HCS logs, potential smart contract appeals |
| Innovation & Creativity | Combines zk, vector AI, and chain fusion indexing |
| UX | Real-time admin dashboard + API use case |
| Impact & Utility | Real-world anti-counterfeit + compliance tooling |
| Presentation | Crisp flow diagram, demo video, GitHub README |

---

## 📅 Timeline
- **Week 1**: MVP build, Hedera + TiDB integration
- **Week 2**: Chain Fusion indexing + UI
- **Week 3**: Testing, optimization, demo video & docs

