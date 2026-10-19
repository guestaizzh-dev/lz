import getpass
import json
from pathlib import Path
from urllib.request import build_opener, HTTPCookieProcessor, Request
from urllib.error import HTTPError
from http.cookiejar import CookieJar

base='https://academy.43-160-229-173.sslip.io'
session=build_opener(HTTPCookieProcessor(CookieJar()))
results=[]

def request(path,data=None):
    headers={'Origin':base}
    if data is not None:
        headers['Content-Type']='application/json'
        data=json.dumps(data).encode()
    try:
        response=session.open(Request(base+path,data=data,headers=headers),timeout=20)
    except HTTPError as error:
        response=error
    return response.status,response.read()

def check(name,path,expected=200):
    status,body=request(path)
    assert status==expected,(name,status)
    results.append({'name':name,'status':status})
    return body

check('线上健康','/api/v1/health')
check('后台页面','/membership-orders')
check('匿名不能读取会员交易','/api/v1/admin/membership-orders',401)
status,_=request('/api/v1/admin/auth/login',{'username':'admin','password':getpass.getpass('Admin password: ')})
assert status==200,status
results.append({'name':'管理员登录','status':status})
for name,path in [('管理员会话','/admin/auth/session'),('会员订单','/admin/membership-orders'),('课程订单','/admin/course-orders'),('商品订单','/admin/product-orders'),('会员套餐','/admin/memberships/plans'),('首页','/catalog/home'),('公开有效配置','/configuration')]:
    check(name,'/api/v1'+path)
plans=json.loads(check('套餐权益列表','/api/v1/admin/memberships/plans'))
plan=(plans['items'] if isinstance(plans,dict) else plans)[0]
versions=json.loads(check('当前冻结权益版本','/api/v1/admin/membership-benefits/plans/'+plan['id']))
assert 'current' in versions and versions['current'] is not None
definitions=json.loads(check('商城权益定义','/api/v1/admin/data/benefit_definition?size=50'))
assert {'PRODUCT_DISCOUNT','SHIPPING_WAIVER'} <= {row['code'] for row in definitions['items']}
products=json.loads(check('商品会员折扣字段','/api/v1/admin/products?page=1&size=10'))
assert products['items'] and all(isinstance(row['memberDiscountEligible'],bool) for row in products['items'])
out=Path('outputs/member-shop-pricing-2026-10-11/online-checks.json')
out.write_text(json.dumps({'checks':results,'passed':len(results),'realTransactionsCreated':False},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':len(results)},ensure_ascii=False))
