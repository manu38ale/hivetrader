import React from 'react';
import { Globe } from 'lucide-react';
import { Language } from '../hooks/useLanguage';

interface LanguageSwitcherProps {
  currentLanguage: Language;
  onLanguageChange: (language: Language) => void;
}

export function LanguageSwitcher({ currentLanguage, onLanguageChange }: LanguageSwitcherProps) {
  return (
    <div className="flex items-center space-x-2">
      <Globe className="w-4 h-4 text-gray-400" />
      <div className="flex bg-gray-700 rounded-md overflow-hidden">
        <button
          onClick={() => onLanguageChange('es')}
          className={`px-3 py-1 text-sm font-medium transition-colors duration-200 ${
            currentLanguage === 'es'
              ? 'bg-blue-600 text-white'
              : 'text-gray-300 hover:text-white hover:bg-gray-600'
          }`}
        >
          ES
        </button>
        <button
          onClick={() => onLanguageChange('en')}
          className={`px-3 py-1 text-sm font-medium transition-colors duration-200 ${
            currentLanguage === 'en'
              ? 'bg-blue-600 text-white'
              : 'text-gray-300 hover:text-white hover:bg-gray-600'
          }`}
        >
          EN
        </button>
      </div>
    </div>
  );
}