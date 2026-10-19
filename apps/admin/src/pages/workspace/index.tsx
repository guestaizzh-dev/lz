import { PageContainer } from '@ant-design/pro-components';
import { Link, useAccess, useLocation } from '@umijs/max';
import { Alert, Card, Col, Empty, Input, List, Row, Space, Typography } from 'antd';
import { useState } from 'react';
import { canOpenPage, matchesEntry, visibleNavigation } from '@/operations/navigation';
import { workflows } from '@/operations/workflows';
import styles from './index.less';
import OperationsStatus from '@/components/OperationsStatus';

export default function Workspace() {
  const access = useAccess();
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');
  const scope = pathname === '/content' ? 'content' : pathname === '/system' ? 'system' : undefined;
  const groups = visibleNavigation(access).filter(group => group.id !== 'work' && (!scope || group.id === scope));
  const filtered = groups.map(group => ({ ...group, entries: group.entries.filter(entry => matchesEntry(entry, query)) })).filter(group => group.entries.length);
  const common = workflows.filter(workflow => workflow.steps.some(step => step.path && canOpenPage(step.path, access))).slice(0, 6);
  return <PageContainer title={scope === 'content' ? '内容运营' : scope === 'system' ? '系统管理' : '工作台'} subTitle="按业务模块找入口，按操作指南完成工作">
    {!scope && <OperationsStatus />}
    {!scope && <Card title="常用工作流程" extra={<Link to="/guide">全部操作指南 →</Link>} style={{ marginBottom: 24 }}>
      {common.length ? <Row gutter={[16, 16]}>{common.map(workflow => <Col xs={24} md={12} xl={8} key={workflow.id}>
        <Link className={styles.workflow} to={`/guide?workflow=${workflow.id}`}>
          <Typography.Title level={5}>{workflow.title} →</Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>{workflow.summary}</Typography.Paragraph>
        </Link>
      </Col>)}</Row> : <Alert type="info" showIcon title="当前账号尚未配置业务入口权限" description="可以先阅读操作指南；需要操作业务时，请联系管理员配置角色和权限。" />}
    </Card>}
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <Input.Search size="large" aria-label="搜索业务入口" placeholder="输入业务名称或工作内容，例如：场次、开播、库存、退款…" value={query} allowClear onChange={event => setQuery(event.target.value)} style={{ maxWidth: 640 }} />
      <Row gutter={[24, 24]}>{filtered.map(group => <Col xs={24} md={12} xl={8} key={group.id}>
        <Card title={group.title} className={styles.module}>
          <List dataSource={group.entries} renderItem={entry => <List.Item>
            <div><Link to={entry.path}>{entry.title} →</Link><div className={styles.description}>{entry.summary}</div></div>
          </List.Item>} />
        </Card>
      </Col>)}</Row>
      {!filtered.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? '没有匹配的可用入口，请尝试其他关键词或查看操作指南' : '当前账号没有此范围的业务权限'} />}
    </Space>
  </PageContainer>;
}
