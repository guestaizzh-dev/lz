import { InputNumber, type InputNumberProps } from 'antd';

// Forms keep minor units at the API boundary; operators enter yuan.
type Props=Omit<InputNumberProps<number>,'value'|'onChange'|'min'|'max'|'precision'|'step'>&{value?:number|null;onChange?:(value:number|null)=>void;min?:number;max?:number};
export default function MoneyInput({value,onChange,min=0,max=100000000,...props}:Props){
  return <InputNumber<number> {...props} value={value==null?null:value/100} min={min/100} max={max/100} precision={2} step={1} prefix="¥" onChange={amount=>onChange?.(amount==null?null:Math.round(amount*100))}/>;
}
