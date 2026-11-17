import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'InstaGrowth System',
    short_name: 'InstaGrowth',
    description: 'Sistema de crescimento de seguidores no Instagram',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f0520',
    theme_color: '#7c3aed',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
