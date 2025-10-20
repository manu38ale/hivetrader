import { useState, useEffect, useCallback } from 'react';
import { FillOrderOperation, PriceData, DateFilter, TradingSummary, DebugInfo } from '../types/hive';
import { fetchManuphotosOperations } from '../utils/hiveApi';
import { fetchCurrentPrices } from '../utils/priceApi';
import { calculateTradingSummary } from '../utils/calculations';
import { isAfter, isBefore, startOfDay, endOfDay } from 'date-fns';
import { subMonths } from 'date-fns';
import { fetchUserOperations } from '../utils/hiveApi';

export function useHiveData() {
  const [targetUser, setTargetUser] = useState<string>('');
  const [operations, setOperations] = useState<FillOrderOperation[]>([]);
  const [filteredOperations, setFilteredOperations] = useState<FillOrderOperation[]>([]);
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [summary, setSummary] = useState<TradingSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPriceLoading, setIsPriceLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [dateFilter, setDateFilter] = useState<DateFilter>({ 
    startDate: subMonths(new Date(), 6), 
    endDate: new Date() 
  });
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  const loadOperations = useCallback(async () => {
    if (!targetUser.trim()) return;
    
    try {
      setIsLoading(true);
      console.log(`Loading operations for ${targetUser}...`);
      const { operations: ops, debugInfo: debug } = await fetchUserOperations(targetUser, dateFilter);
      console.log('Operations loaded:', ops.length);
      setOperations(ops);
      setDebugInfo(debug);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error loading operations:', error);
    } finally {
      setIsLoading(false);
    }
  }, [targetUser, dateFilter]);

  const loadPrices = useCallback(async () => {
    try {
      setIsPriceLoading(true);
      const prices = await fetchCurrentPrices();
      setPriceData(prices);
    } catch (error) {
      console.error('Error loading prices:', error);
      // Set fallback prices if API fails completely
      setPriceData({
        hive: { usd: 0.25 },
        hive_dollar: { usd: 1.00 }
      });
    } finally {
      setIsPriceLoading(false);
    }
  }, []);

  const applyDateFilter = useCallback(() => {
    let filtered = [...operations];

    if (dateFilter.startDate) {
      const startDate = startOfDay(dateFilter.startDate);
      filtered = filtered.filter(op => 
        isAfter(new Date(op.timestamp), startDate) || 
        new Date(op.timestamp).getTime() === startDate.getTime()
      );
    }

    if (dateFilter.endDate) {
      const endDate = endOfDay(dateFilter.endDate);
      filtered = filtered.filter(op => 
        isBefore(new Date(op.timestamp), endDate) || 
        new Date(op.timestamp).getTime() === endDate.getTime()
      );
    }

    setFilteredOperations(filtered);
    setSummary(calculateTradingSummary(filtered));
  }, [operations, dateFilter]);

  // Carga inicial
  useEffect(() => {
    // Solo cargar operaciones si hay un usuario seleccionado
    if (targetUser.trim()) {
      loadOperations();
    }
    loadPrices();
  }, [targetUser, loadOperations, loadPrices]);

  // Aplicar filtros cuando cambien las operaciones o filtros
  useEffect(() => {
    applyDateFilter();
  }, [applyDateFilter]);

  // Auto-refresh cada 2 minutos
  useEffect(() => {
    // Solo auto-refresh si hay un usuario seleccionado
    if (!targetUser.trim()) return;
    
    const interval = setInterval(() => {
      loadOperations();
      loadPrices();
    }, 10 * 60 * 1000); // 10 minutos

    return () => clearInterval(interval);
  }, [targetUser, loadOperations, loadPrices]);

  return {
    operations: filteredOperations,
    priceData,
    summary,
    isLoading,
    isPriceLoading,
    debugInfo,
    lastUpdate,
    dateFilter,
    targetUser,
    setDateFilter,
    setTargetUser,
    refreshData: () => {
      loadOperations();
      loadPrices();
    }
  };
}