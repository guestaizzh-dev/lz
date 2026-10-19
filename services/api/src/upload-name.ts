// Multipart parsers read filename bytes as Latin-1; browser filenames usually contain UTF-8.
export function uploadName(value: string) {
  let name=value;
  if([...value].every(char=>char.charCodeAt(0)<=255)){
    try{name=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(value,'latin1'));}catch{}
  }
  return name.replace(/\\/g,'/').split('/').at(-1)!.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200).replace(/[\uD800-\uDBFF]$/,'')||'未命名文件';
}
