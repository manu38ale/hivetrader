import React from 'react';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { TradingSummary as TradingSummaryType } from '../types/hive';
import { formatCurrency } from '../utils/calculations';
import { LoadingPlaceholder } from './LoadingSpinner';

interface TradingSummaryProps {
  summary: TradingSummaryType | null;
  isLoading: boolean;
  t: (key: string) => string;
}

export function TradingSummary({ summary, isLoading, t }: TradingSummaryProps) {
  if (isLoading || !summary) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
          <Activity className="mr-2 h-5 w-5" />
          {t('tradingSummary.title')}
        </h3>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <LoadingPlaceholder className="h-8 w-20 mx-auto mb-2" />
            <div className="text-sm text-gray-400">{t('tradingSummary.hbdSpent')}</div>
          </div>
          
          <div className="text-center">
            <LoadingPlaceholder className="h-8 w-20 mx-auto mb-2" />
            <div className="text-sm text-gray-400">{t('tradingSummary.hbdReceived')}</div>
          </div>
          
          <div className="text-center">
            <LoadingPlaceholder className="h-8 w-20 mx-auto mb-2" />
            <div className="text-sm text-gray-400">{t('tradingSummary.netProfit')}</div>
          </div>
          
          <div className="text-center">
            <LoadingPlaceholder className="h-8 w-16 mx-auto mb-2" />
            <div className="text-sm text-gray-400">{t('tradingSummary.operations')}</div>
          </div>
        </div>
      </div>
    );
  }

  const isProfit = summary.netProfitLoss >= 0;

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
        <Activity className="mr-2 h-5 w-5" />
        {t('tradingSummary.title')}
      </h3>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-red-400">
            {formatCurrency(summary.totalHbdSpent)}
          </div>
          <div className="text-sm text-gray-400">{t('tradingSummary.hbdSpent')}</div>
        </div>
        
        <div className="text-center">
          <div className="text-2xl font-bold text-green-400">
            {formatCurrency(summary.totalHbdReceived)}
          </div>
          <div className="text-sm text-gray-400">{t('tradingSummary.hbdReceived')}</div>
        </div>
        
        <div className="text-center">
          <div className={`text-2xl font-bold flex items-center justify-center ${
            isProfit ? 'text-green-400' : 'text-red-400'
          }`}>
            {isProfit ? (
              <TrendingUp className="mr-1 h-5 w-5" />
            ) : (
              <TrendingDown className="mr-1 h-5 w-5" />
            )}
            {formatCurrency(Math.abs(summary.netProfitLoss))}
          </div>
          <div className="text-sm text-gray-400">
            {isProfit ? t('tradingSummary.netProfit') : t('tradingSummary.netLoss')}
          </div>
        </div>
        
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-400">
            {summary.totalOperations}
          </div>
          <div className="text-sm text-gray-400">{t('tradingSummary.operations')}</div>
        </div>
      </div>
    </div>
  );
}