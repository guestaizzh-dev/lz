import { createStyles } from 'antd-style';
const useStyles=createStyles(({token})=>({footer:{padding:'16px 24px',textAlign:'center',color:token.colorTextDescription,fontSize:token.fontSizeSM,lineHeight:token.lineHeight}}));
export default function Footer(){
  const {styles}=useStyles();
  return <footer className={styles.footer}>老子道学书院运营后台 © {new Date().getFullYear()} · v{__APP_VERSION__}</footer>;
}
