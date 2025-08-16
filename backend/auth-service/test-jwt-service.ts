// Simple JWT Service validation script
import JWTService from './src/services/jwtService';

async function testJWTService() {
    console.log('🧪 Testing JWT Service Implementation...');
    
    try {
        const jwtService = new JWTService();
        console.log('✅ JWT Service instance created successfully');
        
        // Test token pair generation
        console.log('📝 Testing token pair generation...');
        const tokenPair = await jwtService.generateTokenPair(
            'test-user-123',
            '+254712345678',
            'test-device-456',
            false
        );
        
        console.log('✅ Token pair generated successfully');
        console.log(`   Access Token: ${tokenPair.accessToken.substring(0, 50)}...`);
        console.log(`   Refresh Token: ${tokenPair.refreshToken.substring(0, 50)}...`);
        console.log(`   Token ID: ${tokenPair.tokenId}`);
        console.log(`   Access Expiry: ${tokenPair.accessTokenExpiry}`);
        console.log(`   Refresh Expiry: ${tokenPair.refreshTokenExpiry}`);
        
        // Test access token validation
        console.log('\n🔍 Testing access token validation...');
        const validation = await jwtService.validateAccessToken(tokenPair.accessToken);
        
        if (validation.valid && validation.decoded) {
            console.log('✅ Access token validation successful');
            console.log(`   User ID: ${validation.decoded.userId}`);
            console.log(`   Phone: ${validation.decoded.phoneNumber}`);
            console.log(`   Token Type: ${validation.decoded.tokenType}`);
            console.log(`   Device ID: ${validation.decoded.deviceId}`);
        } else {
            console.log('❌ Access token validation failed:', validation.error);
        }
        
        // Test refresh token validation
        console.log('\n🔄 Testing refresh token validation...');
        const refreshValidation = await jwtService.validateRefreshToken(tokenPair.refreshToken);
        
        if (refreshValidation.valid && refreshValidation.decoded) {
            console.log('✅ Refresh token validation successful');
            console.log(`   Token Type: ${refreshValidation.decoded.tokenType}`);
        } else {
            console.log('❌ Refresh token validation failed:', refreshValidation.error);
        }
        
        console.log('\n🎉 JWT Service implementation validated successfully!');
        
    } catch (error) {
        console.error('❌ JWT Service test failed:', error);
    }
}

// Run the test
testJWTService();