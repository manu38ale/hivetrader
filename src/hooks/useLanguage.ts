import { useState, useEffect } from 'react';
import enTranslations from '../locales/en.json';
import esTranslations from '../locales/es.json';

export type Language = 'en' | 'es';

const translations = {
  en: enTranslations,
  es: esTranslations
};

export function useLanguage() {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('language');
    return (saved as Language) || 'es'; // Default to Spanish
  });

  useEffect(() => {
    localStorage.setItem('language', language);
  }, [language]);

  const t = (key: string): string => {
    const keys = key.split('.');
    let value: any = translations[language];
    
    for (const k of keys) {
      value = value?.[k];
    }
    
    return value || key;
  };

  return {
    language,
    setLanguage,
    t
  };
}