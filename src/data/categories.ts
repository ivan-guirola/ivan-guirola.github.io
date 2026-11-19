export const categoryIds = ['architecture', 'keycloak', 'decentralized', 'tools'] as const;
export type CategoryId = (typeof categoryIds)[number];

export const categoryLabels: Record<CategoryId, string> = {
  architecture: 'Architecture',
  keycloak: 'Keycloak extensions',
  decentralized: 'Decentralized identity',
  tools: 'Tools',
};
