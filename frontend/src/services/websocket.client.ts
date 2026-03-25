import { PROTOCOL_VERSION } from '../../../backend/src/types'; 

class RebalancerWSClient {
  private ws: WebSocket | null = null;
  private retryAttempts = 0;
  private maxRetryDelay = 30000; 
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  public connect() {
    console.log(`Attempting to connect to ${this.url}...`);
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log("Connection established with the server.");
      this.retryAttempts = 0; 
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("Message received:", data);
      } catch (e) {
        console.error("Error parsing server message");
      }
    };

    this.ws.onclose = (event) => {
      console.warn(`Connection closed (Code: ${event.code}). Initiating reconnection...`);
      this.handleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket Error:", error);
    };
  }

  private handleReconnect() {
    // Exponential backoff strategy
    const delay = Math.min(
      Math.pow(2, this.retryAttempts) * 1000 + (Math.random() * 1000),
      this.maxRetryDelay
    );

    console.log(`Next reconnection attempt in ${Math.round(delay / 1000)}s...`);

    setTimeout(() => {
      this.retryAttempts++;
      this.connect();
    }, delay);
  }

  public send(type: string, payload: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = {
        version: PROTOCOL_VERSION,
        type,
        payload,
        timestamp: Date.now()
      };
      this.ws.send(JSON.stringify(message));
    } else {
      console.error("Cannot send message: Socket not connected.");
    }
  }
}

export default RebalancerWSClient;