# 📘 Product Requirements Document (PRD)

## 🏷️ Project Title
**VeriChainX: Counterfeit Detection and Brand Protection on Hedera**

## 🧠 Problem Statement
E-commerce platforms are overwhelmed by counterfeit goods. Manual inspection is infeasible, and current rule-based or centralized systems are easily bypassed. Brands lack visibility into their supply chains, while consumers can’t reliably verify product authenticity.

## 🎯 Objective
Build a scalable, multi-agentic AI system on **Hedera Hashgraph** and **Internet Computer Protocol (ICP)** that detects, scores, and flags counterfeit products using AI, LLMs, vector embeddings, and zkSNARK cryptographic verification.

## 💡 Key Features
- Multi-agent architecture with smart delegation (LLM + rule-based hybrid)
- Semantic vector search for product similarity via TiDB or ICP-based vector store
- LLM-powered fraud analysis for textual/image anomalies
- zkSNARK-based cryptographic proof-of-origin
- Immutable audit trails via **Hedera Consensus Service (HCS)**
- Tokenized authenticity NFTs via **Hedera Token Service (HTS)**
- Live analytics and admin dashboard for monitoring and rule configuration
- Multi-chain interoperability with **Chain Fusion indexing (EVM/SOL/ICP)**
- Alerts and action system with integrations (Slack, Email, On-chain flags)
- Optional mobile app for field verification via QR and NFT scan

## 🛠️ Tech Stack
- **Backend:** Internet Computer Protocol (ICP), FastAPI, Redis, Docker
- **Blockchain:** Hedera Hashgraph (HCS, HTS, Smart Contracts)
- **AI/LLM:** OpenAI, Bedrock (optional fallback), LangChain Agents
- **Vector Search:** TiDB Vector DB or ICP-native KV + embeddings
- **Cryptography:** zkSNARKs (SnarkJS, Circom)
- **Frontend:** React + Tailwind (admin dashboard), React Native (mobile)
- **DevOps:** Docker Compose / Kubernetes, GitHub Actions, Alembic

## 📊 Core User Stories

### Story 1.1: As a Vendor
I want to upload new product listings with metadata and images so that the system can verify authenticity automatically.

### Story 2.1: As a Fraud Analyst
I want to view flagged products, see rule matches and AI explanations, so I can understand the root cause and decide follow-up actions.

### Story 3.1: As a Compliance Officer
I want an immutable audit trail of product flags and decisions so that I can submit reports to regulators.

### Story 4.1: As a Brand Owner
I want to register my original products and cryptographic proof-of-origin, so the system can verify against fakes.

### Story 5.1: As a Consumer
I want to scan a QR code and get a real-time authenticity score and proof from the blockchain.

## 🧩 Functional Components

| Component | Description |
|----------|-------------|
| `Ingest Agent` | Accepts product metadata, images, supplier ID. Embeds unstructured fields. |
| `Similarity Agent` | Uses vector DB to find nearest neighbors and infer originality. |
| `LLM Analyzer Agent` | Classifies text/images as suspicious with score and explanation. |
| `Rule-Based Scoring` | Applies dynamic rules (e.g., reused SKUs, supplier mismatches) |
| `zkVerifier` | Validates cryptographic product proofs (origin metadata). |
| `HederaLogger` | Sends audit logs via HCS, stores state hash. |
| `NFTMintService` | Mints or updates authenticity NFTs on HTS. |
| `AlertAgent` | Sends real-time alerts or takes action on e-commerce backend. |
| `Admin Dashboard` | Rule editor, monitoring, KPIs, fraud map. |

## 🔐 Enterprise Features
- Proof-of-origin NFTs stored in HTS (unique per verified product)
- zkSNARK watermark verifier for sensitive brand metadata
- Immutable audit trail anchored to HCS
- Rule editor with CI/CD for rule propagation
- GDPR-compliant, zero-knowledge privacy design

## 🔍 Success Metrics
| KPI | Target |
|-----|--------|
| False Positive Rate | < 5% |
| Verification Latency | < 2 sec |
| Vendor Registration Time | < 3 min |
| Audit Log Hash Sync | 100% coverage |
| Consumer Trust Score Feedback | > 90% approval |

## 📦 Submission Deliverables (by Aug 6 for checkpoint)
- ✅ GitHub repo with code, tests, and documentation
- ✅ README with full run instructions
- ✅ Demo video (< 4 min) uploaded to YouTube
- ✅ PDF Pitch Deck
- ✅ Live demo (Hedera testnet + frontend)
- ✅ Proof of on-chain activity via HashScan

## 🔭 Future Roadmap
- Expand to Shopify, WooCommerce, and marketplaces via plugin
- Partner with logistics for packaging-level scanning
- Build multi-tenant SaaS layer for B2B resale
- Integrate with customs/law enforcement verification APIs
- Launch Decentralized Brand Registry DAO on Hedera

## 🏆 Hackathon Track Alignment
- ✅ **AI and Agents Track** (Main)
- ✅ **Dev Experience Track** (Optional: Docs + Video Tutorials)

## 📅 Timeline
- **Aug 3:** Core MVP agents + UI
- **Aug 4:** Blockchain integrations + HCS logging
- **Aug 5:** zkSNARK + NFT Mint
- **Aug 6:** Submit for checkpoint ($100 reward)
- **Aug 7:** Polish demo video + mobile
- **Aug 8:** Final submission

---
Ready to export to GitHub or mirror to DoraHacks workspace?

