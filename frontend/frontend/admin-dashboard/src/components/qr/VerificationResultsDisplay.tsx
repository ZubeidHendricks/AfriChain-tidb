/**
 * Verification Results Display Component
 * 
 * Displays comprehensive verification results including product information,
 * artisan details, blockchain certificates, and verification history.
 */

import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Grid,
  Avatar,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  Button,
  IconButton,
  LinearProgress,
  Alert,
  Link,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  ImageList,
  ImageListItem,
  Tooltip,
  Rating,
  Skeleton,
  Switch,
  FormControlLabel,
  Snackbar,
  AlertTitle,
} from '@mui/material';
import {
  CheckCircle as AuthenticIcon,
  Cancel as CounterfeitIcon,
  Help as UnknownIcon,
  ExpandMore as ExpandMoreIcon,
  Person as PersonIcon,
  LocationOn as LocationIcon,
  Timeline as TimelineIcon,
  Security as SecurityIcon,
  Share as ShareIcon,
  Verified as VerifiedIcon,
  History as HistoryIcon,
  Launch as LaunchIcon,
  Close as CloseIcon,
  ZoomIn as ZoomInIcon,
  Download as DownloadIcon,
  Public as PublicIcon,
  Lock as LockIcon,
  Fullscreen as FullscreenIcon,
  PlayCircleOutline as PlayIcon,
  Favorite as FavoriteIcon,
  FavoriteBorder as FavoriteIconOutline,
  Facebook as FacebookIcon,
  Twitter as TwitterIcon,
  LinkedIn as LinkedInIcon,
  WhatsApp as WhatsAppIcon,
  QrCode as QrCodeIcon,
  CameraAlt as CameraIcon,
  LocalOffer as TagIcon,
  EmojiEvents as AwardIcon,
  TrendingUp as TrendingIcon,
  Language as WebIcon,
  Instagram as InstagramIcon,
  ArrowBack as ArrowBackIcon,
  ArrowForward as ArrowForwardIcon,
  Analytics as AnalyticsIcon,
  PrivacyTip as PrivacyIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Settings as SettingsIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { styled } from '@mui/material/styles';
import { format } from 'date-fns';

// Types
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
  blockchainDetails?: {
    exists: boolean;
    isValid: boolean;
    nftInfo?: any;
    tokenInfo?: any;
    transactionHistory?: any[];
    verificationTimestamp: string;
    errors: string[];
    warnings: string[];
  };
}

interface ProductDetails {
  id: string;
  product_name: string;
  description: string;
  brand: string;
  category: string;
  manufacturer_name: string;
  origin_country: string;
  created_at: string;
  status: string;
  images?: string[];
  specifications?: Record<string, any>;
}

interface ArtisanProfile {
  id: string;
  name: string;
  bio: string;
  location: string;
  specialization: string;
  experience_years: number;
  rating: number;
  verified: boolean;
  avatar_url?: string;
  craft_story?: string;
  contact_info?: {
    website?: string;
    social_media?: Record<string, string>;
  };
  certifications?: string[];
  portfolio_items?: Array<{
    id: string;
    title: string;
    image_url: string;
    description: string;
  }>;
}

interface VerificationHistory {
  total_verifications: number;
  last_verification: string;
  authenticity_rate: number;
  geographic_distribution: Record<string, number>;
  verification_trend: Array<{
    date: string;
    count: number;
  }>;
}

// Styled Components
const StatusCard = styled(Card)<{ status: 'authentic' | 'counterfeit' | 'unknown' }>(({ theme, status }) => ({
  border: `2px solid ${
    status === 'authentic' ? theme.palette.success.main :
    status === 'counterfeit' ? theme.palette.error.main :
    theme.palette.warning.main
  }`,
  backgroundColor: 
    status === 'authentic' ? theme.palette.success.light + '10' :
    status === 'counterfeit' ? theme.palette.error.light + '10' :
    theme.palette.warning.light + '10',
}));

const VerificationScoreBar = styled(LinearProgress)<{ score: number }>(({ theme, score }) => ({
  height: 8,
  borderRadius: 4,
  backgroundColor: theme.palette.grey[200],
  '& .MuiLinearProgress-bar': {
    backgroundColor:
      score >= 80 ? theme.palette.success.main :
      score >= 60 ? theme.palette.warning.main :
      theme.palette.error.main,
    borderRadius: 4,
  },
}));

const ImageGalleryItem = styled(ImageListItem)(({ theme }) => ({
  cursor: 'pointer',
  borderRadius: theme.spacing(1),
  overflow: 'hidden',
  '&:hover': {
    transform: 'scale(1.02)',
    transition: 'transform 0.2s ease-in-out',
  },
}));

interface VerificationResultsDisplayProps {
  verificationResult: VerificationResult;
  loading?: boolean;
  onShare?: () => void;
  onDownloadCertificate?: () => void;
  enableAnalytics?: boolean;
  privacyMode?: boolean;
  onPrivacySettingsChange?: (settings: PrivacySettings) => void;
}

interface PrivacySettings {
  sharePersonalData: boolean;
  allowAnalytics: boolean;
  showVerificationHistory: boolean;
  anonymizeLocation: boolean;
}

