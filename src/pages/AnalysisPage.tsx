import { useState, useEffect } from 'react';
import { useHiveData } from '../hooks/useHiveData';
import type { Language } from '../hooks/useLanguage';
import { TradingSummary } from '../components/TradingSummary';
import { PriceDisplay } from '../components/PriceDisplay';
import { DateFilter } from '../components/DateFilter';
import { UserSelector } from '../components/UserSelector';
import { OperationsTable } from '../components/OperationsTable';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { es, enUS } from 'date-fns/locale';

export function AnalysisPage({ language, t }: { language: Language; t: (key: string) => string }) {
  const {
    operations,
    priceData,
    summary,
    isLoading,
    isPriceLoading,
    lastUpdate,
    dateFilter,
    targetUser,
    setDateFilter,
    setTargetUser,
    loadingStatus
  } = useHiveData();

  const dateLocale = language === 'es' ? es : enUS;

  // Estado para controlar la visualización del spinner inicial
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false);
  
  // Estado para controlar la visualización del overlay de carga
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayMessage, setOverlayMessage] = useState('');
  
  // Usamos useEffect con un timer para evitar parpadeos del overlay
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    
    if (isLoading) {
      // Mostramos el overlay después de un pequeño retraso para evitar parpadeos en cargas rápidas
      timer = setTimeout(() => {
        setShowOverlay(true);
        setOverlayMessage(loadingStatus);
      }, 300);
    } else {
      // Ocultamos el overlay con un pequeño retraso para evitar parpadeos
      timer = setTimeout(() => {
        setShowOverlay(false);
      }, 500);
      
      // Marcamos que la carga inicial ha terminado
      if (!hasInitiallyLoaded) {
        setHasInitiallyLoaded(true);
      }
    }
    
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isLoading, loadingStatus, hasInitiallyLoaded]);
  
  // Actualizamos el mensaje del overlay cuando cambia
  useEffect(() => {
    if (isLoading && showOverlay) {
      setOverlayMessage(loadingStatus);
    }
  }, [loadingStatus, isLoading, showOverlay]);

  // Spinner de pantalla completa para la carga inicial
  if (!hasInitiallyLoaded && isLoading) {
    return <LoadingSpinner statusMessage={loadingStatus} />;
  }

  return (
    <>
      {/* Loading Overlay con transición suave */}
      <div 
        className={`fixed inset-0 bg-gray-900 bg-opacity-70 backdrop-blur-sm z-50 flex items-center justify-center transition-opacity duration-300 ${
          showOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
          <div className="mt-4 text-white text-lg">{overlayMessage || t('loading.title')}</div>
        </div>
      </div>
      
        <div className="space-y-8">
          {/* User Selector */}
          <UserSelector 
            currentUser={targetUser}
            onUserChange={setTargetUser}
            isLoading={isLoading}
            t={t}
            lastUpdate={lastUpdate}
            dateLocale={dateLocale}
          />

          {/* Summary Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TradingSummary summary={summary} isLoading={isLoading} t={t} />
            <PriceDisplay priceData={priceData} isLoading={isPriceLoading} t={t} />
          </div>

          {/* Date Filter */}
          <DateFilter 
            dateFilter={dateFilter} 
            onDateFilterChange={setDateFilter} 
            t={t}
          />

          {/* Operations Table */}
          <OperationsTable 
            operations={operations} 
            isLoading={isLoading} 
            t={t}
            dateLocale={dateLocale}
          />

        </div>
    </>
  );
}
