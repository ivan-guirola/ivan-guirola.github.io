export const routes = {
  home: '/',
  projects: '/projects/',
  cv: '/cv/',
  contact: '/contact/',
} as const;
export type PageKey = keyof typeof routes;

export const ui = {
  nav: { home: 'Home', projects: 'Projects', cv: 'CV', contact: 'Contact' },
  skip: 'Skip to content',
  mainNav: 'Main',
  theme: 'Switch between light and dark theme',
  disclaimer: 'The projects available on this site are created for educational purposes or to support my day-to-day work.',
};
