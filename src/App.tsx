import React from 'react';
import { User } from 'lucide-react';
import { useHiveData } from './hooks/useHiveData';
import { useLanguage } from './hooks/useLanguage';
import { TradingSummary } from './components/TradingSummary';
import { PriceDisplay } from './components/PriceDisplay';
import { DateFilter } from './components/DateFilter';
import { UserSelector } from './components/UserSelector';
import { OperationsTable } from './components/OperationsTable';
import { LoadingSpinner } from './components/LoadingSpinner';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { format } from 'date-fns';
import { es, enUS } from 'date-fns/locale';

function App() {
  const { language, setLanguage, t } = useLanguage();
  const {
    operations,
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
    refreshData
  } = useHiveData();

  const dateLocale = language === 'es' ? es : enUS;

  // Solo mostrar spinner de carga completa en la primera carga
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading && !hasInitiallyLoaded) {
      setHasInitiallyLoaded(true);
    }
  }, [isLoading, hasInitiallyLoaded]);

  if (!hasInitiallyLoaded && isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-red-500 rounded-lg flex items-center justify-center mr-4">
                <span className="text-white font-bold text-lg">H</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">{t('header.title')}</h1>
                <div className="flex items-center text-gray-400 text-sm">
                  <User className="w-4 h-4 mr-1" />
                  <span>{targetUser || t('common.noUserSelected')}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <LanguageSwitcher 
                currentLanguage={language}
                onLanguageChange={setLanguage}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 border-t border-gray-700 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center text-gray-400 text-sm">
            <p>{t('footer.description')}</p>
            <p className="mt-1">{t('footer.updateInterval')}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;