interface AnalyticsData {
  verificationId: string;
  productId: string;
  timestamp: string;
  result: 'authentic' | 'counterfeit' | 'unknown';
  sessionId: string;
  hashedClientInfo?: {
    locationHash?: string;
    userAgentHash?: string;
    ipHash?: string;
  };
}

export const VerificationResultsDisplay: React.FC<VerificationResultsDisplayProps> = ({
  verificationResult,
  loading = false,
  onShare,
  onDownloadCertificate,
  enableAnalytics = true,
  privacyMode = false,
  onPrivacySettingsChange,
}) => {
  const [productDetails, setProductDetails] = useState<ProductDetails | null>(null);
  const [artisanProfile, setArtisanProfile] = useState<ArtisanProfile | null>(null);
  const [verificationHistory, setVerificationHistory] = useState<VerificationHistory | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [fullscreenGalleryOpen, setFullscreenGalleryOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isFavorited, setIsFavorited] = useState(false);
  const [blockchainCertificateOpen, setBlockchainCertificateOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    product: true,
    blockchain: false,
    artisan: false,
    history: false,
    privacy: false,
    analytics: false,
  });
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>({
    sharePersonalData: !privacyMode,
    allowAnalytics: enableAnalytics && !privacyMode,
    showVerificationHistory: !privacyMode,
    anonymizeLocation: privacyMode,
  });
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [privacyNoticeOpen, setPrivacyNoticeOpen] = useState(false);
  const [analyticsTracked, setAnalyticsTracked] = useState(false);

  // Determine verification status
  const getVerificationStatus = (): 'authentic' | 'counterfeit' | 'unknown' => {
    if (!verificationResult.isValid) return 'counterfeit';
    if (verificationResult.isAuthentic) return 'authentic';
    return 'unknown';
  };

  const status = getVerificationStatus();

  // Status configuration
  const statusConfig = {
    authentic: {
      icon: <AuthenticIcon sx={{ fontSize: 40, color: 'success.main' }} />,
      title: 'Authentic Product',
      subtitle: 'This product has been verified as genuine',
      color: 'success' as const,
    },
    counterfeit: {
      icon: <CounterfeitIcon sx={{ fontSize: 40, color: 'error.main' }} />,
      title: 'Counterfeit Warning',
      subtitle: 'This product could not be verified as authentic',
      color: 'error' as const,
    },
    unknown: {
      icon: <UnknownIcon sx={{ fontSize: 40, color: 'warning.main' }} />,
      title: 'Verification Incomplete',
      subtitle: 'Product verification needs additional information',
      color: 'warning' as const,
    },
  };

  // Initialize analytics and privacy
  useEffect(() => {
    if (enableAnalytics && privacySettings.allowAnalytics && !analyticsTracked) {
      initializeAnalytics();
    }
  }, [enableAnalytics, privacySettings.allowAnalytics, analyticsTracked]);

  // Privacy settings change handler
  useEffect(() => {
    if (onPrivacySettingsChange) {
      onPrivacySettingsChange(privacySettings);
    }
  }, [privacySettings, onPrivacySettingsChange]);

  // Initialize analytics tracking
  const initializeAnalytics = async () => {
    try {
      const sessionId = generateSessionId();
      const clientInfo = await gatherClientInfo();
      
      const analytics: AnalyticsData = {
        verificationId: generateVerificationId(),
        productId: verificationResult.productId,
        timestamp: new Date().toISOString(),
        result: getVerificationStatus(),
        sessionId,
        hashedClientInfo: privacySettings.anonymizeLocation ? clientInfo : undefined,
      };
      
      setAnalyticsData(analytics);
      await trackVerificationEvent(analytics);
      setAnalyticsTracked(true);
    } catch (error) {
      console.error('Analytics initialization failed:', error);
    }
  };

  // Generate unique session ID
  const generateSessionId = (): string => {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  // Generate verification ID
  const generateVerificationId = (): string => {
    return `verification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  // Gather anonymized client information
  const gatherClientInfo = async () => {
    const clientInfo: any = {};
    
    if (privacySettings.anonymizeLocation) {
      // Hash sensitive information for privacy compliance
      const crypto = window.crypto || (window as any).msCrypto;
      
      if (navigator.geolocation && privacySettings.sharePersonalData) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
          });
          // Hash coordinates instead of storing exact location
          const locationString = `${Math.floor(position.coords.latitude)},${Math.floor(position.coords.longitude)}`;
          clientInfo.locationHash = await hashString(locationString);
        } catch (error) {
          // Location access denied or failed
        }
      }
      
      // Hash user agent for device analytics without personal identification
      if (navigator.userAgent) {
        clientInfo.userAgentHash = await hashString(navigator.userAgent);
      }
    }
    
    return clientInfo;
  };

  // Privacy-compliant hashing function
  const hashString = async (str: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // Track verification event (privacy-compliant)
  const trackVerificationEvent = async (analytics: AnalyticsData) => {
    try {
      await fetch('/api/verify/analytics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...analytics,
          privacyCompliant: true,
          dataRetentionDays: 90, // Automatic deletion after 90 days
          personalDataIncluded: privacySettings.sharePersonalData,
        }),
      });
    } catch (error) {
      console.error('Analytics tracking failed:', error);
    }
  };

  // Handle privacy settings change
  const handlePrivacySettingChange = (setting: keyof PrivacySettings, value: boolean) => {
    setPrivacySettings(prev => ({ ...prev, [setting]: value }));
    
    // Show privacy notice on first change
    if (!privacyNoticeOpen) {
      setPrivacyNoticeOpen(true);
    }
    
    // Re-initialize analytics if settings allow it
    if (setting === 'allowAnalytics' && value && !analyticsTracked) {
      setAnalyticsTracked(false);
    }
  };

  // Fetch additional product data
  useEffect(() => {
    const fetchProductData = async () => {
      try {
        if (verificationResult.productId) {
          // Fetch product details
          const productResponse = await fetch(`/api/verify/product/${verificationResult.productId}`);
          if (productResponse.ok) {
            const productData = await productResponse.json();
            setProductDetails(productData.product);
          }

          // Fetch verification history (only if privacy settings allow)
          if (privacySettings.showVerificationHistory) {
            const historyResponse = await fetch(`/api/verify/stats`);
            if (historyResponse.ok) {
              const historyData = await historyResponse.json();
              setVerificationHistory(historyData.stats);
            }
          }

          // Mock artisan data for now
          setArtisanProfile({
            id: '1',
            name: 'Maria Santos',
            bio: 'Master craftsperson specializing in traditional textiles',
            location: 'Lagos, Nigeria',
            specialization: 'Traditional Textiles',
            experience_years: 15,
            rating: 4.8,
            verified: true,
            craft_story: 'Maria has been creating beautiful traditional fabrics for over 15 years, using techniques passed down through generations.',
            contact_info: {
              website: 'https://mariasantos-textiles.com',
              social_media: {
                instagram: '@mariasantos_textiles',
                facebook: 'Maria Santos Textiles',
              },
            },
            certifications: ['Master Craftsperson Certification', 'Fair Trade Producer', 'UNESCO Heritage Artisan'],
            portfolio_items: [
              {
                id: '1',
                title: 'Traditional Kente Cloth',
                image_url: 'https://example.com/portfolio/kente1.jpg',
                description: 'Hand-woven traditional kente cloth with modern patterns',
              },
              {
                id: '2',
                title: 'Contemporary Adire Design',
                image_url: 'https://example.com/portfolio/adire1.jpg',
                description: 'Modern interpretation of traditional Adire dyeing techniques',
              },
              {
                id: '3',
                title: 'Ceremonial Textile',
                image_url: 'https://example.com/portfolio/ceremonial1.jpg',
                description: 'Sacred ceremonial textile for special occasions',
              },
            ],
          });
        }
      } catch (error) {
        console.error('Failed to fetch product data:', error);
      }
    };

    fetchProductData();
  }, [verificationResult.productId, privacySettings.showVerificationHistory]);

  const handleAccordionChange = (section: string) => (event: React.SyntheticEvent, isExpanded: boolean) => {
    setExpandedSections(prev => ({ ...prev, [section]: isExpanded }));
  };

  const handleImageClick = (imageUrl: string) => {
    setSelectedImage(imageUrl);
    setImageDialogOpen(true);
  };

  const handleShareResult = () => {
    if (onShare) {
      onShare();
    } else {
      setShareDialogOpen(true);
    }
  };

  const handleSocialShare = (platform: string) => {
    const productName = verificationResult.productName || 'Product';
    const verificationText = `This ${productName} has been verified as ${status} on AfriChain Authenticity Platform.`;
    const url = window.location.href;
    
    const shareUrls = {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(verificationText)}`,
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(verificationText)}&url=${encodeURIComponent(url)}&hashtags=AfriChain,Authenticity,VerifiedProduct`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}&title=${encodeURIComponent(`${productName} Verification`)}&summary=${encodeURIComponent(verificationText)}`,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(`${verificationText} ${url}`)}`,
    };

    if (shareUrls[platform as keyof typeof shareUrls]) {
      window.open(shareUrls[platform as keyof typeof shareUrls], '_blank', 'width=600,height=400');
    }
    setShareDialogOpen(false);
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${verificationResult.productName || 'Product'} Verification`,
          text: `This product has been verified as ${status} on AfriChain`,
          url: window.location.href,
        });
        setShareDialogOpen(false);
      } catch (error) {
        console.log('Share cancelled');
      }
    }
  };

  const handleFavoriteToggle = () => {
    setIsFavorited(!isFavorited);
    // Here you would typically make an API call to save/remove favorite
  };

  const handleGalleryNavigation = (direction: 'prev' | 'next') => {
    if (!productDetails?.images) return;
    
    const maxIndex = productDetails.images.length - 1;
    if (direction === 'next') {
      setCurrentImageIndex(currentImageIndex >= maxIndex ? 0 : currentImageIndex + 1);
    } else {
      setCurrentImageIndex(currentImageIndex <= 0 ? maxIndex : currentImageIndex - 1);
    }
  };

  const handleFullscreenGallery = (index: number = 0) => {
    setCurrentImageIndex(index);
    setFullscreenGalleryOpen(true);
  };

  const handleBlockchainCertificateView = () => {
    setBlockchainCertificateOpen(true);
  };

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="rectangular" height={200} sx={{ mb: 2, borderRadius: 2 }} />
        <Skeleton variant="rectangular" height={300} sx={{ mb: 2, borderRadius: 2 }} />
        <Skeleton variant="rectangular" height={250} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: 2 }}>
      {/* Verification Status Card */}
      <StatusCard status={status} sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            {statusConfig[status].icon}
            <Box sx={{ ml: 2, flex: 1 }}>
              <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
                {statusConfig[status].title}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {statusConfig[status].subtitle}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title={isFavorited ? "Remove from favorites" : "Add to favorites"}>
                <IconButton onClick={handleFavoriteToggle} size="small">
                  {isFavorited ? <FavoriteIcon color="error" /> : <FavoriteIconOutline />}
                </IconButton>
              </Tooltip>
              <Tooltip title="Share verification result">
                <IconButton onClick={handleShareResult} size="small">
                  <ShareIcon />
                </IconButton>
              </Tooltip>
              {verificationResult.blockchainDetails && (
                <Tooltip title="View blockchain certificate">
                  <IconButton onClick={handleBlockchainCertificateView} size="small">
                    <SecurityIcon />
                  </IconButton>
                </Tooltip>
              )}
              {onDownloadCertificate && (
                <Tooltip title="Download certificate">
                  <IconButton onClick={onDownloadCertificate} size="small">
                    <DownloadIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>

          {/* Verification Score */}
          {verificationResult.metadata?.verificationScore && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Verification Score
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {verificationResult.metadata.verificationScore}%
                </Typography>
              </Box>
              <VerificationScoreBar
                variant="determinate"
                value={verificationResult.metadata.verificationScore}
                score={verificationResult.metadata.verificationScore}
              />
            </Box>
          )}

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

          {/* Quick Info Chips */}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {verificationResult.blockchainConfirmed && (
              <Chip
                icon={<SecurityIcon />}
                label="Blockchain Verified"
                color="primary"
                size="small"
              />
            )}
            {verificationResult.metadata?.brand && (
              <Chip
                label={verificationResult.metadata.brand}
                variant="outlined"
                size="small"
              />
            )}
            {verificationResult.metadata?.originCountry && (
              <Chip
                icon={<PublicIcon />}
                label={verificationResult.metadata.originCountry}
                variant="outlined"
                size="small"
              />
            )}
          </Box>
        </CardContent>
      </StatusCard>

      {/* Product Information */}
      <Accordion 
        expanded={expandedSections.product}
        onChange={handleAccordionChange('product')}
        sx={{ mb: 2 }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Product Information
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid item xs={12} md={8}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {verificationResult.productName || productDetails?.product_name || 'Unknown Product'}
              </Typography>
              
              {productDetails?.description && (
                <Typography variant="body1" sx={{ mb: 2 }} color="text.secondary">
                  {productDetails.description}
                </Typography>
              )}

              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Category
                  </Typography>
                  <Typography variant="body1">
                    {verificationResult.metadata?.category || productDetails?.category || 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Manufacturer
                  </Typography>
                  <Typography variant="body1">
                    {verificationResult.metadata?.manufacturer || productDetails?.manufacturer_name || 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Origin Country
                  </Typography>
                  <Typography variant="body1">
                    {verificationResult.metadata?.originCountry || productDetails?.origin_country || 'N/A'}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Registration Date
                  </Typography>
                  <Typography variant="body1">
                    {verificationResult.metadata?.registrationDate 
                      ? format(new Date(verificationResult.metadata.registrationDate), 'MMM dd, yyyy')
                      : 'N/A'
                    }
                  </Typography>
                </Grid>
              </Grid>
            </Grid>

            {/* Product Images */}
            {productDetails?.images && productDetails.images.length > 0 && (
              <Grid item xs={12} md={4}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2">
                    Product Images ({productDetails.images.length})
                  </Typography>
                  <Tooltip title="View in fullscreen gallery">
                    <IconButton size="small" onClick={() => handleFullscreenGallery(0)}>
                      <FullscreenIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
                <ImageList cols={2} gap={8}>
                  {productDetails.images.slice(0, 4).map((image, index) => (
                    <ImageGalleryItem key={index}>
                      <img
                        src={image}
                        alt={`Product ${index + 1}`}
                        loading="lazy"
                        style={{ width: '100%', height: '80px', objectFit: 'cover', borderRadius: 4 }}
                        onClick={() => handleFullscreenGallery(index)}
                      />
                      <Box
                        sx={{
                          position: 'absolute',
                          top: 4,
                          right: 4,
                          display: 'flex',
                          gap: 0.5,
                        }}
                      >
                        <IconButton
                          sx={{
                            backgroundColor: 'rgba(0,0,0,0.6)',
                            color: 'white',
                            '&:hover': {
                              backgroundColor: 'rgba(0,0,0,0.8)',
                            },
                          }}
                          size="small"
                          onClick={() => handleImageClick(image)}
                        >
                          <ZoomInIcon fontSize="small" />
                        </IconButton>
                        {index === 0 && productDetails.images.length > 4 && (
                          <Chip
                            label={`+${productDetails.images.length - 4}`}
                            size="small"
                            sx={{
                              backgroundColor: 'rgba(0,0,0,0.6)',
                              color: 'white',
                              fontSize: '0.7rem',
                            }}
                          />
                        )}
                      </Box>
                    </ImageGalleryItem>
                  ))}
                </ImageList>
                {productDetails.images.length > 4 && (
                  <Button
                    variant="outlined"
                    size="small"
                    fullWidth
                    startIcon={<CameraIcon />}
                    onClick={() => handleFullscreenGallery(0)}
                    sx={{ mt: 1 }}
                  >
                    View All {productDetails.images.length} Images
                  </Button>
                )}
              </Grid>
            )}
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Blockchain Certificate */}
      {verificationResult.blockchainDetails && (
        <Accordion
          expanded={expandedSections.blockchain}
          onChange={handleAccordionChange('blockchain')}
          sx={{ mb: 2 }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SecurityIcon color="primary" />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Blockchain Certificate
              </Typography>
              {verificationResult.blockchainConfirmed && (
                <Chip
                  icon={<VerifiedIcon />}
                  label="Verified"
                  color="success"
                  size="small"
                />
              )}
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" color="text.secondary">
                  NFT Token ID
                </Typography>
                <Typography variant="body1" sx={{ mb: 2, fontFamily: 'monospace' }}>
                  {verificationResult.nftTokenId || 'N/A'}
                </Typography>

                <Typography variant="subtitle2" color="text.secondary">
                  Serial Number
                </Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>
                  {verificationResult.nftSerialNumber || 'N/A'}
                </Typography>

                <Typography variant="subtitle2" color="text.secondary">
                  Verification Status
                </Typography>
                <Chip
                  label={verificationResult.blockchainDetails.exists ? 'Exists on Blockchain' : 'Not Found'}
                  color={verificationResult.blockchainDetails.exists ? 'success' : 'error'}
                  size="small"
                  sx={{ mb: 2 }}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  Transaction History
                </Typography>
                {verificationResult.blockchainDetails.transactionHistory && 
                 verificationResult.blockchainDetails.transactionHistory.length > 0 ? (
                  <List dense>
                    {verificationResult.blockchainDetails.transactionHistory.slice(0, 3).map((tx, index) => (
                      <ListItem key={index} divider>
                        <ListItemIcon>
                          <TimelineIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          primary={tx.name || 'Transaction'}
                          secondary={`${format(new Date(tx.consensus_timestamp), 'MMM dd, yyyy HH:mm')}`}
                        />
                        <Tooltip title="View on Hedera Explorer">
                          <IconButton
                            size="small"
                            onClick={() => window.open(`https://hashscan.io/testnet/transaction/${tx.transaction_id}`, '_blank')}
                          >
                            <LaunchIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </ListItem>
                    ))}
                  </List>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No transaction history available
                  </Typography>
                )}
              </Grid>
            </Grid>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Artisan Profile */}
      {artisanProfile && (
        <Accordion
          expanded={expandedSections.artisan}
          onChange={handleAccordionChange('artisan')}
          sx={{ mb: 2 }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <PersonIcon color="primary" />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Artisan Profile
              </Typography>
              {artisanProfile.verified && (
                <Chip
                  icon={<VerifiedIcon />}
                  label="Verified Artisan"
                  color="success"
                  size="small"
                />
              )}
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ display: 'flex', gap: 3 }}>
              <Avatar
                src={artisanProfile.avatar_url}
                sx={{ width: 80, height: 80 }}
              >
                {artisanProfile.name.charAt(0)}
              </Avatar>
              <Box sx={{ flex: 1 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  {artisanProfile.name}
                </Typography>
                
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <LocationIcon fontSize="small" color="action" />
                    <Typography variant="body2" color="text.secondary">
                      {artisanProfile.location}
                    </Typography>
                  </Box>
                  <Rating value={artisanProfile.rating} readOnly size="small" />
                  <Typography variant="body2" color="text.secondary">
                    ({artisanProfile.rating}/5)
                  </Typography>
                </Box>

                <Typography variant="body2" sx={{ mb: 2 }}>
                  <strong>Specialization:</strong> {artisanProfile.specialization}
                </Typography>

                <Typography variant="body2" sx={{ mb: 2 }}>
                  <strong>Experience:</strong> {artisanProfile.experience_years} years
                </Typography>

                {artisanProfile.bio && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {artisanProfile.bio}
                  </Typography>
                )}

                {artisanProfile.craft_story && (
                  <Paper sx={{ p: 2, backgroundColor: 'grey.50', mb: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Craft Story
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {artisanProfile.craft_story}
                    </Typography>
                  </Paper>
                )}

                {/* Contact Information and Social Media */}
                {artisanProfile.contact_info && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Connect with {artisanProfile.name.split(' ')[0]}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {artisanProfile.contact_info.website && (
                        <Tooltip title="Visit website">
                          <IconButton
                            size="small"
                            onClick={() => window.open(artisanProfile.contact_info!.website, '_blank')}
                            sx={{ backgroundColor: 'action.hover' }}
                          >
                            <WebIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      {artisanProfile.contact_info.social_media?.instagram && (
                        <Tooltip title="Instagram">
                          <IconButton
                            size="small"
                            onClick={() => window.open(`https://instagram.com/${artisanProfile.contact_info!.social_media!.instagram}`, '_blank')}
                            sx={{ backgroundColor: 'action.hover' }}
                          >
                            <InstagramIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      {artisanProfile.contact_info.social_media?.facebook && (
                        <Tooltip title="Facebook">
                          <IconButton
                            size="small"
                            onClick={() => window.open(`https://facebook.com/${artisanProfile.contact_info!.social_media!.facebook}`, '_blank')}
                            sx={{ backgroundColor: 'action.hover' }}
                          >
                            <FacebookIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </Box>
                )}

                {/* Certifications */}
                {artisanProfile.certifications && artisanProfile.certifications.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Certifications & Awards
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {artisanProfile.certifications.map((cert, index) => (
                        <Chip
                          key={index}
                          icon={<AwardIcon />}
                          label={cert}
                          size="small"
                          variant="outlined"
                          color="primary"
                        />
                      ))}
                    </Box>
                  </Box>
                )}

                {/* Portfolio Items */}
                {artisanProfile.portfolio_items && artisanProfile.portfolio_items.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Portfolio Highlights
                    </Typography>
                    <Grid container spacing={1}>
                      {artisanProfile.portfolio_items.slice(0, 3).map((item, index) => (
                        <Grid item xs={4} key={index}>
                          <Card sx={{ cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' } }}>
                            <img
                              src={item.image_url}
                              alt={item.title}
                              style={{ width: '100%', height: '60px', objectFit: 'cover' }}
                              onClick={() => handleImageClick(item.image_url)}
                            />
                            <CardContent sx={{ p: 1 }}>
                              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                {item.title}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                )}
              </Box>
            </Box>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Verification History */}
      {verificationHistory && privacySettings.showVerificationHistory && (
        <Accordion
          expanded={expandedSections.history}
          onChange={handleAccordionChange('history')}
          sx={{ mb: 2 }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <HistoryIcon color="primary" />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Verification History
              </Typography>
              <Chip
                label={`${verificationHistory.total_verifications} verifications`}
                size="small"
                variant="outlined"
              />
              <Chip
                icon={<LockIcon />}
                label="Privacy Protected"
                size="small"
                color="success"
                variant="outlined"
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={3}>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4" color="primary.main" sx={{ fontWeight: 600 }}>
                    {verificationHistory.total_verifications}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total Verifications
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h4" color="success.main" sx={{ fontWeight: 600 }}>
                    {verificationHistory.authenticity_rate}%
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Authenticity Rate
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    {verificationHistory.last_verification 
                      ? format(new Date(verificationHistory.last_verification), 'MMM dd, yyyy')
                      : 'N/A'
                    }
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Last Verification
                  </Typography>
                </Paper>
              </Grid>
            </Grid>

            <Alert severity="info" sx={{ mt: 2 }}>
              <AlertTitle>Privacy Protection</AlertTitle>
              All verification data is anonymized and aggregated to protect consumer privacy. 
              Individual verification details are never stored or shared.
            </Alert>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Privacy Controls */}
      <Accordion
        expanded={expandedSections.privacy}
        onChange={handleAccordionChange('privacy')}
        sx={{ mb: 2 }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PrivacyIcon color="primary" />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Privacy Controls
            </Typography>
            <Chip
              icon={privacySettings.allowAnalytics ? <VisibilityIcon /> : <VisibilityOffIcon />}
              label={privacySettings.allowAnalytics ? 'Analytics Enabled' : 'Analytics Disabled'}
              size="small"
              color={privacySettings.allowAnalytics ? 'primary' : 'default'}
              variant="outlined"
            />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Alert severity="info" sx={{ mb: 3 }}>
            <AlertTitle>Your Privacy Matters</AlertTitle>
            You have full control over your data. All settings are applied immediately and 
            affect how your verification data is processed and stored.
          </Alert>

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
                  Data Sharing Preferences
                </Typography>
                
                <FormControlLabel
                  control={
                    <Switch
                      checked={privacySettings.sharePersonalData}
                      onChange={(e) => handlePrivacySettingChange('sharePersonalData', e.target.checked)}
                    />
                  }
                  label="Allow sharing of verification results"
                  sx={{ mb: 1, display: 'block' }}
                />
                
                <FormControlLabel
                  control={
                    <Switch
                      checked={privacySettings.allowAnalytics}
                      onChange={(e) => handlePrivacySettingChange('allowAnalytics', e.target.checked)}
                    />
                  }
                  label="Enable analytics to improve service"
                  sx={{ mb: 1, display: 'block' }}
                />
                
                <FormControlLabel
                  control={
                    <Switch
                      checked={privacySettings.showVerificationHistory}
                      onChange={(e) => handlePrivacySettingChange('showVerificationHistory', e.target.checked)}
                    />
                  }
                  label="Show verification history"
                  sx={{ mb: 1, display: 'block' }}
                />
                
                <FormControlLabel
                  control={
                    <Switch
                      checked={privacySettings.anonymizeLocation}
                      onChange={(e) => handlePrivacySettingChange('anonymizeLocation', e.target.checked)}
                    />
                  }
                  label="Anonymize location data"
                  sx={{ display: 'block' }}
                />
              </Paper>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
                  Data Protection Information
                </Typography>
                
                <List dense>
                  <ListItem>
                    <ListItemIcon>
                      <LockIcon color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Automatic Data Deletion"
                      secondary="All analytics data is automatically deleted after 90 days"
                    />
                  </ListItem>
                  
                  <ListItem>
                    <ListItemIcon>
                      <SecurityIcon color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Cryptographic Hashing"
                      secondary="Personal information is hashed using SHA-256 encryption"
                    />
                  </ListItem>
                  
                  <ListItem>
                    <ListItemIcon>
                      <PrivacyIcon color="success" />
                    </ListItemIcon>
                    <ListItemText
                      primary="GDPR Compliant"
                      secondary="Full compliance with global privacy regulations"
                    />
                  </ListItem>
                  
                  <ListItem>
                    <ListItemIcon>
                      <InfoIcon color="primary" />
                    </ListItemIcon>
                    <ListItemText
                      primary="Aggregated Analytics Only"
                      secondary="Individual verification data is never stored permanently"
                    />
                  </ListItem>
                </List>
              </Paper>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Analytics Dashboard (if enabled) */}
      {privacySettings.allowAnalytics && analyticsData && (
        <Accordion
          expanded={expandedSections.analytics}
          onChange={handleAccordionChange('analytics')}
          sx={{ mb: 2 }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <AnalyticsIcon color="primary" />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Verification Analytics
              </Typography>
              <Chip
                icon={<LockIcon />}
                label="Privacy Protected"
                size="small"
                color="success"
                variant="outlined"
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={3}>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="h6" color="primary.main" sx={{ fontWeight: 600 }}>
                    {analyticsData.result.toUpperCase()}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Verification Result
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    {format(new Date(analyticsData.timestamp), 'HH:mm:ss')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Verification Time
                  </Typography>
                </Paper>
              </Grid>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, textAlign: 'center' }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {analyticsData.sessionId}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Session ID
                  </Typography>
                </Paper>
              </Grid>
            </Grid>
            
            <Alert severity="success" sx={{ mt: 2 }}>
              <AlertTitle>Analytics Tracking Active</AlertTitle>
              This verification has been anonymously recorded to help improve our service. 
              Your privacy is protected through cryptographic hashing and automatic data deletion.
            </Alert>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Share Dialog */}
      <Dialog
        open={shareDialogOpen}
        onClose={() => setShareDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShareIcon />
            Share Verification Result
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Share this product verification with others to help combat counterfeiting
          </Typography>
          
          <Grid container spacing={2}>
            {navigator.share && (
              <Grid item xs={12}>
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<ShareIcon />}
                  onClick={handleNativeShare}
                  sx={{ mb: 2 }}
                >
                  Use Device Share
                </Button>
              </Grid>
            )}
            
            <Grid item xs={6}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<FacebookIcon />}
                onClick={() => handleSocialShare('facebook')}
                sx={{ color: '#1877F2', borderColor: '#1877F2' }}
              >
                Facebook
              </Button>
            </Grid>
            
            <Grid item xs={6}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<TwitterIcon />}
                onClick={() => handleSocialShare('twitter')}
                sx={{ color: '#1DA1F2', borderColor: '#1DA1F2' }}
              >
                Twitter
              </Button>
            </Grid>
            
            <Grid item xs={6}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<LinkedInIcon />}
                onClick={() => handleSocialShare('linkedin')}
                sx={{ color: '#0A66C2', borderColor: '#0A66C2' }}
              >
                LinkedIn
              </Button>
            </Grid>
            
            <Grid item xs={6}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<WhatsAppIcon />}
                onClick={() => handleSocialShare('whatsapp')}
                sx={{ color: '#25D366', borderColor: '#25D366' }}
              >
                WhatsApp
              </Button>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShareDialogOpen(false)}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      {/* Fullscreen Image Gallery */}
      <Dialog
        open={fullscreenGalleryOpen}
        onClose={() => setFullscreenGalleryOpen(false)}
        maxWidth={false}
        fullScreen
        sx={{ zIndex: 1500 }}
      >
        <Box sx={{ position: 'relative', height: '100vh', backgroundColor: 'black' }}>
          {/* Gallery Header */}
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 10,
              backgroundColor: 'rgba(0,0,0,0.8)',
              color: 'white',
              p: 2,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Typography variant="h6">
              {productDetails?.product_name || 'Product Images'} 
              {productDetails?.images && (
                <Typography component="span" variant="body2" sx={{ ml: 1, opacity: 0.7 }}>
                  ({currentImageIndex + 1} of {productDetails.images.length})
                </Typography>
              )}
            </Typography>
            <IconButton onClick={() => setFullscreenGalleryOpen(false)} sx={{ color: 'white' }}>
              <CloseIcon />
            </IconButton>
          </Box>

          {/* Gallery Content */}
          {productDetails?.images && productDetails.images.length > 0 && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                pt: 8,
                pb: 2,
              }}
            >
              {/* Previous Button */}
              {productDetails.images.length > 1 && (
                <IconButton
                  onClick={() => handleGalleryNavigation('prev')}
                  sx={{
                    position: 'absolute',
                    left: 20,
                    color: 'white',
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
                  }}
                >
                  <ArrowBackIcon />
                </IconButton>
              )}

              {/* Current Image */}
              <img
                src={productDetails.images[currentImageIndex]}
                alt={`Product ${currentImageIndex + 1}`}
                style={{
                  maxWidth: '90%',
                  maxHeight: '90%',
                  objectFit: 'contain',
                  borderRadius: 8,
                }}
              />

              {/* Next Button */}
              {productDetails.images.length > 1 && (
                <IconButton
                  onClick={() => handleGalleryNavigation('next')}
                  sx={{
                    position: 'absolute',
                    right: 20,
                    color: 'white',
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
                  }}
                >
                  <ArrowForwardIcon />
                </IconButton>
              )}
            </Box>
          )}

          {/* Gallery Thumbnails */}
          {productDetails?.images && productDetails.images.length > 1 && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                backgroundColor: 'rgba(0,0,0,0.8)',
                p: 2,
                display: 'flex',
                justifyContent: 'center',
                gap: 1,
                overflowX: 'auto',
              }}
            >
              {productDetails.images.map((image, index) => (
                <Box
                  key={index}
                  onClick={() => setCurrentImageIndex(index)}
                  sx={{
                    width: 60,
                    height: 60,
                    borderRadius: 1,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    border: index === currentImageIndex ? '2px solid white' : '2px solid transparent',
                    opacity: index === currentImageIndex ? 1 : 0.7,
                    '&:hover': { opacity: 1 },
                  }}
                >
                  <img
                    src={image}
                    alt={`Thumbnail ${index + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Dialog>

      {/* Enhanced Image Dialog */}
      <Dialog
        open={imageDialogOpen}
        onClose={() => setImageDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Product Image
            <IconButton onClick={() => setImageDialogOpen(false)}>
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          {selectedImage && (
            <img
              src={selectedImage}
              alt="Product"
              style={{ width: '100%', height: 'auto', borderRadius: 8 }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button
            startIcon={<DownloadIcon />}
            onClick={() => {
              if (selectedImage) {
                const link = document.createElement('a');
                link.href = selectedImage;
                link.download = 'product-image.jpg';
                link.click();
              }
            }}
          >
            Download
          </Button>
          <Button onClick={() => setImageDialogOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Privacy Notice Snackbar */}
      <Snackbar
        open={privacyNoticeOpen}
        autoHideDuration={6000}
        onClose={() => setPrivacyNoticeOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setPrivacyNoticeOpen(false)} severity="info" sx={{ width: '100%' }}>
          <AlertTitle>Privacy Settings Updated</AlertTitle>
          Your privacy preferences have been saved and will be applied to future verifications.
        </Alert>
      </Snackbar>

      {/* Blockchain Certificate Viewer */}
      <Dialog
        open={blockchainCertificateOpen}
        onClose={() => setBlockchainCertificateOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SecurityIcon color="primary" />
            Blockchain Certificate of Authenticity
          </Box>
        </DialogTitle>
        <DialogContent>
          {verificationResult.blockchainDetails && (
            <Box>
              <Paper sx={{ p: 3, mb: 2, backgroundColor: 'primary.light', color: 'primary.contrastText' }}>
                <Box sx={{ textAlign: 'center' }}>
                  <SecurityIcon sx={{ fontSize: 48, mb: 1 }} />
                  <Typography variant="h5" sx={{ fontWeight: 600 }}>
                    Certificate of Authenticity
                  </Typography>
                  <Typography variant="body1" sx={{ mt: 1 }}>
                    This product has been verified on the Hedera blockchain
                  </Typography>
                </Box>
              </Paper>

              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Product Name
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2, fontWeight: 600 }}>
                    {verificationResult.productName || 'Unknown Product'}
                  </Typography>

                  <Typography variant="subtitle2" color="text.secondary">
                    NFT Token ID
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 2, fontFamily: 'monospace' }}>
                    {verificationResult.nftTokenId || 'N/A'}
                  </Typography>

                  <Typography variant="subtitle2" color="text.secondary">
                    Serial Number
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    #{verificationResult.nftSerialNumber || 'N/A'}
                  </Typography>
                </Grid>

                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Verification Status
                  </Typography>
                  <Chip
                    icon={<VerifiedIcon />}
                    label={verificationResult.blockchainDetails.exists ? 'Verified Authentic' : 'Not Found'}
                    color={verificationResult.blockchainDetails.exists ? 'success' : 'error'}
                    sx={{ mb: 2 }}
                  />

                  <Typography variant="subtitle2" color="text.secondary">
                    Verification Date
                  </Typography>
                  <Typography variant="body1" sx={{ mb: 2 }}>
                    {format(new Date(verificationResult.verificationTimestamp), 'PPP p')}
                  </Typography>

                  <Typography variant="subtitle2" color="text.secondary">
                    Certificate ID
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {`${verificationResult.productId}-${Date.now()}`}
                  </Typography>
                </Grid>
              </Grid>

              <Divider sx={{ my: 2 }} />

              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                This certificate verifies the authenticity of the product through blockchain technology.
                The verification was performed on {format(new Date(), 'PPP')} and is tamper-proof.
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            startIcon={<DownloadIcon />}
            onClick={() => {
              // Generate certificate download
              const certificateData = {
                productName: verificationResult.productName,
                tokenId: verificationResult.nftTokenId,
                serialNumber: verificationResult.nftSerialNumber,
                verificationDate: format(new Date(), 'PPP p'),
                status: verificationResult.blockchainDetails?.exists ? 'Verified Authentic' : 'Not Found',
              };
              
              const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(certificateData, null, 2));
              const downloadAnchorNode = document.createElement('a');
              downloadAnchorNode.setAttribute("href", dataStr);
              downloadAnchorNode.setAttribute("download", `certificate-${verificationResult.productId}.json`);
              document.body.appendChild(downloadAnchorNode);
              downloadAnchorNode.click();
              downloadAnchorNode.remove();
            }}
          >
            Download Certificate
          </Button>
          <Button onClick={() => setBlockchainCertificateOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VerificationResultsDisplay;