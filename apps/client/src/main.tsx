// Bundled (offline) fonts, Latin subsets only. Lilita One: titles and numbers; Nunito: body text;
// Cinzel: the "Realm Raiders" logo only; Almendra: officers' speech (parchment).
import '@fontsource/lilita-one/latin-400.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/almendra/latin-400.css';
import './styles/theme.css';
import { lazy, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { config } from './net/config';

const PrivyRoot = config.privyAppId ? lazy(() => import('./auth/PrivyRoot')) : null;

function Root({ children }: { children: ReactNode }) {
  if (!PrivyRoot) return <>{children}</>;
  return (
    <Suspense fallback={<div className="screen center">Raising the banners…</div>}>
      <PrivyRoot>{children}</PrivyRoot>
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root>
      <App />
    </Root>
  </StrictMode>,
);
