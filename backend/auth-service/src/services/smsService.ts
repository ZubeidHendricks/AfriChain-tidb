import AfricasTalking from 'africastalking';
import { generateOTP, hashOTP } from '../utils/crypto';

interface SMSConfig {
  apiKey: string;
  username: string;
  from?: string;
}

interface OTPResult {
  success: boolean;
  otp?: string;
  otpHash?: string;
  messageId?: string;
  error?: string;
}

interface SMSDeliveryStatus {
  messageId: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'rejected';
  phoneNumber: string;
  cost?: string;
  networkCode?: string;
}

class SMSService {
  private africastalking: any;
  private sms: any;
  private config: SMSConfig;

  constructor() {
    this.config = {
      apiKey: process.env.AFRICASTALKING_API_KEY || '',
      username: process.env.AFRICASTALKING_USERNAME || 'sandbox',
      from: process.env.SMS_SENDER_ID || 'AfriChain'
    };

    if (!this.config.apiKey) {
      throw new Error('Africa\'s Talking API key is required');
    }

    // Initialize Africa's Talking SDK
    this.africastalking = AfricasTalking({
      apiKey: this.config.apiKey,
      username: this.config.username,
    });

    this.sms = this.africastalking.SMS;
  }

  /**
   * Generate and send OTP via SMS
   */
  public async sendOTP(phoneNumber: string): Promise<OTPResult> {
    try {
      // Validate phone number format (Kenyan: +254XXXXXXXXX)
      if (!this.isValidKenyanPhoneNumber(phoneNumber)) {
        return {
          success: false,
          error: 'Invalid Kenyan phone number format. Use +254XXXXXXXXX'
        };
      }

      // Generate 6-digit OTP
      const otp = generateOTP();
      const otpHash = hashOTP(otp);

      // Create SMS message
      const message = `Your AfriChain verification code is: ${otp}. This code expires in 5 minutes. Do not share this code.`;

      // Send SMS via Africa's Talking
      const smsOptions = {
        to: [phoneNumber],
        message: message,
        from: this.config.from
      };

      console.log(`Sending OTP to ${phoneNumber}`);
      const response = await this.sms.send(smsOptions);

      if (response.SMSMessageData.Recipients.length > 0) {
        const recipient = response.SMSMessageData.Recipients[0];
        
        if (recipient.status === 'Success') {
          console.log(`OTP sent successfully to ${phoneNumber}, MessageId: ${recipient.messageId}`);
          return {
            success: true,
            otp: otp, // Only for development/testing - remove in production
            otpHash: otpHash,
            messageId: recipient.messageId
          };
        } else {
          console.error(`Failed to send OTP to ${phoneNumber}:`, recipient.status);
          return {
            success: false,
            error: `SMS delivery failed: ${recipient.status}`
          };
        }
      } else {
        return {
          success: false,
          error: 'No recipients in SMS response'
        };
      }

    } catch (error) {
      console.error('Error sending OTP:', error);
      return {
        success: false,
        error: 'Failed to send SMS. Please try again.'
      };
    }
  }

  /**
   * Handle delivery report webhook from Africa's Talking
   */
  public async handleDeliveryReport(data: any): Promise<SMSDeliveryStatus> {
    try {
      return {
        messageId: data.id,
        status: this.mapDeliveryStatus(data.status),
        phoneNumber: data.phoneNumber,
        cost: data.cost,
        networkCode: data.networkCode
      };
    } catch (error) {
      console.error('Error handling delivery report:', error);
      throw error;
    }
  }

  /**
   * Validate Kenyan phone number format
   */
  private isValidKenyanPhoneNumber(phoneNumber: string): boolean {
    // Kenyan phone number format: +254XXXXXXXXX (9 digits after country code)
    const kenyanPhoneRegex = /^\+254[17]\d{8}$/;
    return kenyanPhoneRegex.test(phoneNumber);
  }

  /**
   * Map Africa's Talking delivery status to our standard status
   */
  private mapDeliveryStatus(status: string): SMSDeliveryStatus['status'] {
    switch (status.toLowerCase()) {
      case 'success':
      case 'sent':
        return 'sent';
      case 'delivered':
        return 'delivered';
      case 'failed':
        return 'failed';
      case 'rejected':
        return 'rejected';
      default:
        return 'queued';
    }
  }

  /**
   * Get account balance (for monitoring)
   */
  public async getAccountBalance(): Promise<any> {
    try {
      const response = await this.africastalking.APPLICATION.fetchApplicationData();
      return response.UserData;
    } catch (error) {
      console.error('Error fetching account balance:', error);
      throw error;
    }
  }

  /**
   * Send custom SMS (for notifications)
   */
  public async sendCustomSMS(phoneNumber: string, message: string): Promise<OTPResult> {
    try {
      if (!this.isValidKenyanPhoneNumber(phoneNumber)) {
        return {
          success: false,
          error: 'Invalid Kenyan phone number format'
        };
      }

      const smsOptions = {
        to: [phoneNumber],
        message: message,
        from: this.config.from
      };

      const response = await this.sms.send(smsOptions);
      const recipient = response.SMSMessageData.Recipients[0];

      return {
        success: recipient.status === 'Success',
        messageId: recipient.messageId,
        error: recipient.status !== 'Success' ? recipient.status : undefined
      };

    } catch (error) {
      console.error('Error sending custom SMS:', error);
      return {
        success: false,
        error: 'Failed to send SMS'
      };
    }
  }
}

export default SMSService;
export { OTPResult, SMSDeliveryStatus };