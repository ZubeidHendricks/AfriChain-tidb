declare module 'africastalking' {
  interface AfricasTalkingConfig {
    apiKey: string;
    username: string;
  }

  interface SMSResponse {
    SMSMessageData: {
      Message: string;
      Recipients: Array<{
        statusCode: number;
        number: string;
        status: string;
        cost: string;
        messageId: string;
      }>;
    };
  }

  interface SMSOptions {
    to: string[];
    message: string;
    from?: string;
    bulkSMSMode?: number;
    enqueue?: boolean;
    keyword?: string;
    linkId?: string;
    retryDurationInHours?: number;
  }

  interface ApplicationData {
    UserData: {
      balance: string;
    };
  }

  interface SMS {
    send(options: SMSOptions): Promise<SMSResponse>;
  }

  interface Application {
    fetchApplicationData(): Promise<ApplicationData>;
  }

  interface AfricasTalkingSDK {
    SMS: SMS;
    APPLICATION: Application;
  }

  function AfricasTalking(config: AfricasTalkingConfig): AfricasTalkingSDK;

  export = AfricasTalking;
}