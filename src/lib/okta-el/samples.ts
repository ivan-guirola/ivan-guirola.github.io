import type { Context } from './evaluate';

export const SAMPLE_CONTEXT: Context = {
  user: {
    login: 'jane.doe@example.com',
    email: 'jane.doe@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    department: 'Sales EMEA',
    title: 'Account manager',
    employeeNumber: '00427',
    countryCode: 'ES',
    costCenter: 'CC-1020',
    managerId: null,
    entitlements: ['crm', 'reports'],
  },
  appuser: { userName: 'jdoe', role: 'editor' },
  org: { name: 'Example Corp', subdomain: 'example' },
  groups: [
    { id: '00g1a2b3c4', name: 'Everyone', source: 'OKTA' },
    { id: '00g2b3c4d5', name: 'app-crm-users', source: 'OKTA' },
    { id: '00g3c4d5e6', name: 'app-crm-admins', source: 'OKTA' },
    { id: '00g4d5e6f7', name: 'Sales', source: 'active_directory' },
    { id: '00g5e6f7a8', name: 'vpn-users', source: 'active_directory' },
  ],
  internal: {
    id: '00u8xk2p1qAbCdEf',
    status: 'ACTIVE',
    created: '2023-03-14T09:12:00.000Z',
    lastLogin: '2026-11-16T08:01:22.000Z',
  },
};

export interface Example {
  use: 'mapping' | 'rule' | 'claim';
  title: string;
  expression: string;
}

export const EXAMPLES: Example[] = [
  { use: 'mapping', title: 'Username from the email', expression: 'String.substringBefore(user.email, "@")' },
  { use: 'mapping', title: 'Full name', expression: 'user.firstName + " " + user.lastName' },
  {
    use: 'mapping',
    title: 'Code for each department',
    expression: 'String.stringSwitch(user.department, "OTHER", "Sales", "SLS", "Finance", "FIN", "Engineering", "ENG")',
  },
  { use: 'mapping', title: 'A default when a value is missing', expression: 'user.managerId ?: "no manager"' },
  { use: 'rule', title: 'Sales staff in Spain', expression: 'user.department == "Sales EMEA" AND user.countryCode == "ES"' },
  { use: 'rule', title: 'Member of any CRM group', expression: 'isMemberOfGroupNameStartsWith("app-crm-")' },
  { use: 'claim', title: 'Role from group membership', expression: 'isMemberOfGroupName("app-crm-admins") ? "admin" : "user"' },
  { use: 'claim', title: 'CRM groups for a token', expression: 'Groups.startsWith("OKTA", "app-crm-", 10)' },
  { use: 'claim', title: 'Last sign-in as Unix time', expression: 'Time.fromIso8601ToUnix(user.getInternalProperty("lastLogin"))' },
];
