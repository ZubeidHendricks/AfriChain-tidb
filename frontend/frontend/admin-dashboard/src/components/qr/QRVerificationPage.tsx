import React, { useState, useCallback } from 'react';
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Alert,
  Button,
  Chip,
  Stack,
  Divider,
  Grid,
  Paper,
  CircularProgress,
  Fade,
  Zoom,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Verified as VerifiedIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Info as InfoIcon,
  QrCode as QRIcon,
  Security as SecurityIcon,
  Token as TokenIcon,
  Schedule as ScheduleIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  ViewList as BasicViewIcon,
  Dashboard as DetailedViewIcon,
} from '@mui/icons-material';
import QRScannerComponent from './QRScannerComponent';
import { VerificationResultsDisplay } from './VerificationResultsDisplay';

interface VerificationResult {
  isValid: boolean;
  isAuthentic: boolean;
  productId: string;
  productName?: string;
  nftTokenId?: string;
  nftSerialNumber?: number;
  verificationTimestamp: string;
  blockchainConfirmed?: boolean;
  metadata?: {
    brand?: string;
    category?: string;
    manufacturer?: string;
    originCountry?: string;
    registrationDate?: string;
    verificationScore?: number;
  };
  warnings?: string[];
  errors?: string[];
}

interface QRVerificationPageProps {
  className?: string;
}

