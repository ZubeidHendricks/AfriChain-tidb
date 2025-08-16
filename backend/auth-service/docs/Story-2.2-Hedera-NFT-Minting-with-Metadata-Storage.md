# Story 2.2 - Hedera NFT Minting with Metadata Storage

**Epic:** 2 - Product Registration & Authenticity Verification  
**Story ID:** 2.2  
**Priority:** HIGH  
**Estimate:** 8 Story Points  
**Sprint:** Current Development Cycle

---

## 📖 Story Description

**As a** product owner or business  
**I want** to mint NFTs on Hedera Hashgraph that represent registered products with comprehensive metadata  
**So that** each product has a unique, immutable digital certificate stored on the blockchain that proves authenticity and ownership

## 🎯 Acceptance Criteria

### Primary Requirements
- [ ] **NFT Creation**: Each registered product must be able to mint a corresponding NFT on Hedera
- [ ] **Metadata Storage**: NFT metadata must include product details, IPFS image links, and authenticity information
- [ ] **Blockchain Integration**: Direct integration with Hedera Consensus Service for reliable minting
- [ ] **Token Association**: NFTs must be associated with user wallets through account association
- [ ] **Batch Operations**: Support for minting multiple NFTs efficiently
- [ ] **Status Tracking**: Track NFT minting status and transaction details

### Technical Requirements
- [ ] **Hedera SDK**: Integrate @hashgraph/sdk for blockchain operations
- [ ] **Account Management**: Secure treasury account management for minting operations
- [ ] **Gas Optimization**: Efficient transaction batching and fee management
- [ ] **Error Handling**: Comprehensive error handling for blockchain operations
- [ ] **Retry Logic**: Implement retry mechanisms for network failures
- [ ] **Transaction Logging**: Detailed logging of all blockchain transactions

### Business Requirements
- [ ] **Cost Management**: Track minting costs and optimize for efficiency
- [ ] **Compliance**: Ensure NFT metadata meets regulatory requirements
- [ ] **Scalability**: Design for high-volume minting operations
- [ ] **Auditability**: Complete audit trail for all minting activities

---

## 🛠️ Technical Implementation Tasks

### Task 1: Set up Hedera Hashgraph integration and client configuration
**Estimate:** 2 Story Points  
**Description:** Configure Hedera client, account management, and network connectivity

**Deliverables:**
- [ ] Hedera client configuration with environment management
- [ ] Treasury account setup with proper key management
- [ ] Network configuration (testnet/mainnet switching)
- [ ] Connection health monitoring and error handling
- [ ] Fee estimation and management utilities

**Files to Create/Modify:**
- `src/config/hedera.ts` - Hedera client configuration
- `src/utils/hederaKeys.ts` - Key management utilities
- Environment variables for Hedera configuration

### Task 2: Build NFT minting service with metadata management
**Estimate:** 3 Story Points  
**Description:** Create comprehensive NFT minting service with metadata handling

**Deliverables:**
- [ ] NFT token creation and management
- [ ] Metadata schema for product authenticity
- [ ] Batch minting operations for efficiency
- [ ] Transaction status tracking and confirmation
- [ ] Cost calculation and fee management

**Files to Create/Modify:**
- `src/services/hederaNftService.ts` - Core NFT minting service
- `src/models/Nft.ts` - NFT database models
- `src/types/nftTypes.ts` - TypeScript type definitions

### Task 3: Create NFT minting endpoints and product integration
**Estimate:** 2 Story Points  
**Description:** Build REST API endpoints for NFT operations integrated with product system

**Deliverables:**
- [ ] POST /products/:id/mint-nft - Mint NFT for registered product
- [ ] GET /products/:id/nft - Get NFT details for product
- [ ] GET /nfts - List user's NFTs with pagination
- [ ] POST /nfts/batch-mint - Batch mint multiple products
- [ ] GET /nfts/:tokenId - Get detailed NFT information

**Files to Create/Modify:**
- `src/routes/nfts.ts` - NFT-specific routes
- `src/routes/products.ts` - Add NFT endpoints to product routes
- `src/middleware/nftValidation.ts` - NFT-specific validation

### Task 4: Implement NFT metadata synchronization and blockchain monitoring
**Estimate:** 1 Story Point  
**Description:** Create monitoring and synchronization systems for NFT operations

