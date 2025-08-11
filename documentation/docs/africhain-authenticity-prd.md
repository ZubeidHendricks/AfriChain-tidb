# 📋 "Made in Africa, Proven On-Chain" - Product Requirements Document

**Version**: 1.0  
**Date**: August 10, 2025  
**Project**: Hedera Hackathon Submission  
**Author**: Mary (Business Analyst) - BMAD Method

---

## 1. Executive Summary

### Project Title
**AfriChain Authenticity** - "Made in Africa, Proven On-Chain"

### Vision Statement
A blockchain-based authenticity and payment platform that empowers African artisans, craft makers, and small-scale manufacturers to mint NFTs as proof of authenticity for their products—directly from feature phones via USSD or smartphones—and accept global crypto payments instantly converted to local mobile money.

### Core Value Proposition
Bridge the gap between traditional African craftsmanship and global digital commerce by providing accessible blockchain-based authenticity certificates and seamless crypto-to-mobile money payment infrastructure.

---

## 2. Problem Statement

### Current Market Challenges
- **Authenticity Crisis**: Global buyers struggle to verify authentic African-made products
- **Payment Barriers**: Artisans cannot accept international payments due to banking limitations
- **Digital Divide**: Most African creators lack smartphone access or technical knowledge
- **Market Access**: Limited reach beyond local markets due to trust and payment friction
- **Counterfeiting**: Mass-produced imitations undervalue authentic handcrafted goods

### Target Pain Points
1. **For Artisans**: Cannot prove product authenticity or accept global payments
2. **For Buyers**: No verification system for authentic African goods
3. **For Market**: Lack of trust infrastructure for cross-border artisan commerce

---

## 3. Target Users & Personas

### Primary Users

