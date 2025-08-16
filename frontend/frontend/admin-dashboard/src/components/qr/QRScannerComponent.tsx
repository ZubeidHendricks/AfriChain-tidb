import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  Alert,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Stack,
} from '@mui/material';
import {
  QrCodeScanner as QRIcon,
  FlashOn as FlashOnIcon,
  FlashOff as FlashOffIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  KeyboardArrowUp as KeyboardIcon,
  CameraAlt as CameraIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import QrScanner from 'qr-scanner';

interface QRScannerComponentProps {
  onScan: (result: string) => void;
  onError?: (error: string) => void;
  enabled?: boolean;
  className?: string;
}

interface ScanResult {
  data: string;
  timestamp: number;
  confidence?: number;
}

export const QRScannerComponent: React.FC<QRScannerComponentProps> = ({
  onScan,
  onError,
  enabled = true,
  className,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const qrScannerRef = useRef<QrScanner | null>(null);
  
  const [isScanning, setIsScanning] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasFlash, setHasFlash] = useState(false);
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [cameras, setCameras] = useState<QrScanner.Camera[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);

  // Initialize QR Scanner
  const initializeScanner = useCallback(async () => {
    if (!videoRef.current || !enabled) return;

    try {
      // Check for camera permissions
      const hasCamera = await QrScanner.hasCamera();
      if (!hasCamera) {
        setError('No camera found on this device');
        setHasPermission(false);
        return;
      }

      // Get available cameras
      const availableCameras = await QrScanner.listCameras();
      setCameras(availableCameras);

      if (availableCameras.length === 0) {
        setError('No cameras available');
        setHasPermission(false);
        return;
      }

      // Use the selected camera or default to the first one
      const cameraToUse = selectedCamera 
        ? availableCameras.find(cam => cam.id === selectedCamera) || availableCameras[0]
        : availableCameras[0];

      // Create QR Scanner instance
      const scanner = new QrScanner(
        videoRef.current,
        (result: QrScanner.ScanResult) => {
          const scanResult: ScanResult = {
            data: result.data,
            timestamp: Date.now(),
            confidence: result.cornerPoints?.length || 0,
          };

          setScanHistory(prev => [scanResult, ...prev.slice(0, 9)]); // Keep last 10 scans
          onScan(result.data);
        },
        {
          highlightScanRegion: true,
          highlightCodeOutline: true,
          preferredCamera: cameraToUse.id,
          maxScansPerSecond: 5,
        }
      );

      qrScannerRef.current = scanner;

      // Check if flash is available
      const flashSupported = await scanner.hasFlash();
      setHasFlash(flashSupported);

      setHasPermission(true);
      setError(null);
    } catch (err) {
      console.error('Error initializing QR scanner:', err);
      setError('Failed to initialize camera. Please ensure camera permissions are granted.');
      setHasPermission(false);
      onError?.(err instanceof Error ? err.message : 'Scanner initialization failed');
    }
  }, [enabled, onScan, onError, selectedCamera]);

  // Start scanning
  const startScanning = useCallback(async () => {
    if (!qrScannerRef.current || !hasPermission) return;

    try {
      await qrScannerRef.current.start();
      setIsScanning(true);
      setError(null);
    } catch (err) {
      console.error('Error starting scanner:', err);
      setError('Failed to start camera');
      onError?.(err instanceof Error ? err.message : 'Failed to start scanning');
    }
  }, [hasPermission, onError]);

  // Stop scanning
  const stopScanning = useCallback(() => {
    if (qrScannerRef.current) {
      qrScannerRef.current.stop();
      setIsScanning(false);
      setIsFlashOn(false);
    }
  }, []);

  // Toggle flash
  const toggleFlash = useCallback(async () => {
    if (!qrScannerRef.current || !hasFlash) return;

    try {
      const newFlashState = !isFlashOn;
      await qrScannerRef.current.setFlash(newFlashState);
      setIsFlashOn(newFlashState);
    } catch (err) {
      console.error('Error toggling flash:', err);
      setError('Failed to toggle flash');
    }
  }, [hasFlash, isFlashOn]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!videoRef.current) return;

    if (!isFullscreen) {
      videoRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  // Handle camera change
  const handleCameraChange = useCallback(async (cameraId: string) => {
    if (!qrScannerRef.current) return;

    const wasScanning = isScanning;
    if (wasScanning) {
      stopScanning();
    }

    try {
      await qrScannerRef.current.setCamera(cameraId);
      setSelectedCamera(cameraId);
      
      if (wasScanning) {
        setTimeout(startScanning, 100);
      }
    } catch (err) {
      console.error('Error changing camera:', err);
      setError('Failed to switch camera');
    }
  }, [isScanning, startScanning, stopScanning]);

  // Handle manual entry
  const handleManualEntry = useCallback(() => {
    if (manualCode.trim()) {
      const scanResult: ScanResult = {
        data: manualCode.trim(),
        timestamp: Date.now(),
      };
      setScanHistory(prev => [scanResult, ...prev.slice(0, 9)]);
      onScan(manualCode.trim());
      setManualCode('');
      setShowManualEntry(false);
    }
  }, [manualCode, onScan]);

  // Initialize scanner on mount
  useEffect(() => {
    initializeScanner();
    
    return () => {
      if (qrScannerRef.current) {
        qrScannerRef.current.destroy();
      }
    };
  }, [initializeScanner]);

  // Handle fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  if (!enabled) {
    return (
      <Card className={className}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            QR Scanner Disabled
          </Typography>
          <Typography color="text.secondary">
            QR code scanning is currently disabled.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  if (hasPermission === null) {
    return (
      <Card className={className}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <QRIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            Initializing Scanner...
          </Typography>
          <Typography color="text.secondary">
            Checking camera permissions and availability...
          </Typography>
        </CardContent>
      </Card>
    );
  }

  if (hasPermission === false) {
    return (
      <Card className={className}>
        <CardContent>
          <Typography variant="h6" gutterBottom color="error">
            Camera Access Required
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Typography color="text.secondary" paragraph>
            To scan QR codes, please grant camera permissions and refresh the page.
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={initializeScanner} startIcon={<RefreshIcon />}>
              Retry
            </Button>
            <Button variant="outlined" onClick={() => setShowManualEntry(true)} startIcon={<KeyboardIcon />}>
              Enter Manually
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Box className={className}>
      <Card>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h6">
              <QRIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
              QR Code Scanner
            </Typography>
            <Stack direction="row" spacing={1}>
              {cameras.length > 1 && (
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>Camera</InputLabel>
                  <Select
                    value={selectedCamera}
                    label="Camera"
                    onChange={(e) => handleCameraChange(e.target.value)}
                  >
                    {cameras.map((camera) => (
                      <MenuItem key={camera.id} value={camera.id}>
                        {camera.label || `Camera ${camera.id.slice(-4)}`}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <Button
                variant="outlined"
                size="small"
                onClick={() => setShowManualEntry(true)}
                startIcon={<KeyboardIcon />}
              >
                Manual Entry
              </Button>
            </Stack>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <Box position="relative" mb={2}>
            <video
              ref={videoRef}
              style={{
                width: '100%',
                maxHeight: '400px',
                backgroundColor: '#000',
                borderRadius: '8px',
                objectFit: 'cover',
              }}
              playsInline
              muted
            />
            
            {/* Camera Controls Overlay */}
            <Box
              position="absolute"
              top={8}
              right={8}
              display="flex"
              flexDirection="column"
              gap={1}
            >
              {hasFlash && (
                <IconButton
                  size="small"
                  onClick={toggleFlash}
                  sx={{
                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                    color: 'white',
                    '&:hover': {
                      backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    },
                  }}
                >
                  {isFlashOn ? <FlashOnIcon /> : <FlashOffIcon />}
                </IconButton>
              )}
              <IconButton
                size="small"
                onClick={toggleFullscreen}
                sx={{
                  backgroundColor: 'rgba(0, 0, 0, 0.6)',
                  color: 'white',
                  '&:hover': {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                  },
                }}
              >
                {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </IconButton>
            </Box>

            {/* Scanning Status */}
            <Box
              position="absolute"
              bottom={8}
              left={8}
              right={8}
              display="flex"
              justifyContent="center"
            >
              <Chip
                icon={<CameraIcon />}
                label={isScanning ? 'Scanning...' : 'Camera Ready'}
                color={isScanning ? 'primary' : 'default'}
                variant={isScanning ? 'filled' : 'outlined'}
                sx={{
                  backgroundColor: isScanning ? 'primary.main' : 'rgba(255, 255, 255, 0.9)',
                  color: isScanning ? 'white' : 'text.primary',
                }}
              />
            </Box>
          </Box>

          {/* Control Buttons */}
          <Stack direction="row" spacing={1} justifyContent="center">
            {!isScanning ? (
              <Button
                variant="contained"
                onClick={startScanning}
                startIcon={<QRIcon />}
                size="large"
              >
                Start Scanning
              </Button>
            ) : (
              <Button
                variant="outlined"
                onClick={stopScanning}
                size="large"
              >
                Stop Scanning
              </Button>
            )}
          </Stack>

          {/* Recent Scans History */}
          {scanHistory.length > 0 && (
            <Box mt={3}>
              <Typography variant="subtitle2" gutterBottom>
                Recent Scans
              </Typography>
              <Stack spacing={1}>
                {scanHistory.slice(0, 3).map((scan, index) => (
                  <Box
                    key={index}
                    p={1}
                    border={1}
                    borderColor="divider"
                    borderRadius={1}
                    bgcolor="grey.50"
                  >
                    <Typography variant="body2" noWrap>
                      {scan.data}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(scan.timestamp).toLocaleTimeString()}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Manual Entry Dialog */}
      <Dialog open={showManualEntry} onClose={() => setShowManualEntry(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Manual QR Code Entry</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" paragraph>
            If you're having trouble scanning the QR code, you can enter the code manually below.
          </Typography>
          <TextField
            fullWidth
            label="QR Code Data"
            placeholder="Enter the QR code content..."
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            multiline
            rows={3}
            autoFocus
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowManualEntry(false)}>Cancel</Button>
          <Button 
            onClick={handleManualEntry} 
            variant="contained"
            disabled={!manualCode.trim()}
          >
            Submit
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default QRScannerComponent;