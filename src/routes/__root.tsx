import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import '../styles.css'
import '../theme/theme.css'
import logoUrl from '../theme/logo.svg?url'
import '../theme-adapter.css'
import '../simple.css'
import '../admin.css'
import { ThemeBackdrop } from '../ui/Theme'
export const Route = createRootRoute({
  head: () => ({ links: [{ rel: 'icon', type: 'image/svg+xml', href: logoUrl }, { rel: 'apple-touch-icon', href: logoUrl }], meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }, { name: 'theme-color', content: '#0b0b0d' }, { name: 'apple-mobile-web-app-capable', content: 'yes' }, { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }, { title: 'Sillage' }] }),
  component: () => <html lang="fr" data-theme="dark"><head><HeadContent /></head><body><ThemeBackdrop/><Outlet /><Scripts /></body></html>,
})
