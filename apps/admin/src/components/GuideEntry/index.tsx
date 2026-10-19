import { QuestionCircleOutlined } from '@ant-design/icons';
import { history, useLocation } from '@umijs/max';
import { Button, Dropdown } from 'antd';
import { workflowForPage } from '@/operations/workflows';

export default function GuideEntry() {
  const { pathname } = useLocation();
  const workflow = workflowForPage(pathname);
  return <Dropdown menu={{
    items: [
      ...(workflow ? [{ key: workflow.id, label: `本页流程：${workflow.title}` }] : []),
      { key: 'all', label: '全部操作指南' },
    ],
    onClick: ({ key }) => history.push(key === 'all' ? '/guide' : `/guide?workflow=${key}`),
  }} trigger={['click']}>
    <Button type="text" icon={<QuestionCircleOutlined />}>操作指南</Button>
  </Dropdown>;
}
