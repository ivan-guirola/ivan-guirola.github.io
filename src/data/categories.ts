export const categoryIds = ['architecture', 'oauth', 'keycloak', 'decentralized', 'tools'] as const;
export type CategoryId = (typeof categoryIds)[number];

export const categoryLabels: Record<CategoryId, string> = {
  architecture: 'Architecture',
  oauth: 'OAuth',
  keycloak: 'Keycloak extensions',
  decentralized: 'Decentralized identity',
  tools: 'Tools',
};
