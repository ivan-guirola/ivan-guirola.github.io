export const SAMPLE_USERS = `firstname,lastname,middlename,employeeid,employeetype
Jane,Doe,,42,Employee
John,Smith,Paul,1043,Contractor
María José,Fernández,,2051,Employee
Sean,O'Brien,,3307,Employee
Jane,Doe,Ann,4410,Employee
Alexandrina,Montgomery-Wellington,,5120,Employee
Lucía,,,6002,Contractor`;

export const SAMPLE_TAKEN = `john.smith
admin`;

export interface Example {
  title: string;
  rule: string;
}

const ACCENTS = (inner: string) =>
  ["'á','a'", "'é','e'", "'í','i'", "'ó','o'", "'ú','u'", "'ñ','n'", "' ',''", "'''',''"].reduce(
    (text, pair) => `REPLACE(${text}, ${pair})`,
    inner,
  );

export const EXAMPLES: Example[] = [
  { title: 'first.last', rule: "LOWER(CONCAT(users.firstname, '.', users.lastname))" },
  {
    title: 'first.last, then a number when taken',
    rule: [
      "LOWER(CONCAT(users.firstname, '.', users.lastname))",
      "LOWER(CONCAT(users.firstname, '.', users.lastname, '1'))",
      "LOWER(CONCAT(users.firstname, '.', users.lastname, '2'))",
    ].join('\n#\n'),
  },
  {
    title: 'Without accents, spaces or apostrophes',
    rule: `${ACCENTS("LOWER(CONCAT(users.firstname, '.', users.lastname))")}`,
  },
  {
    title: 'Middle name that may be empty',
    rule: "LOWER(CONCAT_WS('.', users.firstname, users.middlename, users.lastname))",
  },
  {
    title: 'Initial and surname, at most 20 characters',
    rule: "LOWER(LEFT(CONCAT(LEFT(users.firstname, 1), users.lastname), 20))",
  },
  {
    title: 'Prefix for contractors',
    rule: "CASE WHEN users.employeetype = 'Contractor'\n  THEN LOWER(CONCAT('ext.', users.firstname, '.', users.lastname))\n  ELSE LOWER(CONCAT(users.firstname, '.', users.lastname))\nEND",
  },
  { title: 'From the employee ID', rule: "CONCAT('u', LPAD(users.employeeid, 7, '0'))" },
];
