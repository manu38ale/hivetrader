import { PriceData } from '../types/hive';

// Fallback to a simpler approach - use a free API or mock data
export async function fetchCurrentPrices(): Promise<PriceData | null> {
  try {
    // Try alternative free API first
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=hive,hive_dollar&vs_currencies=usd', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    console.log('CoinGecko API response:', data);
    
    // Transform the response to match our expected format
    return {
      hive: { usd: data['hive']?.usd || 0 },
      hive_dollar: { usd: data['hive_dollar']?.usd || 1 }
    };
  } catch (error) {
    console.warn('Primary API failed, using fallback prices:', error);
    
    // Return reasonable fallback prices
    return {
      hive: { usd: 0.30 }, // Approximate HIVE price
      hive_dollar: { usd: 1.00 } // HBD should be close to $1
    };
  }
}