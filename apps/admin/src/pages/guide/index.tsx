import { PageContainer } from '@ant-design/pro-components';
import { Link, useAccess, useLocation } from '@umijs/max';
import { Alert, Card, Col, Empty, Input, List, Row, Select, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { canOpenPage, pageEntry } from '@/operations/navigation';
import { matchesWorkflow, workflows } from '@/operations/workflows';
import styles from '../workspace/index.less';

export default function Guide() {
  const access = useAccess();
  const { search } = useLocation();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const id = new URLSearchParams(search).get('workflow');
  const matches = workflows.filter(workflow => (category === 'all' || workflow.category === category) && matchesWorkflow(workflow, query));
  const selected = id ? workflows.find(workflow => workflow.id === id) : matches[0];
  return <PageContainer title="操作指南" subTitle="按真实业务流程操作；每一步都可直接进入对应页面">
    <Row gutter={[24, 24]}>
      <Col xs={24} lg={8} xl={6}>
        <Card title="查找工作流程">
          <Space orientation="vertical" style={{ width: '100%' }} size="middle">
            <Input.Search aria-label="搜索操作指南" placeholder="搜索开播、发布、发货、退款…" allowClear value={query} onChange={event => setQuery(event.target.value)} />
            <Select aria-label="指南业务分类" style={{ width: '100%' }} value={category} onChange={setCategory} options={[
              { value: 'all', label: '全部业务' },
              ...[...new Set(workflows.map(workflow => workflow.category))].map(value => ({ value, label: value })),
            ]} />
            <Typography.Text type="secondary">{matches.length} 个流程 · 灰色入口表示当前账号无权操作</Typography.Text>
          </Space>
          <List dataSource={matches} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到流程，请尝试其他关键词" /> }} renderItem={workflow => <List.Item>
            <Link aria-current={selected?.id === workflow.id ? 'page' : undefined} className={selected?.id === workflow.id ? styles.activeGuide : undefined} to={`/guide?workflow=${workflow.id}`}>
              {workflow.title}<div><Typography.Text type="secondary">{workflow.category}</Typography.Text></div>
            </Link>
          </List.Item>} />
        </Card>
      </Col>
      <Col xs={24} lg={16} xl={18}>
        {!selected ? <Card><Empty description={id ? '该操作指南不存在，请从左侧选择流程' : '请输入其他关键词，或选择全部业务'} /><Link to="/guide">查看全部操作指南</Link></Card> : <Card>
          <Tag color="blue">{selected.category}</Tag>
          <Typography.Title level={3}>{selected.title}</Typography.Title>
          <Typography.Paragraph type="secondary">适用人员：{selected.audience}</Typography.Paragraph>
          <Typography.Paragraph>{selected.summary}</Typography.Paragraph>
          <Alert type="info" showIcon title="开始前准备" description={selected.prepare} style={{ marginBottom: 24 }} />
          <ol className={styles.guideSteps}>
            {selected.steps.map((step, index) => <li key={`${selected.id}-${index}`}>
              <Typography.Title level={5}>{step.title}</Typography.Title>
              <Typography.Paragraph>{step.detail}</Typography.Paragraph>
              {step.path && (canOpenPage(step.path, access)
                ? <Link to={step.path}>打开{pageEntry(step.path)?.title} →</Link>
                : <Typography.Text type="secondary">{pageEntry(step.path)?.title}：当前账号无入口权限，请由对应负责人处理</Typography.Text>)}
            </li>)}
          </ol>
          <Alert type="success" showIcon title="完成后核对" description={selected.verify} style={{ marginBottom: 20 }} />
          <Typography.Title level={5}>常见问题与注意事项</Typography.Title>
          <ul className={styles.cautions}>{selected.cautions.map(caution => <li key={caution}>{caution}</li>)}</ul>
        </Card>}
      </Col>
    </Row>
  </PageContainer>;
}
