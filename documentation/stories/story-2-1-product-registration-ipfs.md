# Story 2.1: Product Registration with Image Upload to IPFS

## Story
**User Story:**
As a Kenyan artisan,
I want to register my handmade products with photos and details,
So that I can create authentic digital certificates for my crafts.

**Story Context:**
**Existing System Integration:**
- Integrates with: Authentication system, IPFS network, TiDB database
- Technology: Multer file upload, Sharp image processing, IPFS HTTP API
- Follows pattern: Content-addressed file storage
- Touch points: File upload endpoint, IPFS pinning service, product database

## Acceptance Criteria
**Functional Requirements:**
1. Artisan can upload 1-5 product images (max 5MB each)
2. Product form captures name, description, price, category, crafting materials
3. Images automatically optimized and uploaded to IPFS
4. Product metadata stored with IPFS content hashes

**Integration Requirements:**
5. Sharp image processing optimizes for web and mobile display
6. IPFS content pinning ensures permanent availability
7. TiDB product table stores IPFS hashes and metadata

**Quality Requirements:**
8. Image upload progress indicator for user feedback
9. File type validation (JPEG, PNG, WebP only)
10. Graceful handling of IPFS network failures with retry logic

## Tasks
- [ ] **Task 1:** Set up product registration service infrastructure
  - [ ] Create Express product registration service with file upload
  - [ ] Set up TiDB product table with IPFS hash storage
  - [ ] Configure Multer for multipart file upload handling
  - [ ] Add file type and size validation middleware

- [ ] **Task 2:** Implement IPFS integration for image storage
  - [ ] Set up IPFS HTTP API client configuration
  - [ ] Create image optimization service using Sharp
  - [ ] Implement IPFS upload with content hash generation
  - [ ] Add IPFS content pinning for permanent availability

- [ ] **Task 3:** Build product registration endpoints
  - [ ] POST /products - Product registration with image upload
  - [ ] Add product metadata validation (name, description, price, category)
  - [ ] Implement crafting materials and artisan information capture
  - [ ] Create progress tracking for multi-image uploads

- [ ] **Task 4:** Create product data management
  - [ ] Product metadata storage with IPFS content references
  - [ ] Image optimization pipeline (web and mobile sizes)
  - [ ] Error handling for IPFS network failures with retry logic
  - [ ] Product status tracking (draft, pending, registered)

## Dev Notes
**Technical Notes:**
- **Integration Approach:** Multipart form upload → Sharp optimization → IPFS upload
- **Storage Pattern:** Content-addressed storage with cryptographic verification
- **Key Constraints:** IPFS gateway URLs must be accessible globally

## Testing
**Test Requirements:**
- Unit tests for image processing and IPFS upload
- Integration tests for product registration flow
- File upload validation tests
- IPFS network failure handling tests
- Image optimization quality tests
- End-to-end registration workflow tests

## Definition of Done
- [ ] Product registration form with image upload working
- [ ] Images automatically processed and stored to IPFS
- [ ] Product metadata stored with content hash references
- [ ] Upload progress and error handling user-friendly
- [ ] Image optimization reduces file sizes without quality loss
- [ ] End-to-end testing covers upload failures and retries

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