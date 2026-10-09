export type ProductSku={id:string;title:string;price:number;available:number;active:boolean;version:number};
export type Address={id:string;recipient:string;phone:string;province:string;city:string;district:string;detail:string;isDefault:boolean};
export type AddressInput=Omit<Address,'id'>;
export type CartItem={id:string;quantity:number;skuId:string;sku:ProductSku;product:{id:string;title:string;cover:string;type:string};available:boolean;subtotal:number;unavailableReason:string|null};
export type Cart={items:CartItem[];total:number;checkoutEnabled:boolean};
export const addressText=(address:Address)=>[address.province,address.city,address.district,address.detail].join(' ');