**Deliverables:**
- [ ] Transaction monitoring and confirmation tracking
- [ ] Metadata synchronization between database and blockchain
- [ ] NFT status updates and notifications
- [ ] Blockchain event listening and processing
- [ ] Health monitoring for Hedera network connectivity

**Files to Create/Modify:**
- `src/services/nftMonitoringService.ts` - Blockchain monitoring
- `src/utils/transactionTracker.ts` - Transaction status tracking
- Database schema updates for NFT tracking

---

## 🔗 Dependencies

### Internal Dependencies
- **Story 2.1**: Product Registration with Image Upload to IPFS (COMPLETED)
  - Requires product registration system
  - Needs IPFS URLs for NFT metadata
  - Database models must be extended

### External Dependencies
- **Hedera SDK**: @hashgraph/sdk for blockchain operations
- **Cryptographic Libraries**: For secure key management
- **Environment Configuration**: Hedera network credentials

### Infrastructure Requirements
- **Hedera Account**: Treasury account with sufficient HBAR for minting
- **Network Access**: Reliable connection to Hedera network
- **Key Storage**: Secure storage for private keys
- **Monitoring**: Blockchain transaction monitoring capabilities

---

## 📊 NFT Metadata Schema

### Core Metadata Structure
```json
{
  "name": "AfriChain Product #{productId}",
  "description": "Authentic product certificate on AfriChain platform",
  "image": "ipfs://{primaryImageCid}",
  "properties": {
    "productId": "{uuid}",
    "productName": "{string}",
    "category": "{string}",
    "brand": "{string}",
    "model": "{string}",
    "serialNumber": "{string}",
    "batchNumber": "{string}",
    "manufacturer": {
      "name": "{string}",
      "address": "{string}",
      "country": "{string}"
    },
    "registration": {
      "timestamp": "{ISO8601}",
      "registrar": "{userId}",
      "platform": "AfriChain"
    },
    "authenticity": {
      "verified": true,
      "verificationMethod": "physical_inspection",
      "verificationDate": "{ISO8601}"
    },
    "media": {
      "images": [
        {
          "type": "primary",
          "ipfs": "ipfs://{cid}",
          "thumbnails": {
            "small": "ipfs://{cid}",
            "medium": "ipfs://{cid}",
            "large": "ipfs://{cid}"
          }
        }
      ],
      "certificates": ["ipfs://{cid}"]
    }
  },
  "attributes": [
    {
      "trait_type": "Category",
      "value": "{category}"
    },
    {
      "trait_type": "Brand",
      "value": "{brand}"
    },
    {
      "trait_type": "Origin Country",
      "value": "{country}"
    },
    {
      "trait_type": "Verification Status",
      "value": "Verified"
    }
  ]
}
```

---

## 🗄️ Database Schema Extensions

