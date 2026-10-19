import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync('work/cohort-sales-snapshot.mjs','utf8').replaceAll('cohort-sales-2026-10-13','cohort-compensation-2026-10-13');
writeFileSync('work/cohort-compensation-local-snapshot.mjs',source);
