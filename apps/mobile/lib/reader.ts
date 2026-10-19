export type ReaderSelection={blockId:string;rangeStart:number;rangeEnd:number;quote:string};
export type ReaderAction={action:string;selections?:ReaderSelection[];url?:string;blockId?:string;requestId?:number};

type ReaderBlock={id:string;type:string;text:string;url?:string};
// Both Web and the native bridge use the exact published UTF-16 text, never a supplied quote.
export function readerAction(value:unknown,blocks:ReaderBlock[]):ReaderAction|null {
  if(!value||typeof value!=='object')return null;
  const data=value as ReaderAction;
  if(data.action==='media')return typeof data.blockId==='string'&&blocks.some(b=>b.id===data.blockId&&['audio','video'].includes(b.type))&&Number.isSafeInteger(data.requestId)&&data.requestId!>0?{action:data.action,blockId:data.blockId,requestId:data.requestId}:null;
  if(data.action==='image')return typeof data.url==='string'&&blocks.some(b=>b.type==='image'&&b.url===data.url)&&/^(https?:\/\/|\/static\/)/.test(data.url)?{action:data.action,url:data.url}:null;
  if(!['copy','note','highlight','comment'].includes(data.action)||!Array.isArray(data.selections)||!data.selections.length||data.selections.length>100)return null;
  const selections:ReaderSelection[]=[];let previous=-1;
  for(const item of data.selections){
    if(!item||typeof item!=='object')return null;
    const position=blocks.findIndex(b=>b.id===item.blockId),block=blocks[position];
    if(position<=previous||!block||!['paragraph','quote'].includes(block.type)||!Number.isSafeInteger(item.rangeStart)||!Number.isSafeInteger(item.rangeEnd)||item.rangeStart<0||item.rangeEnd<=item.rangeStart||item.rangeEnd>block.text.length||/[\uDC00-\uDFFF]/.test(block.text[item.rangeStart]??'')||/[\uDC00-\uDFFF]/.test(block.text[item.rangeEnd]??''))return null;
    const quote=block.text.slice(item.rangeStart,item.rangeEnd);
    if(quote!==item.quote)return null;
    selections.push({blockId:block.id,rangeStart:item.rangeStart,rangeEnd:item.rangeEnd,quote});previous=position;
  }
  return{action:data.action,selections};
}
