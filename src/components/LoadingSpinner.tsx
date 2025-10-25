import React from 'react';
import { useLanguage } from '../hooks/useLanguage';

export function LoadingSpinner({ statusMessage }: { statusMessage?: string }) {
  const { t } = useLanguage();
  
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
        <div className="mt-4 text-white text-lg">{t('loading.title')}</div>
        <div className="mt-2 text-gray-400 text-sm">{statusMessage || t('loading.subtitle')}</div>
      </div>
    </div>
  );
}

export function LoadingOverlay({ isLoading, statusMessage }: { isLoading: boolean, statusMessage?: string }) {
  if (!isLoading) return null;
  
  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-70 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
        <div className="mt-4 text-white text-lg">{statusMessage}</div>
      </div>
    </div>
  );
}

export function LoadingPlaceholder({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-gray-700 rounded ${className}`}></div>
  );
}

export function TableLoadingRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-6 py-4"><div className="h-4 bg-gray-700 rounded w-24"></div></td>
      <td className="px-6 py-4"><div className="h-4 bg-gray-700 rounded w-16"></div></td>
      <td className="px-6 py-4"><div className="h-4 bg-gray-700 rounded w-20"></div></td>
      <td className="px-6 py-4"><div className="h-4 bg-gray-700 rounded w-20"></div></td>
      <td className="px-6 py-4"><div className="h-4 bg-gray-700 rounded w-16"></div></td>
    </tr>
  );
}