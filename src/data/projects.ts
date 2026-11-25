/** Where a project leads: its live demo on this site, or its repository when there is no demo. */
export function projectHref(data: { demo?: string; repo?: string }) {
  if (data.demo) return new URL(data.demo).pathname;
  return data.repo ?? '/projects/';
}
