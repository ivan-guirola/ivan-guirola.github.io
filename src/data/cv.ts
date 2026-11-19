export interface Job {
  company: string;
  place: string;
  role: string;
  start: string;
  end: string | null;
  points?: string[];
}

export const jobs: Job[] = [
  {
    company: 'KPMG',
    place: 'Barcelona',
    role: 'Senior Specialist',
    start: '2025-12',
    end: null,
    points: [
      'Needs analysis (AS-IS / TO-BE), benchmarking of IAM solutions and support in selecting the one to deploy.',
      'IAM strategy definition, solution configuration and integration with applications and services.',
      'Design and deployment of ETLs to migrate users and manage their lifecycle across identity, authentication and authorization.',
      'Authentication and authorization flows for applications, banking environments, APIs and microservices on OAuth 2.0 and OIDC.',
      'Custom nodes and scripts in Java and Groovy for PingAM and PingIDM (formerly ForgeRock), SQL for Saviynt, and SPI authenticators and mappers for Keycloak / RHBK.',
      'Enterprise SSO through SAML and OIDC federation.',
      'Maturity and security reviews of deployed access management to find vulnerabilities and improvements.',
      'Joiner, Mover, Leaver workflows, provisioning policies and SCIM provisioning to applications.',
      'Support and incident management for PAM tools.',
    ],
  },
  {
    company: 'KPMG',
    place: 'Barcelona',
    role: 'Technology Expert',
    start: '2023-11',
    end: '2025-12',
  },
  {
    company: 'KPMG',
    place: 'Barcelona',
    role: 'Technology Analyst',
    start: '2023-01',
    end: '2023-11',
  },
  {
    company: 'Accenture',
    place: 'Barcelona',
    role: 'Security Delivery Analyst',
    start: '2022-09',
    end: '2023-01',
    points: [
      'Designed and implemented authentication and authorization solutions for enterprise and banking environments.',
      'Customized authentication nodes and scripts in Java, Groovy and JavaScript for ForgeRock AM.',
      'Migrated user identities via ETL pipelines in authentication flows.',
      'Secured APIs and microservices using OAuth 2.0 and OIDC, aligned with Zero Trust principles.',
    ],
  },
  {
    company: 'Accenture',
    place: 'Barcelona',
    role: 'Security Delivery Associate',
    start: '2021-01',
    end: '2022-09',
  },
  {
    company: 'Eject Computer',
    place: 'Barcelona',
    role: 'IT technician',
    start: '2019-03',
    end: '2019-06',
    points: ['Hardware support, server and network configuration, and technical consulting.'],
  },
];

export const skills: { group: string; items: string[] }[] = [
  {
    group: 'Protocols and standards',
    items: ['OAuth 2.0', 'OpenID Connect', 'SAML 2.0', 'SCIM 2.0', 'UMA 2.0', 'FIDO2', 'LDAP'],
  },
  {
    group: 'Access control models',
    items: ['RBAC', 'ABAC', 'PBAC'],
  },
  {
    group: 'Identity platforms',
    items: [
      'Keycloak / RHBK',
      'Ping Identity (PingAM and PingIDM, formerly ForgeRock)',
      'Okta',
      'Microsoft Entra ID',
      'AWS IAM and Cognito',
      'Saviynt',
      'CyberArk',
      'Active Directory',
      'IBM TDI',
    ],
  },
  {
    group: 'Languages and tools',
    items: ['Java', 'Groovy', 'JavaScript', 'Python', 'SQL', 'Git'],
  },
  {
    group: 'Other areas of knowledge',
    items: [
      'Non-human identities (NHI)',
      'Decentralized identity (DIDs)',
    ],
  },
];

export const certifications: { name: string; issuer: string; logo: string }[] = [
  { name: 'NHI Foundation Level', issuer: 'NHI Mgmt Group', logo: 'nhimg.png' },
  { name: 'ForgeRock Certified Access Management Specialist', issuer: 'ForgeRock (Ping Identity)', logo: 'forgerock.svg' },
  { name: 'Okta Certified Professional', issuer: 'Okta', logo: 'okta.svg' },
  { name: 'CyberArk Access Certified Sales Professional', issuer: 'CyberArk', logo: 'cyberark.svg' },
  { name: 'Ping Partner Technical Advocate', issuer: 'Ping Identity', logo: 'ping.svg' },
  { name: 'Microsoft Certified: Azure Fundamentals', issuer: 'Microsoft', logo: 'microsoft.svg' },
];

export const education = {
  title: 'Higher education certificate in cross-platform application development (EQF 5)',
  school: 'Institut Pedralbes, Barcelona',
  years: '2019 – 2021',
};

export const languages: { name: string; level: string }[] = [
  { name: 'Spanish', level: 'Native' },
  {
    name: 'English',
    level: 'B2, reading C1',
  },
];