### NFT Tokens Table
```sql
CREATE TABLE nft_tokens (
  id VARCHAR(36) PRIMARY KEY,
  product_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  token_id VARCHAR(64) NOT NULL UNIQUE,
  serial_number BIGINT NOT NULL,
  metadata_uri TEXT,
  metadata_hash VARCHAR(64),
  minting_transaction_id VARCHAR(64),
  minting_status ENUM('pending', 'confirmed', 'failed') DEFAULT 'pending',
  minting_cost_hbar DECIMAL(18, 8),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_product_id (product_id),
  INDEX idx_user_id (user_id),
  INDEX idx_token_id (token_id),
  INDEX idx_minting_status (minting_status),
  
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### NFT Transactions Table
```sql
CREATE TABLE nft_transactions (
  id VARCHAR(36) PRIMARY KEY,
  nft_token_id VARCHAR(36) NOT NULL,
  transaction_id VARCHAR(64) NOT NULL,
  transaction_type ENUM('mint', 'transfer', 'burn', 'associate') NOT NULL,
  from_account_id VARCHAR(64),
  to_account_id VARCHAR(64),
  status ENUM('pending', 'confirmed', 'failed') DEFAULT 'pending',
  consensus_timestamp TIMESTAMP NULL,
  transaction_fee_hbar DECIMAL(18, 8),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_nft_token_id (nft_token_id),
  INDEX idx_transaction_id (transaction_id),
  INDEX idx_status (status),
  INDEX idx_transaction_type (transaction_type),
  
  FOREIGN KEY (nft_token_id) REFERENCES nft_tokens(id) ON DELETE CASCADE
);
```

---

## 🔐 Security Considerations

### Key Management
- **Private Keys**: Secure storage of treasury account private keys
- **Environment Variables**: Proper separation of sensitive configuration
- **Access Control**: Role-based access for minting operations
- **Audit Logging**: Complete logging of all key usage

### Transaction Security
- **Transaction Signing**: Secure transaction signing processes
- **Retry Logic**: Prevent duplicate transactions through idempotency
- **Fee Management**: Protection against excessive fee consumption
- **Rate Limiting**: Prevent abuse of minting endpoints

### Metadata Security
- **Schema Validation**: Strict validation of all metadata
- **Content Filtering**: Prevention of malicious content in metadata
- **IPFS Security**: Verification of IPFS content integrity
- **Immutability**: Ensuring metadata cannot be tampered with post-minting

---

## 📈 Performance Requirements

### Throughput Targets
- **Minting Rate**: Support for 100+ NFTs per hour
- **Batch Operations**: Efficient processing of bulk minting requests
- **Response Time**: API response times under 2 seconds for individual operations
- **Concurrency**: Handle multiple concurrent minting requests

### Resource Management
- **HBAR Consumption**: Optimize transaction costs through batching
- **Database Performance**: Efficient indexing for NFT queries
- **Memory Usage**: Manage memory consumption during batch operations
- **Network Usage**: Optimize Hedera network communication

---

## 🧪 Testing Strategy

### Unit Testing
- [ ] Hedera client configuration and connection tests
- [ ] NFT metadata generation and validation tests
- [ ] Transaction signing and submission tests
- [ ] Database model tests for NFT entities

### Integration Testing
- [ ] End-to-end NFT minting workflow tests
- [ ] Product-to-NFT integration tests
- [ ] Hedera network integration tests
- [ ] Batch minting operation tests

### Load Testing
- [ ] High-volume minting stress tests
- [ ] Concurrent user minting tests
- [ ] Network failure recovery tests
- [ ] Database performance under load tests

---

## 📋 Definition of Done

### Technical Completion
- [ ] All tasks completed and code reviewed
- [ ] Unit tests written and passing (>90% coverage)
- [ ] Integration tests passing
- [ ] Documentation updated and complete
- [ ] Security review completed

### Functional Completion
- [ ] NFTs can be minted for registered products
- [ ] Metadata properly stored on blockchain
- [ ] User can view and manage their NFTs
- [ ] Batch minting operations working
- [ ] Error handling and recovery working

### Quality Assurance
- [ ] Code follows project standards
- [ ] Performance requirements met
- [ ] Security requirements satisfied
- [ ] Accessibility considerations addressed
- [ ] Cross-platform compatibility verified

---

## 🚀 Success Metrics

### Technical Metrics
- **Minting Success Rate**: >99% successful minting operations
- **Transaction Confirmation Time**: Average <30 seconds
- **API Response Time**: <2 seconds for minting operations
- **System Uptime**: >99.9% availability

### Business Metrics
- **User Adoption**: NFT minting feature usage rate
- **Cost Efficiency**: Average minting cost per NFT
- **Error Rate**: <1% failed minting attempts
- **User Satisfaction**: Positive feedback on NFT features

---

## 🔄 Story Status Tracking

### Pre-Development
- [ ] Story groomed and estimated
- [ ] Dependencies identified and resolved
- [ ] Technical design approved
- [ ] Environment setup completed

### In Progress
- [ ] Task 1: Hedera integration setup
- [ ] Task 2: NFT minting service development
- [ ] Task 3: API endpoints implementation
- [ ] Task 4: Monitoring and synchronization

### Completed
- [ ] All acceptance criteria met
- [ ] Code reviewed and merged
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Story demo completed

---

**Story Owner:** Development Team  
**Stakeholders:** Product Owner, Technical Lead, QA Team  
**Created:** Current Session  
**Last Updated:** Current Session  
**Status:** READY FOR DEVELOPMENT