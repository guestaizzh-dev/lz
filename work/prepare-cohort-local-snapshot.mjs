import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile('work/booking-disputes-snapshot.mjs','utf8');await writeFile('work/cohort-sales-snapshot.mjs',source.replace('booking-disputes-2026-10-13','cohort-sales-2026-10-13'));
