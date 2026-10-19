import { useEffect, useState } from 'react';
import { BarChart3, Bot } from 'lucide-react';
import { useLanguage } from './hooks/useLanguage';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { AnalysisPage } from './pages/AnalysisPage';
import { BotPage } from './pages/BotPage';

function currentPage(): 'analysis' | 'bot' {
  return window.location.hash === '#/bot' ? 'bot' : 'analysis';
}

export default function App() {
  const { language, setLanguage, t } = useLanguage();
  const [page, setPage] = useState(currentPage);
  useEffect(() => {
    const onNavigate = () => setPage(currentPage());
    window.addEventListener('hashchange', onNavigate);
    return () => window.removeEventListener('hashchange', onNavigate);
  }, []);
  useEffect(() => {
    document.title = `${t(`navigation.${page}`)} | ${t('header.title')}`;
  }, [page, t]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200">
      <a href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }} className="sr-only focus:not-sr-only focus:block focus:bg-blue-700 focus:p-3">
        {t('navigation.skip')}
      </a>
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center gap-4 py-6">
            <div className="flex items-center gap-3">
              <div aria-hidden="true" className="w-10 h-10 bg-red-500 rounded-lg flex items-center justify-center text-white font-bold">H</div>
              <h1 className="text-xl sm:text-2xl font-bold text-white">{t('header.title')}</h1>
            </div>
            <LanguageSwitcher currentLanguage={language} onLanguageChange={setLanguage} />
          </div>
          <nav aria-label={t('navigation.main')} className="flex gap-2">
            {(['analysis', 'bot'] as const).map(item => {
              const Icon = item === 'analysis' ? BarChart3 : Bot;
              return (
                <a
                  key={item}
                  href={`#/${item}`}
                  aria-current={page === item ? 'page' : undefined}
                  className={`flex items-center gap-2 px-4 py-3 border-b-2 text-sm sm:text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${
                    page === item ? 'border-blue-400 text-white' : 'border-transparent text-gray-400 hover:text-white'
                  }`}
                >
                  <Icon aria-hidden="true" className="w-4 h-4" />{t(`navigation.${item}`)}
                </a>
              );
            })}
          </nav>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div hidden={page !== 'analysis'}>
          <AnalysisPage language={language} t={t} />
        </div>
        <div hidden={page !== 'bot'}>
          <BotPage active={page === 'bot'} language={language} t={t} />
        </div>
      </main>
      <footer className="bg-gray-800 border-t border-gray-700 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center text-gray-400 text-sm">
          <p>{t('footer.description')}</p>
          <p className="mt-1">{t(page === 'bot' ? 'bot.refreshNote' : 'footer.updateInterval')}</p>
        </div>
      </footer>
    </div>
  );
}
