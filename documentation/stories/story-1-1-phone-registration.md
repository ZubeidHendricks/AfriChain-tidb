# Story 1.1: Phone Number Registration with SMS OTP

## Story
**User Story:**
As a Kenyan artisan or consumer,
I want to register using only my phone number and receive SMS verification,
So that I can access the platform without needing email or complex passwords.

**Story Context:**
**Existing System Integration:**
- Integrates with: New authentication service
- Technology: Node.js, Express, Africa's Talking SMS API
- Follows pattern: Phone-first authentication for African markets
- Touch points: SMS gateway, user database, session management

## Acceptance Criteria
**Functional Requirements:**
1. User can register with Kenyan phone number format (+254XXXXXXXXX)
2. 6-digit SMS OTP sent within 30 seconds of registration
3. OTP valid for 5 minutes from generation time
4. User account created upon successful OTP verification

**Integration Requirements:**
5. Africa's Talking SMS API integration working with 99%+ delivery rate
6. TiDB user table stores encrypted phone numbers and verification status
7. Redis session management tracks OTP attempts and timeouts

**Quality Requirements:**
8. Rate limiting: Max 3 OTP requests per 15 minutes per phone number
9. Input validation prevents SQL injection and phone number spoofing
10. Comprehensive error handling with user-friendly messages

## Tasks
- [ ] **Task 1:** Set up authentication service infrastructure
  - [ ] Create Express authentication service with proper middleware
  - [ ] Set up TiDB user table with encrypted phone number storage
  - [ ] Configure Redis for OTP session management
  - [ ] Add rate limiting middleware (3 requests per 15 minutes)

- [ ] **Task 2:** Implement Africa's Talking SMS integration
  - [ ] Set up Africa's Talking API client configuration
  - [ ] Create OTP generation service (6-digit, 5-minute expiry)
  - [ ] Implement SMS sending with delivery confirmation webhooks
  - [ ] Add error handling for SMS delivery failures

- [ ] **Task 3:** Build phone registration endpoints
  - [ ] POST /auth/register - Phone number registration endpoint
  - [ ] POST /auth/verify-otp - OTP verification endpoint
  - [ ] Add Kenyan phone number format validation (+254XXXXXXXXX)
  - [ ] Implement HMAC-signed OTP generation with time-based expiry

- [ ] **Task 4:** Create user account management
  - [ ] User account creation upon successful OTP verification
  - [ ] JWT token generation for authenticated users
  - [ ] Encrypted phone number storage in TiDB
  - [ ] Account status tracking (pending, verified, suspended)

## Dev Notes
**Technical Notes:**
- **Integration Approach:** Africa's Talking SMS gateway with webhook confirmations
- **Security Pattern:** HMAC-signed OTP generation with time-based expiry
- **Key Constraints:** Must work with all Kenyan mobile networks (Safaricom, Airtel, Telkom)

## Testing
**Test Requirements:**
- Unit tests for OTP generation and validation
- Integration tests for Africa's Talking API
- Rate limiting tests
- Phone number validation tests
- Error handling tests for network failures
- End-to-end registration flow tests

## Definition of Done
- [ ] Phone number registration form accepts Kenyan formats
- [ ] SMS OTP delivery confirmed via Africa's Talking webhooks
- [ ] OTP verification creates user account with JWT token
- [ ] Rate limiting prevents abuse
- [ ] Error handling covers network failures and invalid inputs
- [ ] Unit tests cover all verification flows

## Dev Agent Record
### Status
In Progress

### Agent Model Used
Claude Sonnet 4 (20250514)

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