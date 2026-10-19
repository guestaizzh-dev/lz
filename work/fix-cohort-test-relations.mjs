import {readFile,writeFile} from 'node:fs/promises';
const path='services/api/test/cohort-sales.test.mjs';let test=await readFile(path,'utf8');test=test.replace("{where:{paymentTransaction:{orderId:row.id}}}","{where:{paymentTransactionId:{in:(await db.paymentTransaction.findMany({where:{orderId:row.id},select:{id:true}})).map(p=>p.id)}}}");await writeFile(path,test);
