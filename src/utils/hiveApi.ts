const HIVE_API_URL = 'https://api.hive.blog';
import { FillOrderOperation, DebugInfo } from '../types/hive';

export interface OrderBookLevel {
  price: number;
  hive: number;
  hbd: number;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export async function fetchMedianPriceFeed(): Promise<{ base: string; quote: string }> {
  const raw: unknown = await callHiveAPI('condenser_api.get_current_median_history_price', []);
  if (!raw || typeof raw !== 'object' || !('base' in raw) || !('quote' in raw)
    || typeof raw.base !== 'string' || typeof raw.quote !== 'string') {
    throw new Error('Invalid Hive median price feed response');
  }
  return { base: raw.base, quote: raw.quote };
}

export async function fetchOrderBook(signal?: AbortSignal): Promise<OrderBookSnapshot> {
  const raw: unknown = await callHiveAPI('condenser_api.get_order_book', [50], signal);
  if (!raw || typeof raw !== 'object' || !('bids' in raw) || !('asks' in raw)) {
    throw new Error('Invalid Hive order book response');
  }
  const parseLevels = (levels: unknown): OrderBookLevel[] => {
    if (!Array.isArray(levels)) throw new Error('Invalid order book levels');
    return levels.map((level: unknown) => {
      if (!level || typeof level !== 'object' || !('real_price' in level)
        || !('hive' in level) || !('hbd' in level)) {
        throw new Error('Invalid order book level');
      }
      const price = Number(level.real_price);
      const hive = Number(level.hive) / 1000;
      const hbd = Number(level.hbd) / 1000;
      if (![price, hive, hbd].every(Number.isFinite) || price <= 0 || hive < 0 || hbd < 0) {
        throw new Error('Invalid order book amounts');
      }
      return { price, hive, hbd };
    });
  };
  return { bids: parseLevels(raw.bids), asks: parseLevels(raw.asks) };
}

interface HiveRPCRequest {
  jsonrpc: string;
  method: string;
  params: any[];
  id: number;
}

interface HiveRPCResponse {
  jsonrpc: string;
  result: any;
  id: number;
  error?: any;
}

export async function callHiveAPI(method: string, params: any[], signal?: AbortSignal): Promise<any> {
  const request: HiveRPCRequest = {
    jsonrpc: '2.0',
    method,
    params,
    id: 1
  };

  try {
    const response = await fetch(HIVE_API_URL, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: HiveRPCResponse = await response.json();
    
    if (data.error) {
      throw new Error(`Hive API error: ${data.error.message}`);
    }

    return data.result;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error('Error calling Hive API:', error);
    throw error;
  }
}

export async function getAccountHistory(account: string, limit: number = 1000): Promise<any[]> {
  const allHistory: any[] = [];
  let start = -1;
  let hasMoreData = true;

  while (hasMoreData) {
    try {
      // Usar condenser_api.get_account_history según la documentación
      const history = await callHiveAPI('condenser_api.get_account_history', [account, start, limit]);
      
      if (!history || history.length === 0) {
        hasMoreData = false;
        break;
      }

      // Si obtenemos menos del límite, es la última página
      if (history.length < limit) {
        hasMoreData = false;
      }

      // Añadir las nuevas entradas al array total
      allHistory.push(...history);

      // Actualizar el punto de inicio para la siguiente llamada
      // El start debe ser el índice de la entrada más antigua obtenida menos 1
      if (history.length > 0) {
        const oldestEntry = history[0];
        start = oldestEntry[0] - 1; // El primer elemento es el índice
        
        // Si start es negativo, hemos llegado al principio
        if (start < 0) {
          hasMoreData = false;
        }
      }

      // Evitar bucles infinitos
      if (allHistory.length > 50000) {
        console.warn('Límite de seguridad alcanzado: 50,000 entradas');
        hasMoreData = false;
      }

    } catch (error) {
      console.error('Error fetching account history page:', error);
      hasMoreData = false;
    }
  }

  return allHistory;

  try {
    // Usar condenser_api.get_account_history según la documentación
    const history = await callHiveAPI('condenser_api.get_account_history', [account, -1, limit]);
    return history || [];
  } catch (error) {
    console.error('Error fetching account history:', error);
    return [];
  }
}

export function parseFillOrderOperations(history: any[], targetAccount: string): { operations: FillOrderOperation[], debugInfo: DebugInfo } {
  const operations: FillOrderOperation[] = [];
  const debugInfo: DebugInfo = {
    totalHistoryEntries: history.length,
    totalApiCalls: 0, // Se actualizará desde la función que llama
    fillOrdersFound: 0,
    manuphotosInvolved: 0,
    validOperations: 0,
    sampleOperations: []
  };
  
  console.log('Total history entries:', history.length);

  for (const entry of history) {
    const [, transaction] = entry;
    const { timestamp, op } = transaction;
    const [opType, opData] = op;

    // Log para debug
    if (opType === 'fill_order') {
      console.log('Found fill_order:', opData);
      debugInfo.fillOrdersFound++;
      if (debugInfo.sampleOperations.length < 3) {
        debugInfo.sampleOperations.push({ timestamp, opData });
      }
    }

    // Filtrar solo operaciones fill_order
    if (opType === 'fill_order') {
      const { current_owner, open_owner, current_pays, open_pays } = opData;
      
      // Solo procesar operaciones donde el usuario objetivo esté involucrado
      if (current_owner !== targetAccount && open_owner !== targetAccount) {
        console.log(`Skipping operation - ${targetAccount} not involved:`, { current_owner, open_owner });
        continue;
      }
      
      debugInfo.manuphotosInvolved++;

      console.log(`Processing fill_order for ${targetAccount}:`, {
        current_owner,
        open_owner,
        current_pays,
        open_pays,
        timestamp
      });

      // Parsear cantidades y monedas
      const currentPaysAmount = parseFloat(current_pays.split(' ')[0]);
      const currentPaysCurrency = current_pays.split(' ')[1];
      const openPaysAmount = parseFloat(open_pays.split(' ')[0]);
      const openPaysCurrency = open_pays.split(' ')[1];

      let hiveAmount = 0;
      let hbdAmount = 0;
      let type: 'buy' | 'sell' = 'buy';

      // Determinar dirección del trade y cantidades
      if (current_owner === targetAccount) {
        // El usuario está recibiendo
        if (currentPaysCurrency === 'HIVE') {
          hiveAmount = currentPaysAmount;
          hbdAmount = openPaysAmount;
          type = 'sell'; // Vendiendo HBD por HIVE
        } else if (currentPaysCurrency === 'HBD') {
          hbdAmount = currentPaysAmount;
          hiveAmount = openPaysAmount;
          type = 'buy'; // Comprando HIVE con HBD
        }
      } else if (open_owner === targetAccount) {
        // El usuario está pagando
        if (openPaysCurrency === 'HIVE') {
          hiveAmount = openPaysAmount;
          hbdAmount = currentPaysAmount;
          type = 'sell'; // Vendiendo HIVE por HBD
        } else if (openPaysCurrency === 'HBD') {
          hbdAmount = openPaysAmount;
          hiveAmount = currentPaysAmount;
          type = 'buy'; // Comprando HIVE con HBD
        }
      }

      // Solo incluir trades HIVE/HBD válidos
      if (hiveAmount > 0 && hbdAmount > 0) {
        const price = hbdAmount / hiveAmount;

        console.log('Adding operation:', {
          timestamp,
          type,
          hiveAmount,
          hbdAmount,
          price
        });

        operations.push({
          timestamp,
          type,
          hiveAmount,
          hbdAmount,
          price,
          currentOwner: current_owner,
          openOwner: open_owner
        });
        
        debugInfo.validOperations++;
      } else {
        console.log('Skipping invalid operation:', {
          hiveAmount,
          hbdAmount,
          currentPaysCurrency,
          openPaysCurrency
        });
      }
    }
  }

  console.log('Total operations found:', operations.length);
  return {
    operations: operations.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    debugInfo
  };
}

export async function fetchUserOperations(targetAccount: string, dateFilter?: { startDate: Date | null, endDate: Date | null }): Promise<{ operations: FillOrderOperation[], debugInfo: DebugInfo }> {
  let apiCalls = 0;
  
  // Función personalizada para contar las llamadas
  const getHistoryWithCount = async (account: string, limit: number = 1000, dateFilter?: { startDate: Date | null, endDate: Date | null }): Promise<any[]> => {
    const allHistory: any[] = [];
    let start = -1;
    let hasMoreData = true;
    const startDate = dateFilter?.startDate;
    const endDate = dateFilter?.endDate;

    while (hasMoreData) {
      try {
        apiCalls++;
        const history = await callHiveAPI('condenser_api.get_account_history', [account, start, limit]);
        
        if (!history || history.length === 0) {
          hasMoreData = false;
          break;
        }

        if (history.length < limit) {
          hasMoreData = false;
        }

        // Filtrar por fecha si se especifica
        const filteredHistory = history.filter((entry: any) => {
          const [, transaction] = entry;
          const { timestamp } = transaction;
          const entryDate = new Date(timestamp);
          
          if (startDate && entryDate < startDate) {
            return false;
          }
          if (endDate && entryDate > endDate) {
            return false;
          }
          return true;
        });

        allHistory.push(...filteredHistory);

        // Si encontramos entradas más antiguas que startDate, podemos parar
        if (startDate && history.length > 0) {
          const oldestEntry = history[history.length - 1];
          const oldestTimestamp = new Date(oldestEntry[1].timestamp);
          if (oldestTimestamp < startDate) {
            hasMoreData = false;
            break;
          }
        }

        if (history.length > 0) {
          const oldestEntry = history[0];
          start = oldestEntry[0] - 1;
          
          if (start < 0) {
            hasMoreData = false;
          }
        }

        if (allHistory.length > 50000) {
          console.warn('Límite de seguridad alcanzado: 50,000 entradas');
          hasMoreData = false;
        }

      } catch (error) {
        console.error('Error fetching account history page:', error);
        hasMoreData = false;
      }
    }

    return allHistory;
  };

  const history = await getHistoryWithCount(targetAccount, 1000, dateFilter);
  const result = parseFillOrderOperations(history, targetAccount);
  
  // Actualizar el número de llamadas API en el debug info
  result.debugInfo.totalApiCalls = apiCalls;
  
  return result;
}