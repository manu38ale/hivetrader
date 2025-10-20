import React from 'react';
import { DollarSign, AlertTriangle } from 'lucide-react';
import { PriceData } from '../types/hive';
import { formatPrice } from '../utils/calculations';
import { LoadingPlaceholder } from './LoadingSpinner';

interface PriceDisplayProps {
  priceData: PriceData | null;
  isLoading: boolean;
  t: (key: string) => string;
}

export function PriceDisplay({ priceData, isLoading, t }: PriceDisplayProps) {
  const isUsingFallback = priceData && (priceData.hive.usd === 0.30 && priceData.hive_dollar.usd === 1.00);

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
        <DollarSign className="mr-2 h-5 w-5" />
        {t('priceDisplay.title')}
        {isUsingFallback && (
          <AlertTriangle className="ml-2 h-4 w-4 text-yellow-500" title={t('priceDisplay.fallbackNote')} />
        )}
      </h3>
      
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center mr-3">
              <span className="text-white font-bold text-sm">H</span>
            </div>
            <span className="text-gray-300 font-medium">HIVE</span>
          </div>
          <div className="text-right">
            {isLoading ? (
              <LoadingPlaceholder className="h-6 w-16" />
            ) : priceData ? (
              <div className="text-white font-semibold">
                {formatPrice(priceData.hive.usd)}
              </div>
            ) : (
              <div className="text-gray-500 text-sm">{t('priceDisplay.notAvailable')}</div>
            )}
          </div>
        </div>

        <div className="flex justify-between items-center">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center mr-3">
              <span className="text-white font-bold text-sm">$</span>
            </div>
            <span className="text-gray-300 font-medium">HBD</span>
          </div>
          <div className="text-right">
            {isLoading ? (
              <LoadingPlaceholder className="h-6 w-16" />
            ) : priceData ? (
              <div className="text-white font-semibold">
                {formatPrice(priceData.hive_dollar.usd)}
              </div>
            ) : (
              <div className="text-gray-500 text-sm">{t('priceDisplay.notAvailable')}</div>
            )}
          </div>
        </div>
      </div>

      {isUsingFallback && (
        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-700 rounded-md">
          <p className="text-yellow-400 text-xs flex items-center">
            <AlertTriangle className="w-3 h-3 mr-1" />
            {t('priceDisplay.fallbackNote')}
          </p>
        </div>
      )}

      {!isLoading && !priceData && (
        <div className="mt-4 p-3 bg-red-900/20 border border-red-700 rounded-md">
          <p className="text-red-400 text-xs">
            {t('priceDisplay.apiError')}
          </p>
        </div>
      )}
    </div>
  );
}