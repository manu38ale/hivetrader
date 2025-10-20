import React from 'react';
import { Calendar } from 'lucide-react';
import { DateFilter as DateFilterType } from '../types/hive';
import { format } from 'date-fns';

interface DateFilterProps {
  dateFilter: DateFilterType;
  onDateFilterChange: (filter: DateFilterType) => void;
  t: (key: string) => string;
}

export function DateFilter({ dateFilter, onDateFilterChange, t }: DateFilterProps) {
  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? new Date(e.target.value) : null;
    onDateFilterChange({ ...dateFilter, startDate: date });
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = e.target.value ? new Date(e.target.value) : null;
    onDateFilterChange({ ...dateFilter, endDate: date });
  };

  const clearFilters = () => {
    onDateFilterChange({ startDate: null, endDate: null });
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
        <Calendar className="mr-2 h-5 w-5" />
        {t('dateFilter.title')}
      </h3>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('dateFilter.startDate')}
          </label>
          <input
            type="date"
            value={dateFilter.startDate ? format(dateFilter.startDate, 'yyyy-MM-dd') : ''}
            onChange={handleStartDateChange}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('dateFilter.endDate')}
          </label>
          <input
            type="date"
            value={dateFilter.endDate ? format(dateFilter.endDate, 'yyyy-MM-dd') : ''}
            onChange={handleEndDateChange}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        
        <div className="flex items-end">
          <button
            onClick={clearFilters}
            className="w-full px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-md transition-colors duration-200"
          >
            {t('dateFilter.clearFilters')}
          </button>
        </div>
      </div>
    </div>
  );
}