#### 3.1 Artisans & Craft Makers
**Feature Phone Users (60% of target)**
- Demographics: Rural artisans, limited internet access
- Access: USSD (*789#) interface only
- Needs: Simple product registration, payment notifications

**Smartphone Users (40% of target)**
- Demographics: Urban creators, some internet access
- Access: Web app or mobile app
- Needs: Rich media uploads, detailed product management

#### 3.2 Global Buyers & Collectors
- Demographics: International buyers seeking authentic African goods
- Access: Web platform, mobile apps
- Needs: Authenticity verification, secure payments, provenance tracking

#### 3.3 Agents & Cooperatives
- Demographics: Local facilitators helping feature phone users
- Access: Smartphone/web platforms
- Needs: Batch processing, media upload assistance, commission tracking

---

## 4. Core Features & Functionality

### 4.1 Maker Registration System

#### USSD Registration (*789#)
```
*789# → Select Language → Enter Name → Select Craft Type → 
Enter Region → Phone Verification → Profile Created
```

#### Web/App Registration
- Extended profile with portfolio
- Document upload for verification
- Banking/mobile money account linkage

### 4.2 NFT Minting Platform

#### USSD Minting Flow
```
Dial *789# → "Create Certificate" → Enter:
- Product Name
- Category (jewelry, textile, carving, etc.)
- Materials Used
- Creation Time (hours/days)
- Brief Description
- Price (USD)
→ NFT Minted → SMS with Certificate Link
```

#### Smartphone Minting Flow
- Photo/video upload during creation
- Detailed metadata entry
- Immediate NFT generation with rich media
- QR code generation for physical tagging

### 4.3 Media Enhancement System
- **Deferred Media Upload**: Add photos/videos after initial USSD minting
- **Agent Assistance**: Local cooperatives help with media capture
- **Metadata Updates**: On-chain updates linked via NFT ID
- **Quality Guidelines**: Automated image quality checks

### 4.4 Physical Authentication
- **NFC Tag Integration**: Tamper-proof tags linked to NFT
- **QR Code Generation**: Printable certificates for products
- **Holographic Stickers**: Anti-counterfeiting physical elements
- **Certificate Printing**: PDF generation for offline verification

### 4.5 Buyer Verification Portal
- **Instant Scanning**: QR/NFC scan → NFT certificate display
- **Provenance Timeline**: Complete ownership and creation history
- **Creator Story**: Artisan profile and crafting process
- **Authenticity Guarantee**: Blockchain-verified proof of origin

### 4.6 Crypto Payment Infrastructure

#### Supported Cryptocurrencies
- HBAR (Hedera)
- USDC (stablecoin)
- Bitcoin (BTC)
- Ethereum (ETH)
- Local African tokens (if available)

#### Payment Process
```
Buyer Selects Product → Crypto Payment → Smart Contract Escrow → 
Automatic Conversion → Mobile Money Transfer → SMS Notification to Artisan
```

#### Mobile Money Integration
- **M-Pesa** (Kenya, Tanzania)
- **Airtel Money** (Multi-country)
- **MTN Mobile Money** (Ghana, Uganda)
- **Orange Money** (West Africa)

### 4.7 Secondary Market & Royalties
- **Ownership Transfer**: On-chain record of resales
- **Creator Royalties**: Automatic percentage to original artisan
- **Price History**: Market value tracking
- **Investment Analytics**: ROI tracking for collectors

---

## 5. Technical Architecture

### 5.1 Core Infrastructure

#### Blockchain Layer
- **Hedera Hashgraph**: Primary blockchain for NFT minting (HTS)
- **Hedera Consensus Service**: Immutable audit trails
- **Internet Computer Protocol (ICP)**: Gas-free canister processing

#### Storage Layer
- **IPFS**: Decentralized media storage
- **Arweave**: Permanent metadata archival
- **Local Caching**: Redis for performance optimization

### 5.2 Application Layer

#### USSD Service
```
USSD Gateway → SMS Bridge → ICP Canister → 
Hedera Minting → Response SMS
```

#### Web/Mobile Applications
- **React/Next.js Frontend**: Responsive web application
- **React Native**: Cross-platform mobile app
- **Progressive Web App**: Offline-capable functionality

### 5.3 Payment Integration

#### Crypto-to-Fiat Bridge
```
Crypto Payment → DeFi Exchange → Stablecoin → 
Local Exchange API → Mobile Money Transfer
```

#### Integration Partners
- **Kotani Pay**: Crypto-mobile money bridge
- **Yellow Card**: African crypto exchange
- **BitPesa**: Cross-border payment processing

### 5.4 Security & Compliance
- **KYC Integration**: Identity verification for high-value transactions
- **AML Compliance**: Anti-money laundering monitoring
- **Multi-signature Escrow**: Secure payment holding
- **Audit Trail**: Complete transaction history on Hedera

---

## 6. User Journey Flows

### 6.1 USSD Artisan Complete Flow

**Step 1: Registration**
```
*789# → "New User" → Enter Name → Select Craft → 
Enter Location → SMS Verification → Account Created
```

**Step 2: Product Creation**
```
*789# → "Create Product" → Enter Details → 
NFT Generated → SMS: "Certificate created: cert.ly/abc123"
```

**Step 3: Media Addition (Optional)**
```
Visit cert.ly/abc123 on smartphone → Upload Photos → 
Update NFT → SMS: "Product enhanced"
```

**Step 4: Sale Notification**
```
SMS: "Product sold! $50 USD received as 5,000 KES M-Pesa. 
Buyer: John from USA. Reference: TXN789"
```

### 6.2 Buyer Verification & Purchase Flow

**Step 1: Discovery**
- Scan QR code on product or certificate
- Direct link to NFT verification portal

**Step 2: Verification**
```
Product Scan → NFT Certificate Display → Creator Profile → 
Authenticity Confirmation → Purchase Option
```

**Step 3: Payment**
```
Select Payment Method → Connect Wallet → Confirm Amount → 
Payment to Escrow → Confirmation Email
```

**Step 4: Completion**
```
Automatic Release → NFT Transfer → Digital Receipt → 
Creator Payment Notification
```

---

## 7. NFT Metadata Schema

### 7.1 Core Identification
```json
{
  "nft_id": "hedera_token_id",
  "product_id": "internal_uuid",
  "creation_timestamp": "hedera_consensus_time",
  "creator_id": "artisan_profile_uuid",
  "certificate_version": "1.0"
}
```

### 7.2 Product Information
```json
{
  "name": "Hand-carved Makonde Mask",
  "category": "traditional_carving",
  "materials": ["ebony_wood", "natural_pigments"],
  "dimensions": {"length": 30, "width": 20, "height": 15},
  "weight_grams": 450,
  "creation_time_hours": 48,
  "description": "Traditional Makonde spirit mask...",
  "cultural_significance": "Used in coming-of-age ceremonies..."
}
```

### 7.3 Visual & Physical Proof
```json
{
  "images": ["ipfs://Qm...", "ipfs://Qm..."],
  "videos": ["ipfs://Qm..."],
  "creation_process_media": ["ipfs://Qm..."],
  "360_view": "ipfs://Qm...",
  "detail_shots": ["ipfs://Qm...", "ipfs://Qm..."]
}
```

### 7.4 Authenticity Data
```json
{
  "authenticity_score": 98,
  "verification_methods": ["creator_attestation", "nfc_tag", "blockchain_mint"],
  "anti_counterfeit_features": ["unique_grain_pattern", "maker_signature"],
  "verification_timestamp": "2025-08-10T10:30:00Z"
}
```

### 7.5 Origin & Provenance
```json
{
  "origin": {
    "country": "Tanzania",
    "region": "Mtwara",
    "gps_coordinates": {"lat": -10.2669, "lng": 40.1811},
    "cultural_group": "Makonde"
  },
  "creator": {
    "name": "Joseph Mbwambo",
    "experience_years": 25,
    "verification_level": "community_verified",
    "specialization": "traditional_masks"
  },
  "ownership_history": [
    {"owner": "creator", "timestamp": "2025-08-10T10:30:00Z"},
    {"owner": "buyer_wallet_address", "timestamp": "2025-08-11T14:22:00Z"}
  ]
}
```

### 7.6 Market & Financial Data
```json
{
  "pricing": {
    "creation_cost_usd": 25,
    "listed_price_usd": 85,
    "final_sale_price_usd": 80,
    "creator_share_percentage": 95,
    "platform_fee_percentage": 5
  },
  "market_context": {
    "similar_items_price_range": {"min": 60, "max": 120},
    "rarity_score": 8.5,
    "investment_potential": "moderate"
  }
}
```

### 7.7 Blockchain Immutability
```json
{
  "metadata_hash": "sha256_hash_of_complete_metadata",
  "hedera_transaction_id": "0.0.123456@1691664600.000000000",
  "consensus_timestamp": "2025-08-10T10:30:00.000000000Z",
  "immutability_proof": "merkle_tree_root",
  "cross_chain_anchors": {
    "ethereum": "0x...",
    "bitcoin": "tx_hash"
  }
}
```

---

## 8. Success Metrics & KPIs

### 8.1 Adoption Metrics
- **Artisan Onboarding**: Target 1,000 creators in first 6 months
- **USSD Usage**: 70% of registrations via feature phone
- **NFT Creation**: 5,000 authenticity certificates minted
- **Geographic Spread**: Active users in 10+ African countries

### 8.2 Transaction Metrics
- **Payment Volume**: $100,000+ in crypto-to-mobile money conversions
- **Average Transaction**: $50-200 USD per product
- **Transaction Success Rate**: >95% completion rate
- **Settlement Time**: <5 minutes crypto to mobile money

### 8.3 Verification Metrics
- **Certificate Scans**: 10,000+ buyer verifications
- **Authenticity Checks**: <1% false positive rate
- **Buyer Satisfaction**: >90% post-purchase positive feedback
- **Repeat Purchases**: 30% buyer return rate

### 8.4 Technical Performance
- **USSD Response Time**: <3 seconds per interaction
- **NFT Minting Speed**: <30 seconds end-to-end
- **System Uptime**: >99.5% availability
- **Gas Costs**: $0.001 average per NFT mint (via ICP)

---

## 9. Hackathon Demo Specification

### 9.1 Live Demo Flow (3 Minutes)

**Minute 1: The Problem**
- Show counterfeit African products flooding global markets
- Demonstrate payment barriers for authentic creators

**Minute 2: The Solution**
```
Live USSD Demo:
- Artisan in Kenya dials *789#
- Creates certificate for beaded necklace
- NFT minted in real-time
- QR code generated instantly
```

**Minute 3: The Impact**
```
Buyer Experience:
- Judge scans QR code on actual necklace
- Views complete authenticity certificate
- Sees artisan story and creation process
- Makes crypto payment
- SMS notification to artisan showing mobile money receipt
```

### 9.2 Technical Demonstration
- **Live Blockchain Transactions**: Real Hedera testnet NFT minting
- **Cross-Platform Integration**: USSD → Web → Mobile seamless flow
- **Payment Simulation**: Crypto payment to mobile money conversion
- **Authenticity Verification**: QR scan to certificate display

### 9.3 Demo Props & Materials
- Feature phone for USSD demonstration
- Actual African craft products with QR codes
- Smartphone for buyer verification
- Large screen showing blockchain explorer
- Mobile money account for payment simulation

---

## 10. Technical Implementation Roadmap

### 10.1 Phase 1: Core Infrastructure (Weeks 1-2)
- **Hedera Integration**: HTS setup and NFT minting
- **ICP Canister Deployment**: Gas-free processing logic
- **USSD Gateway**: Basic text interface
- **Database Schema**: User and product data models

### 10.2 Phase 2: User Interfaces (Weeks 3-4)
- **USSD Menu System**: Complete registration and minting flow
- **Web Application**: Creator dashboard and buyer portal
- **Mobile App**: Native iOS/Android experience
- **QR Code Generation**: Physical product tagging

### 10.3 Phase 3: Payment Integration (Weeks 5-6)
- **Crypto Wallet Integration**: Multi-currency support
- **Mobile Money APIs**: M-Pesa, Airtel, MTN connections
- **Escrow Smart Contracts**: Secure payment holding
- **Exchange Rate Feeds**: Real-time crypto-fiat conversion

### 10.4 Phase 4: Security & Polish (Weeks 7-8)
- **Security Audits**: Smart contract and system security
- **Performance Optimization**: Scalability improvements
- **User Experience Polish**: Interface refinements
- **Documentation**: API docs and user guides

---

## 11. Business Model & Sustainability

### 11.1 Revenue Streams
- **Transaction Fees**: 2.5% on successful sales
- **Premium Features**: Enhanced analytics and marketing tools
- **Certification Services**: Expert verification for high-value items
- **API Licensing**: White-label solutions for marketplaces

### 11.2 Cost Structure
- **Blockchain Fees**: Hedera transaction costs (~$0.0001 per transaction)
- **Infrastructure**: ICP canister hosting and IPFS storage
- **Payment Processing**: Mobile money integration fees
- **Development**: Ongoing platform maintenance and features

### 11.3 Scaling Strategy
- **Geographic Expansion**: Country-by-country rollout
- **Product Category Growth**: Beyond crafts to agriculture, textiles
- **B2B Integration**: Partnership with existing marketplaces
- **Enterprise Solutions**: Brand authentication for larger manufacturers

---

## 12. Risk Analysis & Mitigation

### 12.1 Technical Risks
- **Blockchain Scalability**: Mitigation via ICP gas-free processing
- **Mobile Money API Changes**: Multiple provider integration
- **USSD Service Reliability**: Redundant gateway providers
- **Security Vulnerabilities**: Regular audits and monitoring

### 12.2 Market Risks
- **Low Adoption**: Extensive community outreach and education
- **Regulatory Changes**: Legal compliance monitoring
- **Competition**: Continuous innovation and user experience focus
- **Economic Volatility**: Stablecoin integration for price stability

### 12.3 Operational Risks
- **Fraud Prevention**: Multi-layer verification systems
- **Dispute Resolution**: Community-based arbitration
- **Customer Support**: Local language support and training
- **Quality Control**: Creator verification and rating systems

---

## 13. Success Definition

### 13.1 Hackathon Success
- **Demo Impact**: Clear judge understanding of value proposition
- **Technical Excellence**: Flawless live demonstration
- **Innovation Recognition**: Novel approach to inclusion and authenticity
- **Market Validation**: Evidence of real user demand

### 13.2 Long-term Success
- **Creator Empowerment**: Measurable income increase for artisans
- **Market Transformation**: Reduced counterfeit African goods
- **Global Recognition**: Platform becomes standard for authentic African products
- **Ecosystem Growth**: Thriving community of creators and buyers

---

**This PRD represents a comprehensive vision for democratizing African artisan access to global markets through blockchain technology, ensuring authentic products reach appreciative buyers while creators receive fair compensation through accessible technology interfaces.**

---

*Prepared by Mary (Business Analyst) using BMAD Method strategic analysis framework*
*Project Repository: VeriChainX → AfriChain Authenticity Platform*
*Strategic Foundation: "Made in Africa, Proven On-Chain"*