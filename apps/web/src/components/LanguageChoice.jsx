import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import { quietActionClass } from './controlClasses.js';

const labels = { en: 'English', es: 'Español' };

export default function LanguageChoice() {
  const { language, available, select, text } = usePublicLanguage();
  if (available.length < 2) return null;
  return (
    <div className="no-print flex flex-wrap items-center gap-x-sm">
      <div role="group" aria-label={text('Site language', 'Idioma del sitio')} className="flex flex-wrap gap-x-2xs">
        {available.map((option) => (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={language === option}
            className={`${quietActionClass} aria-pressed:font-semibold aria-pressed:underline`}
            onClick={() => select(option)}
          >
            {labels[option]}
          </button>
        ))}
      </div>
      {language === 'es' ? <p className="text-caption text-text-secondary">Algunos contenidos pueden aparecer en inglés.</p> : null}
    </div>
  );
}
