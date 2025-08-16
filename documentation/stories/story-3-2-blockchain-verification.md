# Story 3.2: Blockchain Verification Against Hedera NFTs

## Story
**User Story:**
As a consumer who scanned a product QR code,
I want the system to verify the product against blockchain records,
So that I can trust the authenticity verification is tamper-proof.

**Story Context:**
**Existing System Integration:**
- Integrates with: QR scanning (Story 3.1), Hedera Mirror Node, NFT records
- Technology: Hedera Mirror Node API, cryptographic verification
- Follows pattern: Blockchain state verification
- Touch points: QR payload, NFT token validation, blockchain queries

## Acceptance Criteria
**Functional Requirements:**
1. QR code data automatically verified against Hedera blockchain
2. NFT token existence and ownership confirmed via Mirror Node
3. Product metadata hash validated against blockchain record
4. Verification results displayed within 3 seconds of scanning

**Integration Requirements:**
5. Hedera Mirror Node API integration for NFT queries
6. Cryptographic verification of QR payload signatures
7. Database caching of verification results for performance

**Quality Requirements:**
8. Verification handles blockchain network delays gracefully
9. Clear authentic/counterfeit result display
10. Detailed verification information available on demand

## Tasks
- [ ] **Task 1:** Set up Hedera Mirror Node integration
  - [ ] Configure Hedera Mirror Node API client
  - [ ] Create NFT token query service using Mirror Node REST API
  - [ ] Add transaction history querying for NFT validation
  - [ ] Implement API rate limiting and error handling

- [ ] **Task 2:** Build QR verification service
  - [ ] Create QR payload parsing and validation service
  - [ ] Implement HMAC signature verification for tamper detection
  - [ ] Add product ID and NFT token ID extraction
  - [ ] Create verification timestamp and expiry checking

- [ ] **Task 3:** Implement blockchain state verification
  - [ ] Query NFT existence using Hedera Mirror Node API
  - [ ] Validate NFT metadata hash against blockchain record
  - [ ] Check NFT ownership and minting transaction
  - [ ] Create comprehensive verification result object

- [ ] **Task 4:** Add verification caching and performance optimization
  - [ ] Implement Redis caching for verification results
  - [ ] Add cache invalidation strategy for updated products
  - [ ] Create verification result aggregation and display
  - [ ] Add performance monitoring for blockchain queries

## Dev Notes
**Technical Notes:**
- **Integration Approach:** QR parse → Extract NFT ID → Query blockchain → Verify metadata
- **Blockchain Pattern:** Mirror Node queries for real-time NFT state
- **Key Constraints:** Mirror Node API rate limits require efficient querying

## Testing
**Test Requirements:**
- Unit tests for QR payload verification
- Integration tests for Hedera Mirror Node queries
- Blockchain verification accuracy tests
- Performance tests for verification speed
- Caching system tests
- Network failure handling tests

## Definition of Done
- [ ] QR codes verified against live Hedera blockchain
- [ ] NFT existence and metadata confirmed via Mirror Node
- [ ] Cryptographic signature verification prevents tampering
- [ ] Verification results cached for performance
- [ ] Clear authentic/counterfeit status display
- [ ] Blockchain verification tests using testnet NFTs

## Dev Agent Record
### Status
Draft

### Agent Model Used
<!-- To be filled by dev agent -->

### Tasks Completed
<!-- To be updated by dev agent with checkboxes -->

### Debug Log References
<!-- To be updated by dev agent -->

### Completion Notes
<!-- To be updated by dev agent -->

### File List
<!-- To be updated by dev agent with all created/modified files -->

### Change Log
<!-- To be updated by dev agent -->