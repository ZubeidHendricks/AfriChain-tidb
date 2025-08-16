/**
 * Real-Time Currency Conversion Service
 * 
 * Advanced real-time currency conversion system featuring:
 * - WebSocket-based live rate streaming and updates
 * - Real-time conversion calculations with caching
 * - Rate alert system with threshold-based notifications
 * - Live rate broadcasting to connected clients
 * - Conversion history and analytics
 * - Rate arbitrage and opportunity detection
 * - High-frequency update optimization
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import Database from '../config/database';
import { exchangeRateService, ExchangeRateData, CrossRateCalculation } from './exchangeRateService';

export interface RealTimeConversionRequest {
  conversionId: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  clientId: string;
  sessionId?: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  requestedAt: string;
}

export interface RealTimeConversionResult {
  conversionId: string;
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  convertedAmount: number;
  exchangeRate: number;
  rateAge: number; // milliseconds since rate was fetched
  confidence: number;
  calculatedAt: string;
  rateTimestamp: string;
  intermediateRates?: { [key: string]: number };
  fees?: {
    conversionFeePercent: number;
    conversionFeeFixed: number;
    totalFees: number;
  };
}

export interface RateAlert {
  alertId: string;
  clientId: string;
  sourcePair: string;
  alertType: 'price_above' | 'price_below' | 'change_percent' | 'volatility_spike' | 'arbitrage_opportunity';
  threshold: number;
  currentValue: number;
  triggeredAt: string;
  alertMessage: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  metadata?: any;
}

export interface ClientSubscription {
  clientId: string;
  socketId: string;
  subscribedPairs: string[];
  alertThresholds: { [pair: string]: RateAlert[] };
  connectionTime: string;
  lastActivity: string;
  conversionHistory: RealTimeConversionRequest[];
  sessionMetadata?: any;
}

export interface RateStreamData {
  sourcePair: string;
  rate: number;
  bid?: number;
  ask?: number;
  spread?: number;
  change24h: number;
  changePercent24h: number;
  volume24h?: number;
  timestamp: string;
  source: string;
  confidence: number;
  marketStatus: 'open' | 'closed' | 'limited';
}

export interface ConversionStatistics {
  totalConversions: number;
  totalVolume: { [currency: string]: number };
  averageConversionSize: number;
  popularPairs: { pair: string; count: number; volume: number }[];
  clientActivity: { [clientId: string]: number };
  rateAccuracy: number;
  averageLatency: number;
  uptimePercent: number;
}

export interface ArbitrageOpportunity {
  opportunityId: string;
  baseCurrency: string;
  targetCurrency: string;
  pathCurrencies: string[];
  exchangeRates: number[];
  arbitragePercent: number;
  potentialProfit: number;
  riskLevel: 'low' | 'medium' | 'high';
  detectedAt: string;
  expirationEstimate: string;
  minimumAmount: number;
  maximumAmount: number;
}

export class RealTimeCurrencyConversionService extends EventEmitter {
  private db: Database;
  private io: SocketIOServer;
  private clients: Map<string, ClientSubscription> = new Map();
  private activeConversions: Map<string, RealTimeConversionRequest> = new Map();
  private conversionHistory: RealTimeConversionRequest[] = [];
  private rateCache: Map<string, { rate: ExchangeRateData; cachedAt: number }> = new Map();
  private alertSubscriptions: Map<string, RateAlert[]> = new Map();
  private streamingTimers: Map<string, NodeJS.Timeout> = new Map();
  private arbitrageOpportunities: Map<string, ArbitrageOpportunity> = new Map();

  private readonly SUPPORTED_CURRENCIES = ['HBAR', 'USD', 'KES'];
  private readonly RATE_CACHE_DURATION = 5000; // 5 seconds
  private readonly STREAMING_INTERVAL = 1000; // 1 second
  private readonly MAX_CONVERSION_HISTORY = 1000;
  private readonly ARBITRAGE_DETECTION_INTERVAL = 30000; // 30 seconds

  constructor(httpServer: HttpServer) {
    super();
    this.db = Database.getInstance();
    this.setupSocketServer(httpServer);
    this.startRateStreaming();
    this.startArbitrageDetection();
    this.setupEventListeners();
  }

  /**
   * Perform real-time currency conversion
   */
  async performRealTimeConversion(request: RealTimeConversionRequest): Promise<RealTimeConversionResult> {
    try {
      const startTime = Date.now();

      // Validate currencies
      if (!this.SUPPORTED_CURRENCIES.includes(request.fromCurrency) || 
          !this.SUPPORTED_CURRENCIES.includes(request.toCurrency)) {
        throw new Error(`Unsupported currency pair: ${request.fromCurrency}/${request.toCurrency}`);
      }

      // Check cache for recent rate
      const cacheKey = `${request.fromCurrency}/${request.toCurrency}`;
      const cachedRate = this.rateCache.get(cacheKey);
      const now = Date.now();

      let exchangeRate: number;
      let rateData: ExchangeRateData;
      let rateAge: number;

      if (cachedRate && (now - cachedRate.cachedAt) < this.RATE_CACHE_DURATION) {
        // Use cached rate
        rateData = cachedRate.rate;
        exchangeRate = rateData.rate;
        rateAge = now - cachedRate.cachedAt;
      } else {
        // Fetch fresh rate
        const crossRateCalc = await exchangeRateService.calculateCrossRate(
          request.fromCurrency,
          request.toCurrency,
          1 // Get rate for 1 unit
        );
        
        exchangeRate = crossRateCalc.exchangeRate;
        rateAge = 0;
        
        // Create rate data structure
        rateData = {
          sourcePair: cacheKey,
          rate: exchangeRate,
          source: 'real-time-conversion',
          timestamp: new Date().toISOString(),
          validUntil: new Date(now + this.RATE_CACHE_DURATION).toISOString(),
          confidence: crossRateCalc.confidence,
        };

        // Cache the rate
        this.rateCache.set(cacheKey, { rate: rateData, cachedAt: now });
      }

      // Calculate conversion
      const convertedAmount = request.amount * exchangeRate;
      
      // Calculate fees (mock implementation)
      const fees = this.calculateConversionFees(request.amount, convertedAmount, request.fromCurrency, request.toCurrency);

      const result: RealTimeConversionResult = {
        conversionId: request.conversionId,
        fromCurrency: request.fromCurrency,
        toCurrency: request.toCurrency,
        amount: request.amount,
        convertedAmount,
        exchangeRate,
        rateAge,
        confidence: rateData.confidence,
        calculatedAt: new Date().toISOString(),
        rateTimestamp: rateData.timestamp,
        fees,
      };

      // Store conversion
      this.activeConversions.set(request.conversionId, request);
      this.conversionHistory.push(request);

      // Trim history if needed
      if (this.conversionHistory.length > this.MAX_CONVERSION_HISTORY) {
        this.conversionHistory = this.conversionHistory.slice(-this.MAX_CONVERSION_HISTORY);
      }

      // Emit conversion event
      this.emit('conversionCompleted', { request, result });

      // Broadcast to subscribed clients
      this.broadcastConversionUpdate(result);

      const processingTime = Date.now() - startTime;
      console.log('Real-time conversion completed:', {
        conversionId: request.conversionId,
        pair: `${request.fromCurrency}/${request.toCurrency}`,
        amount: request.amount,
        convertedAmount,
        exchangeRate,
        rateAge,
        processingTime: `${processingTime}ms`,
      });

      return result;

    } catch (error) {
      console.error('Real-time conversion failed:', error);
      throw new Error(`Real-time conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Subscribe client to real-time rate updates
   */
  subscribeToRateUpdates(
    clientId: string, 
    socketId: string, 
    currencyPairs: string[],
    alertThresholds?: { [pair: string]: RateAlert[] }
  ): void {
    try {
      // Validate currency pairs
      const validPairs = currencyPairs.filter(pair => {
        const [from, to] = pair.split('/');
        return this.SUPPORTED_CURRENCIES.includes(from) && this.SUPPORTED_CURRENCIES.includes(to);
      });

      if (validPairs.length === 0) {
        throw new Error('No valid currency pairs provided');
      }

      const subscription: ClientSubscription = {
        clientId,
        socketId,
        subscribedPairs: validPairs,
        alertThresholds: alertThresholds || {},
        connectionTime: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        conversionHistory: [],
      };

      this.clients.set(clientId, subscription);

      // Set up alerts if provided
      if (alertThresholds) {
        for (const [pair, alerts] of Object.entries(alertThresholds)) {
          if (!this.alertSubscriptions.has(pair)) {
            this.alertSubscriptions.set(pair, []);
          }
          this.alertSubscriptions.get(pair)!.push(...alerts);
        }
      }

      console.log('Client subscribed to rate updates:', {
        clientId,
        subscribedPairs: validPairs,
        alertCount: Object.keys(alertThresholds || {}).length,
      });

      // Send initial rates
      this.sendInitialRatesToClient(clientId);

      this.emit('clientSubscribed', { clientId, subscription });

    } catch (error) {
      console.error('Failed to subscribe client to rate updates:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe client from rate updates
   */
  unsubscribeFromRateUpdates(clientId: string): void {
    try {
      const subscription = this.clients.get(clientId);
      if (!subscription) {
        console.warn('Client not found for unsubscription:', clientId);
        return;
      }

      // Remove alert subscriptions
      for (const pair of subscription.subscribedPairs) {
        const alerts = this.alertSubscriptions.get(pair);
        if (alerts) {
          const filteredAlerts = alerts.filter(alert => alert.clientId !== clientId);
          if (filteredAlerts.length === 0) {
            this.alertSubscriptions.delete(pair);
          } else {
            this.alertSubscriptions.set(pair, filteredAlerts);
          }
        }
      }

      this.clients.delete(clientId);

      console.log('Client unsubscribed from rate updates:', clientId);
      this.emit('clientUnsubscribed', { clientId, subscription });

    } catch (error) {
      console.error('Failed to unsubscribe client:', error);
    }
  }

  /**
   * Get current conversion statistics
   */
  async getConversionStatistics(timeframe: '1h' | '24h' | '7d' = '24h'): Promise<ConversionStatistics> {
    try {
      // Calculate timeframe window
      const now = Date.now();
      let windowMs: number;
      
      switch (timeframe) {
        case '1h':
          windowMs = 60 * 60 * 1000;
          break;
        case '24h':
          windowMs = 24 * 60 * 60 * 1000;
          break;
        case '7d':
          windowMs = 7 * 24 * 60 * 60 * 1000;
          break;
      }

      const cutoffTime = new Date(now - windowMs);

      // Filter conversions within timeframe
      const recentConversions = this.conversionHistory.filter(conv => 
        new Date(conv.requestedAt) >= cutoffTime
      );

      // Calculate statistics
      const totalConversions = recentConversions.length;
      const totalVolume: { [currency: string]: number } = {};
      const pairCounts: { [pair: string]: { count: number; volume: number } } = {};
      const clientActivity: { [clientId: string]: number } = {};

      for (const conversion of recentConversions) {
        // Total volume by currency
        if (!totalVolume[conversion.fromCurrency]) {
          totalVolume[conversion.fromCurrency] = 0;
        }
        totalVolume[conversion.fromCurrency] += conversion.amount;

        // Popular pairs
        const pairKey = `${conversion.fromCurrency}/${conversion.toCurrency}`;
        if (!pairCounts[pairKey]) {
          pairCounts[pairKey] = { count: 0, volume: 0 };
        }
        pairCounts[pairKey].count++;
        pairCounts[pairKey].volume += conversion.amount;

        // Client activity
        if (!clientActivity[conversion.clientId]) {
          clientActivity[conversion.clientId] = 0;
        }
        clientActivity[conversion.clientId]++;
      }

      // Popular pairs array
      const popularPairs = Object.entries(pairCounts)
        .map(([pair, data]) => ({ pair, count: data.count, volume: data.volume }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Average conversion size
      const totalAmounts = recentConversions.reduce((sum, conv) => sum + conv.amount, 0);
      const averageConversionSize = totalConversions > 0 ? totalAmounts / totalConversions : 0;

      // Mock additional metrics
      const statistics: ConversionStatistics = {
        totalConversions,
        totalVolume,
        averageConversionSize,
        popularPairs,
        clientActivity,
        rateAccuracy: 99.8, // Mock high accuracy
        averageLatency: 45, // Mock 45ms average latency
        uptimePercent: 99.95, // Mock high uptime
      };

      return statistics;

    } catch (error) {
      console.error('Failed to get conversion statistics:', error);
      throw error;
    }
  }

  /**
   * Detect arbitrage opportunities
   */
  async detectArbitrageOpportunities(): Promise<ArbitrageOpportunity[]> {
    try {
      const opportunities: ArbitrageOpportunity[] = [];
      const currencies = this.SUPPORTED_CURRENCIES;

      // Check all possible triangular arbitrage paths
      for (let i = 0; i < currencies.length; i++) {
        for (let j = 0; j < currencies.length; j++) {
          for (let k = 0; k < currencies.length; k++) {
            if (i !== j && j !== k && k !== i) {
              const baseCurrency = currencies[i];
              const intermediateCurrency = currencies[j];
              const targetCurrency = currencies[k];

              try {
                // Get exchange rates for the path
                const rate1 = await exchangeRateService.calculateCrossRate(baseCurrency, intermediateCurrency, 1);
                const rate2 = await exchangeRateService.calculateCrossRate(intermediateCurrency, targetCurrency, 1);
                const rate3 = await exchangeRateService.calculateCrossRate(targetCurrency, baseCurrency, 1);

                // Calculate arbitrage
                const pathMultiplier = rate1.exchangeRate * rate2.exchangeRate * rate3.exchangeRate;
                const arbitragePercent = (pathMultiplier - 1) * 100;

                // Check if arbitrage opportunity exists (threshold: 0.1%)
                if (arbitragePercent > 0.1) {
                  const opportunity: ArbitrageOpportunity = {
                    opportunityId: `ARB_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    baseCurrency,
                    targetCurrency,
                    pathCurrencies: [baseCurrency, intermediateCurrency, targetCurrency, baseCurrency],
                    exchangeRates: [rate1.exchangeRate, rate2.exchangeRate, rate3.exchangeRate],
                    arbitragePercent,
                    potentialProfit: arbitragePercent, // Simplified calculation
                    riskLevel: arbitragePercent > 1.0 ? 'high' : arbitragePercent > 0.5 ? 'medium' : 'low',
                    detectedAt: new Date().toISOString(),
                    expirationEstimate: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
                    minimumAmount: 100,
                    maximumAmount: 10000,
                  };

                  opportunities.push(opportunity);
                  this.arbitrageOpportunities.set(opportunity.opportunityId, opportunity);

                  // Emit arbitrage event
                  this.emit('arbitrageDetected', opportunity);
                }

              } catch (error) {
                // Skip this path if rate fetching fails
                continue;
              }
            }
          }
        }
      }

      console.log('Arbitrage detection completed:', {
        opportunitiesFound: opportunities.length,
        maxArbitrage: opportunities.length > 0 ? Math.max(...opportunities.map(o => o.arbitragePercent)) : 0,
      });

      return opportunities;

    } catch (error) {
      console.error('Arbitrage detection failed:', error);
      return [];
    }
  }

  // Private helper methods

  private setupSocketServer(httpServer: HttpServer): void {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      },
      transports: ['websocket', 'polling']
    });

    this.io.on('connection', (socket) => {
      console.log('Client connected to real-time conversion service:', socket.id);

      // Handle subscription requests
      socket.on('subscribe-rates', (data: {
        clientId: string;
        currencyPairs: string[];
        alertThresholds?: any;
      }) => {
        try {
          this.subscribeToRateUpdates(
            data.clientId,
            socket.id,
            data.currencyPairs,
            data.alertThresholds
          );
          socket.emit('subscription-confirmed', {
            clientId: data.clientId,
            subscribedPairs: data.currencyPairs,
          });
        } catch (error) {
          socket.emit('subscription-error', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      // Handle conversion requests
      socket.on('request-conversion', async (request: RealTimeConversionRequest) => {
        try {
          const result = await this.performRealTimeConversion(request);
          socket.emit('conversion-result', result);
        } catch (error) {
          socket.emit('conversion-error', {
            conversionId: request.conversionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log('Client disconnected from real-time conversion service:', socket.id);
        
        // Find and remove client subscription
        for (const [clientId, subscription] of this.clients.entries()) {
          if (subscription.socketId === socket.id) {
            this.unsubscribeFromRateUpdates(clientId);
            break;
          }
        }
      });
    });
  }

  private startRateStreaming(): void {
    // Stream rates for all supported pairs
    const pairs = ['HBAR/USD', 'USD/KES', 'HBAR/KES'];

    for (const pair of pairs) {
      const timer = setInterval(async () => {
        try {
          await this.updateAndBroadcastRate(pair);
        } catch (error) {
          console.error(`Rate streaming failed for ${pair}:`, error);
        }
      }, this.STREAMING_INTERVAL);

      this.streamingTimers.set(pair, timer);
    }

    console.log('Real-time rate streaming started for pairs:', pairs);
  }

  private startArbitrageDetection(): void {
    const timer = setInterval(async () => {
      try {
        await this.detectArbitrageOpportunities();
      } catch (error) {
        console.error('Arbitrage detection failed:', error);
      }
    }, this.ARBITRAGE_DETECTION_INTERVAL);

    this.streamingTimers.set('arbitrage', timer);
    console.log('Arbitrage detection started');
  }

  private setupEventListeners(): void {
    // Listen to exchange rate service events
    exchangeRateService.on('rateUpdated', (data: { sourcePair: string; rate: ExchangeRateData }) => {
      this.handleExternalRateUpdate(data.sourcePair, data.rate);
    });

    // Listen to own events for logging
    this.on('conversionCompleted', (data) => {
      console.log('Conversion completed event:', data.result.conversionId);
    });

    this.on('arbitrageDetected', (opportunity) => {
      console.log('Arbitrage opportunity detected:', {
        id: opportunity.opportunityId,
        profit: `${opportunity.arbitragePercent.toFixed(2)}%`,
        path: opportunity.pathCurrencies.join(' -> '),
      });

      // Broadcast arbitrage alert to interested clients
      this.broadcastArbitrageAlert(opportunity);
    });
  }

  private async updateAndBroadcastRate(sourcePair: string): Promise<void> {
    try {
      const [fromCurrency, toCurrency] = sourcePair.split('/');
      
      // Get fresh rate
      const rateData = fromCurrency === 'HBAR' && toCurrency === 'USD'
        ? await exchangeRateService.getHBARToUSDRate()
        : fromCurrency === 'USD' && toCurrency === 'KES'
        ? await exchangeRateService.getUSDToKESRate()
        : await this.calculateCrossRate(fromCurrency, toCurrency);

      // Create stream data
      const streamData: RateStreamData = {
        sourcePair,
        rate: rateData.rate,
        change24h: rateData.change24h || 0,
        changePercent24h: rateData.changePercent24h || 0,
        volume24h: rateData.volume24h,
        timestamp: rateData.timestamp,
        source: rateData.source,
        confidence: rateData.confidence,
        marketStatus: 'open', // Mock market status
      };

      // Update cache
      this.rateCache.set(sourcePair, { rate: rateData, cachedAt: Date.now() });

      // Broadcast to subscribed clients
      this.broadcastRateUpdate(streamData);

      // Check for alerts
      await this.checkRateAlerts(sourcePair, rateData);

    } catch (error) {
      console.error(`Failed to update and broadcast rate for ${sourcePair}:`, error);
    }
  }

  private async calculateCrossRate(fromCurrency: string, toCurrency: string): Promise<ExchangeRateData> {
    const crossRate = await exchangeRateService.calculateCrossRate(fromCurrency, toCurrency, 1);
    
    return {
      sourcePair: `${fromCurrency}/${toCurrency}`,
      rate: crossRate.exchangeRate,
      source: 'cross-rate-calculation',
      timestamp: crossRate.calculatedAt,
      validUntil: new Date(Date.now() + this.RATE_CACHE_DURATION).toISOString(),
      confidence: crossRate.confidence,
    };
  }

  private broadcastRateUpdate(streamData: RateStreamData): void {
    for (const [clientId, subscription] of this.clients.entries()) {
      if (subscription.subscribedPairs.includes(streamData.sourcePair)) {
        this.io.to(subscription.socketId).emit('rate-update', streamData);
        
        // Update last activity
        subscription.lastActivity = new Date().toISOString();
      }
    }
  }

  private broadcastConversionUpdate(result: RealTimeConversionResult): void {
    const pairKey = `${result.fromCurrency}/${result.toCurrency}`;
    
    for (const [clientId, subscription] of this.clients.entries()) {
      if (subscription.subscribedPairs.includes(pairKey)) {
        this.io.to(subscription.socketId).emit('conversion-update', result);
      }
    }
  }

  private broadcastArbitrageAlert(opportunity: ArbitrageOpportunity): void {
    this.io.emit('arbitrage-alert', opportunity);
  }

  private async sendInitialRatesToClient(clientId: string): Promise<void> {
    const subscription = this.clients.get(clientId);
    if (!subscription) return;

    try {
      for (const pair of subscription.subscribedPairs) {
        const cachedRate = this.rateCache.get(pair);
        if (cachedRate) {
          const streamData: RateStreamData = {
            sourcePair: pair,
            rate: cachedRate.rate.rate,
            change24h: cachedRate.rate.change24h || 0,
            changePercent24h: cachedRate.rate.changePercent24h || 0,
            volume24h: cachedRate.rate.volume24h,
            timestamp: cachedRate.rate.timestamp,
            source: cachedRate.rate.source,
            confidence: cachedRate.rate.confidence,
            marketStatus: 'open',
          };

          this.io.to(subscription.socketId).emit('initial-rate', streamData);
        }
      }
    } catch (error) {
      console.error('Failed to send initial rates to client:', error);
    }
  }

  private async checkRateAlerts(sourcePair: string, rateData: ExchangeRateData): Promise<void> {
    const alerts = this.alertSubscriptions.get(sourcePair);
    if (!alerts || alerts.length === 0) return;

    for (const alert of alerts) {
      let triggered = false;
      
      switch (alert.alertType) {
        case 'price_above':
          triggered = rateData.rate > alert.threshold;
          break;
        case 'price_below':
          triggered = rateData.rate < alert.threshold;
          break;
        case 'change_percent':
          triggered = Math.abs(rateData.changePercent24h || 0) > alert.threshold;
          break;
        // Add more alert types as needed
      }

      if (triggered) {
        const alertNotification: RateAlert = {
          ...alert,
          currentValue: rateData.rate,
          triggeredAt: new Date().toISOString(),
          alertMessage: `${alert.alertType} alert for ${sourcePair}: ${rateData.rate}`,
        };

        // Send alert to specific client
        const subscription = this.clients.get(alert.clientId);
        if (subscription) {
          this.io.to(subscription.socketId).emit('rate-alert', alertNotification);
        }

        this.emit('alertTriggered', alertNotification);
      }
    }
  }

  private handleExternalRateUpdate(sourcePair: string, rateData: ExchangeRateData): void {
    // Update cache with external rate update
    this.rateCache.set(sourcePair, { rate: rateData, cachedAt: Date.now() });
    
    // Create stream data and broadcast
    const streamData: RateStreamData = {
      sourcePair,
      rate: rateData.rate,
      change24h: rateData.change24h || 0,
      changePercent24h: rateData.changePercent24h || 0,
      volume24h: rateData.volume24h,
      timestamp: rateData.timestamp,
      source: rateData.source,
      confidence: rateData.confidence,
      marketStatus: 'open',
    };

    this.broadcastRateUpdate(streamData);
  }

  private calculateConversionFees(
    amount: number,
    convertedAmount: number,
    fromCurrency: string,
    toCurrency: string
  ): {
    conversionFeePercent: number;
    conversionFeeFixed: number;
    totalFees: number;
  } {
    // Mock fee calculation - in production would be based on actual fee structure
    const feePercent = 0.1; // 0.1% conversion fee
    const feeAmount = convertedAmount * (feePercent / 100);
    
    return {
      conversionFeePercent: feePercent,
      conversionFeeFixed: 0, // No fixed fee in this example
      totalFees: feeAmount,
    };
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Clear all timers
    this.streamingTimers.forEach(timer => clearInterval(timer));
    this.streamingTimers.clear();

    // Close socket connections
    this.io.close();

    // Clear caches and subscriptions
    this.clients.clear();
    this.activeConversions.clear();
    this.rateCache.clear();
    this.alertSubscriptions.clear();
    this.arbitrageOpportunities.clear();

    console.log('Real-time currency conversion service cleaned up');
  }
}

// Export singleton instance
export const realTimeCurrencyConversionService = new RealTimeCurrencyConversionService(
  // HTTP server will be provided when creating the service
  {} as HttpServer
);

export default realTimeCurrencyConversionService;