export const QRVerificationPage: React.FC<QRVerificationPageProps> = ({
  className,
}) => {
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<'basic' | 'detailed'>('basic');

  // Handle QR scan
  const handleQRScan = useCallback(async (qrData: string) => {
    setScannedData(qrData);
    setIsVerifying(true);
    setError(null);
    setVerificationResult(null);

    try {
      // Parse QR data - it should be a verification URL or encoded payload
      let verificationPayload: string;
      
      if (qrData.startsWith('http')) {
        // Extract verification ID from URL
        const url = new URL(qrData);
        const pathParts = url.pathname.split('/');
        verificationPayload = pathParts[pathParts.length - 1];
      } else {
        // Direct payload
        verificationPayload = qrData;
      }

      // Make verification API call using the new verification endpoint
      const response = await fetch(`/api/verify/${encodeURIComponent(verificationPayload)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Verification failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Simulate some processing time for better UX
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Extract the verification result from the API response
      setVerificationResult(data.result);
      
      // Auto-switch to detailed view for successful verifications
      if (data.result && data.result.isValid) {
        setCurrentTab('detailed');
      }
    } catch (err) {
      console.error('Verification error:', err);
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setIsVerifying(false);
    }
  }, []);

  // Handle scanner errors
  const handleScannerError = useCallback((errorMessage: string) => {
    setError(`Scanner Error: ${errorMessage}`);
  }, []);

  // Reset verification state
  const handleReset = useCallback(() => {
    setVerificationResult(null);
    setError(null);
    setScannedData(null);
    setIsVerifying(false);
    setCurrentTab('basic');
  }, []);

  // Handle tab changes
  const handleTabChange = useCallback((event: React.SyntheticEvent, newValue: 'basic' | 'detailed') => {
    setCurrentTab(newValue);
  }, []);

  // Get verification status info
  const getVerificationStatus = () => {
    if (!verificationResult) return null;

    if (!verificationResult.isValid) {
      return {
        icon: <ErrorIcon color="error" />,
        title: 'Invalid QR Code',
        color: 'error' as const,
        description: 'This QR code is not valid or has been tampered with.',
      };
    }

    if (!verificationResult.isAuthentic) {
      return {
        icon: <WarningIcon color="warning" />,
        title: 'Counterfeit Detected',
        color: 'warning' as const,
        description: 'This product appears to be counterfeit or unauthorized.',
      };
    }

    return {
      icon: <VerifiedIcon color="success" />,
      title: 'Authentic Product',
      color: 'success' as const,
      description: 'This product is verified as authentic and legitimate.',
    };
  };

  const status = getVerificationStatus();

  return (
    <Container maxWidth="lg" className={className}>
      <Box py={4}>
        {/* Header */}
        <Box textAlign="center" mb={4}>
          <Typography variant="h3" component="h1" gutterBottom>
            Product Verification
          </Typography>
          <Typography variant="h6" color="text.secondary">
            Scan a product QR code to verify its authenticity
          </Typography>
        </Box>

        <Grid container spacing={3}>
          {/* QR Scanner Section */}
          <Grid item xs={12} md={6}>
            <QRScannerComponent
              onScan={handleQRScan}
              onError={handleScannerError}
              enabled={!isVerifying}
            />
          </Grid>

          {/* Results Section */}
          <Grid item xs={12} md={6}>
            {error && (
              <Fade in>
                <Alert 
                  severity="error" 
                  sx={{ mb: 2 }}
                  onClose={() => setError(null)}
                  action={
                    <Button color="inherit" size="small" onClick={handleReset}>
                      Try Again
                    </Button>
                  }
                >
                  {error}
                </Alert>
              </Fade>
            )}

            {isVerifying && (
              <Fade in>
                <Card>
                  <CardContent>
                    <Box display="flex" flexDirection="column" alignItems="center" py={4}>
                      <CircularProgress size={60} sx={{ mb: 2 }} />
                      <Typography variant="h6" gutterBottom>
                        Verifying Product...
                      </Typography>
                      <Typography variant="body2" color="text.secondary" textAlign="center">
                        Checking blockchain records and validating authenticity
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Fade>
            )}

            {verificationResult && (
              <Zoom in>
                <Card>
                  <CardContent>
                    {/* View Tabs */}
                    <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                      <Tabs value={currentTab} onChange={handleTabChange} aria-label="verification views">
                        <Tab 
                          icon={<BasicViewIcon />} 
                          label="Basic View" 
                          value="basic" 
                          iconPosition="start"
                        />
                        <Tab 
                          icon={<DetailedViewIcon />} 
                          label="Detailed View" 
                          value="detailed" 
                          iconPosition="start"
                        />
                      </Tabs>
                    </Box>

                    {/* Basic View */}
                    {currentTab === 'basic' && (
                      <Box>
                        {/* Verification Status */}
                        <Box textAlign="center" mb={3}>
                          <Box mb={2}>
                            {status?.icon}
                          </Box>
                          <Typography variant="h5" gutterBottom color={`${status?.color}.main`}>
                            {status?.title}
                          </Typography>
                          <Typography variant="body1" color="text.secondary">
                            {status?.description}
                          </Typography>
                        </Box>

                        <Divider sx={{ my: 2 }} />

                        {/* Quick Info */}
                        <Stack spacing={2} mb={3}>
                          {verificationResult.productName && (
                            <Box>
                              <Typography variant="subtitle2" color="text.secondary">
                                Product Name
                              </Typography>
                              <Typography variant="body1">
                                {verificationResult.productName}
                              </Typography>
                            </Box>
                          )}

                          <Box>
                            <Typography variant="subtitle2" color="text.secondary">
                              Product ID
                            </Typography>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                              {verificationResult.productId}
                            </Typography>
                          </Box>

                          <Box display="flex" alignItems="center" justifyContent="space-between">
                            <Typography variant="subtitle2" color="text.secondary">
                              Blockchain Status
                            </Typography>
                            <Chip
                              icon={verificationResult.blockchainConfirmed ? <VerifiedIcon /> : <WarningIcon />}
                              label={verificationResult.blockchainConfirmed ? 'Confirmed' : 'Pending'}
                              color={verificationResult.blockchainConfirmed ? 'success' : 'warning'}
                              size="small"
                            />
                          </Box>
                        </Stack>

                        {/* Warnings and Errors */}
                        {verificationResult.warnings && verificationResult.warnings.length > 0 && (
                          <Alert severity="warning" sx={{ mb: 2 }}>
                            <Typography variant="body2">
                              {verificationResult.warnings.join('; ')}
                            </Typography>
                          </Alert>
                        )}

                        {verificationResult.errors && verificationResult.errors.length > 0 && (
                          <Alert severity="error" sx={{ mb: 2 }}>
                            <Typography variant="body2">
                              {verificationResult.errors.join('; ')}
                            </Typography>
                          </Alert>
                        )}

                        {/* Actions */}
                        <Box mt={3} display="flex" gap={2} justifyContent="center">
                          <Button
                            variant="outlined"
                            onClick={handleReset}
                            startIcon={<QRIcon />}
                          >
                            Scan Another
                          </Button>
                          {verificationResult.isValid && (
                            <Button
                              variant="contained"
                              onClick={() => setCurrentTab('detailed')}
                              startIcon={<DetailedViewIcon />}
                            >
                              View Details
                            </Button>
                          )}
                        </Box>
                      </Box>
                    )}

                    {/* Detailed View */}
                    {currentTab === 'detailed' && (
                      <VerificationResultsDisplay
                        verificationResult={verificationResult}
                        loading={false}
                        onShare={() => {
                          // Implement share functionality
                          if (navigator.share) {
                            navigator.share({
                              title: `${verificationResult.productName || 'Product'} Verification`,
                              text: `This product has been verified as ${verificationResult.isAuthentic ? 'authentic' : 'suspicious'}`,
                              url: window.location.href,
                            });
                          }
                        }}
                        onDownloadCertificate={() => {
                          // Implement certificate download
                          console.log('Download certificate for product:', verificationResult.productId);
                        }}
                      />
                    )}
                  </CardContent>
                </Card>
              </Zoom>
            )}

            {!isVerifying && !verificationResult && !error && (
              <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
                <QRIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  Ready to Scan
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Point your camera at a product QR code to begin verification
                </Typography>
              </Paper>
            )}
          </Grid>
        </Grid>
      </Box>
    </Container>
  );
};

export default QRVerificationPage;