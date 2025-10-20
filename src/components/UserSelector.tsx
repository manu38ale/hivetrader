import React, { useState } from 'react';
import { User, Search, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { Locale } from 'date-fns';

interface UserSelectorProps {
  currentUser: string;
  onUserChange: (user: string) => void;
  isLoading: boolean;
  t: (key: string) => string;
  lastUpdate: Date;
  dateLocale: Locale;
}

export function UserSelector({ currentUser, onUserChange, isLoading, t, lastUpdate, dateLocale }: UserSelectorProps) {
  const [inputValue, setInputValue] = useState(currentUser);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedValue = inputValue.trim();
    if (trimmedValue && trimmedValue !== currentUser) {
      onUserChange(trimmedValue);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const popularUsers = ['manuphotos', 'blocktrades', 'steemit', 'freedom'];

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
        <User className="mr-2 h-5 w-5" />
        {t('userSelector.title')}
      </h3>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <input
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              placeholder={t('userSelector.placeholder')}
              disabled={isLoading}
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !inputValue.trim() || inputValue.trim() === currentUser}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-md transition-colors duration-200 flex items-center"
          >
            <Search className="w-4 h-4 mr-2" />
            {isLoading ? t('userSelector.loading') : t('userSelector.analyze')}
          </button>
        </div>
      </form>

      <div className="mt-4 flex justify-between items-center">
        <div className="text-sm text-gray-400 flex items-center">
          <Clock className="w-4 h-4 mr-1" />
          {t('header.lastUpdate')}: {format(lastUpdate, 'dd/MM/yyyy HH:mm', { locale: dateLocale })}
        </div>
      </div>

      <div className="mt-4 p-3 bg-gray-700 rounded-md">
        <p className="text-xs text-gray-400">
          <strong>Nota:</strong> {t('userSelector.note')}
        </p>
      </div>
    </div>
  );
}