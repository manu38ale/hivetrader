import { ArrowLeftRight } from 'lucide-react';
import { PriceData } from '../types/hive';
import { LoadingPlaceholder } from './LoadingSpinner';

interface PriceDisplayProps {
  priceData: PriceData | null;
  isLoading: boolean;
  t: (key: string) => string;
}

export function PriceDisplay({ priceData, isLoading, t }: PriceDisplayProps) {
  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
        <ArrowLeftRight className="mr-2 h-5 w-5" />
        {t('priceDisplay.title')}
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
                {priceData.hiveInHbd.toFixed(6)} HBD
              </div>
            ) : (
              <div className="text-gray-500 text-sm">{t('priceDisplay.notAvailable')}</div>
            )}
          </div>
        </div>

        <div className="flex justify-between items-center">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center mr-3">
              <span className="text-white font-bold text-sm">HBD</span>
            </div>
            <span className="text-gray-300 font-medium">HBD</span>
          </div>
          <div className="text-right">
            {isLoading ? (
              <LoadingPlaceholder className="h-6 w-16" />
            ) : priceData ? (
              <div className="text-white font-semibold">
                {priceData.hbdInHive.toFixed(6)} HIVE
              </div>
            ) : (
              <div className="text-gray-500 text-sm">{t('priceDisplay.notAvailable')}</div>
            )}
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-400">{t('priceDisplay.source')}</p>

      {!isLoading && !priceData && (
        <div className="mt-4 p-3 bg-red-900/20 border border-red-700 rounded-md">
          <p role="alert" className="text-red-400 text-xs">
            {t('priceDisplay.apiError')}
          </p>
        </div>
      )}
    </div>
  );
}